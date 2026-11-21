// lib/index.js — DSH plugin entry: resident sidecar + watchdog + model sync + HTTP routes.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { startSidecar, stopSidecar, isPortHealthy } from './supervisor.js';
import { refreshAndSyncModels } from './scanner.js';
import { OFFICIAL_MODELS, resolveBackendModel } from './models.js';
import { refreshTokensLive } from './token-refresher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, '..', 'bin');
const SIDECAR_PORT = 51130;
const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export const name = 'gemini-web-bridge';
export const inject = []; // never block plugin load on a not-yet-ready service

const BRIDGE = 'http://127.0.0.1:' + SIDECAR_PORT + '/v1';

const TARGET_AUTH_KEYS = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-1PSIDTS',
  '__Secure-1PAPISID',
  '__Secure-3PSID',
  '__Secure-3PSIDTS',
  '__Secure-3PAPISID',
  'NID'
];

/**
 * Robustly parses any raw cookie text format (document.cookie, DevTools tab-separated, JSON export, headers)
 * and extracts all Google auth tokens.
 */
export function extractAuthCookies(raw) {
  if (!raw || typeof raw !== 'string') return {};
  raw = raw.trim();
  const map = {};

  // 1. JSON array format (e.g. from Cookie-Editor / EditThisCookie)
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && item.name && item.value) {
            map[item.name.trim()] = item.value.trim();
          }
        }
      }
    } catch {}
  }

  // Strip 'Cookie:' prefix if present
  raw = raw.replace(/^cookie:\s*/i, '');

  // 2. Line by line parsing (handles tab-separated from DevTools or multi-line key=val)
  const lines = raw.split(/[\r\n]+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes('\t')) {
      const parts = trimmed.split('\t');
      if (parts.length >= 2) {
        const k = parts[0].trim();
        const v = parts[1].trim();
        if (k && v) map[k] = v;
        continue;
      }
    }

    const pairs = trimmed.split(';');
    for (const p of pairs) {
      const eqIdx = p.indexOf('=');
      if (eqIdx > 0) {
        const k = p.slice(0, eqIdx).trim();
        const v = p.slice(eqIdx + 1).trim();
        if (k && v) map[k] = v;
      }
    }
  }

  // Filter and prioritize auth keys
  const extracted = {};
  for (const tk of TARGET_AUTH_KEYS) {
    if (map[tk]) {
      extracted[tk] = map[tk];
    }
  }

  // If none of the strict target keys found, preserve all non-empty pairs
  if (Object.keys(extracted).length === 0) {
    for (const [k, v] of Object.entries(map)) {
      if (k && v) extracted[k] = v;
    }
  }

  return extracted;
}

function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj, null, 2);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function apply(ctx) {
  const logger = (() => {
    try {
      if (typeof ctx.logger === 'function') return ctx.logger('gemini-web-bridge');
    } catch {}
    return console;
  })();

  // 1) Resident sidecar + watchdog self-healing.
  Promise.resolve()
    .then(() => startSidecar(BIN_DIR, SIDECAR_PORT))
    .then(async (res) => {
      if (!res || !res.ok) {
        logger.warn('sidecar start failed: ' + ((res && res.error) || 'unknown'));
        return;
      }
      logger.info('sidecar active on port ' + SIDECAR_PORT);
      try {
        const report = await refreshAndSyncModels(BRIDGE, { apply: true });
        logger.info('model sync: ' + report.unlocked + '/' + report.total + ' verified, applied=' + report.applied);
      } catch (err) {
        logger.warn('initial model scan failed: ' + ((err && err.message) || err));
      }
    })
    .catch((err) => logger.warn('sidecar bootstrap error: ' + ((err && err.message) || err)));

  // 2) Periodic re-scan so the UI keeps tracking whatever the Web UI actually offers.
  const timer = setInterval(async () => {
    try {
      const report = await refreshAndSyncModels(BRIDGE, { apply: true });
      logger.info('scheduled model sync: ' + report.unlocked + '/' + report.total);
    } catch (err) {
      logger.warn('scheduled model scan failed: ' + ((err && err.message) || err));
    }
  }, SCAN_INTERVAL_MS);
  if (timer.unref) timer.unref();

  // 3) HTTP routes, registered once the host web server exists.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = (webCtx.reflect && webCtx.reflect.get ? webCtx.reflect.get('webServer') : webCtx.get('webServer'));
    if (!webServer) return;
    const register = (route, label) => {
      const doIt = () => webServer.register(route);
      if (typeof webCtx.effect === 'function') webCtx.effect(doIt, 'gemini-web-bridge: ' + label);
      else doIt();
    };

    // Health + catalog of the three official Web UI modes.
    register(
      {
        kind: 'exact',
        path: '/gemini-web/api/status',
        handler: async (req, res) => {
          try {
            const healthy = await isPortHealthy(SIDECAR_PORT);
            sendJson(res, 200, {
              ok: true,
              running: healthy,
              port: SIDECAR_PORT,
              proxy: 'http://127.0.0.1:7890',
              catalog: OFFICIAL_MODELS
            });
          } catch (err) {
            sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
          }
        },
      },
      'status',
    );

    // Live connectivity test endpoint
    register(
      {
        kind: 'exact',
        path: '/gemini-web/api/test-connection',
        handler: async (req, res) => {
          const t0 = Date.now();
          try {
            const upstream = await fetch(`http://127.0.0.1:${SIDECAR_PORT}/v1/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer sk-gemini-web',
              },
              body: JSON.stringify({
                model: 'gemini-4-hydrogen',
                messages: [{ role: 'user', content: 'Reply with 1 word: PING' }],
                max_tokens: 5,
              }),
            });
            const latencyMs = Date.now() - t0;
            if (!upstream.ok) {
              return sendJson(res, upstream.status, { ok: false, latencyMs, error: `HTTP ${upstream.status}` });
            }
            const data = await upstream.json();
            const resolvedModel = upstream.headers.get('X-Resolved-Model') || 'gemini-4-argon';
            const text = data?.choices?.[0]?.message?.content?.trim() || '';
            sendJson(res, 200, { ok: true, latencyMs, resolvedModel, text });
          } catch (err) {
            sendJson(res, 500, { ok: false, latencyMs: Date.now() - t0, error: err.message });
          }
        },
      },
      'test-connection',
    );

    // Live token refresh endpoint
    register(
      {
        kind: 'exact',
        path: '/gemini-web/api/refresh-tokens',
        handler: async (req, res) => {
          try {
            const tokenRes = await refreshTokensLive();
            sendJson(res, 200, { ok: true, ...tokenRes });
          } catch (err) {
            sendJson(res, 500, { ok: false, error: err.message });
          }
        },
      },
      'refresh-tokens',
    );

    // Smart Save Cookie endpoint with automatic feature extraction
    register(
      {
        kind: 'exact',
        path: '/gemini-web/api/save-cookie',
        handler: async (req, res) => {
          try {
            const bodyBuf = await readBody(req);
            const parsed = JSON.parse(bodyBuf.toString('utf8'));
            const rawText = parsed.rawCookie || parsed.cookie || '';
            if (!rawText) return sendJson(res, 400, { ok: false, error: 'Cookie content required' });

            const extracted = extractAuthCookies(rawText);
            const extractedKeys = Object.keys(extracted);
            if (extractedKeys.length === 0) {
              return sendJson(res, 400, { ok: false, error: '未在粘贴文本中检测到有效的 Cookie 键值对' });
            }

            const cleanCookieStr = extractedKeys.map((k) => `${k}=${extracted[k]}`).join('; ');
            const cookiePath = join(BIN_DIR, 'cookie.txt');
            writeFileSync(cookiePath, cleanCookieStr, 'utf8');

            let refreshRes = null;
            try {
              refreshRes = await refreshTokensLive();
            } catch (re) {
              logger.warn('Token refresh after cookie save: ' + re.message);
            }

            sendJson(res, 200, {
              ok: true,
              extractedKeys,
              count: extractedKeys.length,
              hasSid: !!extracted.SID,
              hasPsid: !!extracted['__Secure-1PSID'],
              hasPsidts: !!extracted['__Secure-1PSIDTS'],
              refreshed: refreshRes
            });
          } catch (err) {
            sendJson(res, 500, { ok: false, error: err.message });
          }
        },
      },
      'save-cookie',
    );

    // Model re-scan. GET = preview (dry run); GET ?apply=1 = publish into the profile patch.
    register(
      {
        kind: 'exact',
        path: '/gemini-web/api/refresh-models',
        handler: async (req, res) => {
          try {
            const apply = /[?&]apply=1/.test(req.url || '');
            const report = await refreshAndSyncModels(BRIDGE, { apply });
            sendJson(res, 200, { ok: true, applied: report.applied, report });
          } catch (err) {
            sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
          }
        },
      },
      'refresh-models',
    );

    // OpenAI-compatible passthrough: /gemini-web/v1/* -> 127.0.0.1:51130/v1/*
    register(
      {
        kind: 'prefix',
        path: '/gemini-web/v1/',
        handler: async (req, res) => {
          try {
            const targetPath = (req.url || '').replace(/^\/gemini-web/, '');
            let body = await readBody(req);
            const headers = Object.assign({}, req.headers);
            delete headers.host;
            delete headers['content-length'];
            delete headers['accept-encoding'];

            const isJson = /json/i.test(String(req.headers['content-type'] || ''));
            if (body.length && isJson) {
              try {
                const obj = JSON.parse(body.toString('utf8'));
                if (obj && typeof obj.model === 'string') {
                  const mapped = resolveBackendModel(obj.model);
                  if (mapped !== obj.model) logger.info('route ' + obj.model + ' -> ' + mapped);
                  obj.model = mapped;
                  body = Buffer.from(JSON.stringify(obj), 'utf8');
                }
              } catch {}
            }

            const upstream = await fetch('http://127.0.0.1:' + SIDECAR_PORT + targetPath, {
              method: req.method,
              headers,
              body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
            });
            res.statusCode = upstream.status;
            for (const [k, v] of upstream.headers) {
              if (k === 'content-length' || k === 'content-encoding' || k === 'transfer-encoding') continue;
              try { res.setHeader(k, v); } catch {}
            }
            const buf = Buffer.from(await upstream.arrayBuffer());
            res.end(buf);
          } catch (err) {
            sendJson(res, 502, { error: { message: 'bridge proxy error: ' + String((err && err.message) || err) } });
          }
        },
      },
      'v1-proxy',
    );
  });

  ctx.on('dispose', () => {
    clearInterval(timer);
    stopSidecar();
  });
}
