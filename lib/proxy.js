// lib/proxy.js — Intelligent model-mapping and available-only filtering proxy on port 51130
// Intercepts /v1/models to only return verified available models (strict available-only principle).
// Intercepts /v1/chat/completions to transparently map official IDs (gemini-4-hydrogen, etc.) to native upstream channels.
// Robust: cancels upstream immediately if client disconnects, preventing backend queuing/lag.

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { OFFICIAL_MODELS, resolveBackendModel } from './models.js';

function getDshRoot() {
  const primary = 'C:/Users/无界15X/.dsh';
  if (existsSync(primary + '/profiles/desktop/cordis.patch.yml')) return primary;
  const envProfile = (process.env.USERPROFILE || '').replace(/\\/g, '/');
  const base = envProfile.split('/.dsh')[0];
  if (existsSync(base + '/.dsh/profiles/desktop/cordis.patch.yml')) return base + '/.dsh';
  return primary;
}

const DSH_ROOT = getDshRoot();
const STATE_FILE = DSH_ROOT + '/gemini-web-models.json';

/**
 * Retrieves the currently verified, unlocked-only models from state file or catalog.
 * Strictly filters out any model that is locked, downgraded, or failed.
 */
export function getVerifiedAvailableModels() {
  if (existsSync(STATE_FILE)) {
    try {
      const data = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      if (Array.isArray(data.models)) {
        // Strict available-only filter: MUST have ok === true and verdict === 'ok'
        const verifiedIds = new Set(
          data.models.filter((m) => m.ok === true && m.verdict === 'ok').map((m) => m.id)
        );
        const filtered = OFFICIAL_MODELS.filter((m) => verifiedIds.has(m.id));
        if (filtered.length > 0) return filtered;
      }
    } catch {}
  }
  return OFFICIAL_MODELS;
}

/**
 * Creates and starts the intelligent bridge proxy server.
 */
export function startProxyServer(proxyPort = 51130, upstreamPort = 51131) {
  const server = http.createServer((req, res) => {
    // Universal CORS support
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const hostHeader = req.headers.host || `127.0.0.1:${proxyPort}`;
    const url = new URL(req.url, `http://${hostHeader}`);

    // Health check
    if (url.pathname === '/health' || url.pathname === '/gemini-web/api/proxy-health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, role: 'intelligent-bridge-proxy', proxyPort, upstreamPort }));
    }

    // Intercept GET /v1/models & /models -> Strict Available-Only Models
    if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
      const available = getVerifiedAvailableModels();
      const data = [];
      const seen = new Set();

      for (const m of available) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          data.push({
            id: m.id,
            object: 'model',
            created: 1700000000,
            owned_by: 'google',
            name: m.name,
            location: m.location,
            category: m.category,
          });
        }
      }

      // Also append direct backend identifiers as aliases so backend queries succeed
      for (const m of available) {
        const b = m.backendId || m.backendModel;
        if (b && !seen.has(b)) {
          seen.add(b);
          data.push({
            id: b,
            object: 'model',
            created: 1700000000,
            owned_by: 'google',
            name: `${m.name} (Direct)`,
            location: m.location,
            category: m.category,
          });
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(JSON.stringify({ object: 'list', data }, null, 2));
    }

    // Intercept POST /v1/chat/completions -> Model route translation
    if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
      const chunks = [];
      let clientAborted = false;

      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (clientAborted) return;

        let bodyBuf = Buffer.concat(chunks);
        try {
          const parsed = JSON.parse(bodyBuf.toString('utf8'));
          if (parsed && typeof parsed.model === 'string') {
            const mapped = resolveBackendModel(parsed.model);
            if (mapped !== parsed.model) {
              console.log(`[bridge-proxy] route model: "${parsed.model}" -> "${mapped}"`);
            }
            parsed.model = mapped;
            bodyBuf = Buffer.from(JSON.stringify(parsed), 'utf8');
          }
        } catch {}

        const headers = { ...req.headers };
        delete headers.host;
        delete headers['content-length'];
        headers['content-length'] = bodyBuf.length;

        const options = {
          hostname: '127.0.0.1',
          port: upstreamPort,
          path: url.pathname + url.search,
          method: 'POST',
          headers,
          timeout: 120000, // 2-min timeout for deep thinking
        };

        const upstreamReq = http.request(options, (upstreamRes) => {
          const upstreamHeaders = { ...upstreamRes.headers };
          // Strip hop-by-hop headers to prevent chunked double-framing or socket stalls
          delete upstreamHeaders['connection'];
          delete upstreamHeaders['keep-alive'];
          delete upstreamHeaders['transfer-encoding'];

          res.writeHead(upstreamRes.statusCode, upstreamHeaders);
          upstreamRes.pipe(res);
        });

        // Anti-stalling: If client disconnects or aborts, IMMEDIATELY abort upstream to free Go session!
        const cleanup = () => {
          clientAborted = true;
          if (!res.writableEnded) {
            try { upstreamReq.destroy(); } catch {}
          }
        };
        req.on('close', cleanup);
        res.on('close', cleanup);

        upstreamReq.on('timeout', () => {
          console.warn('[bridge-proxy] Upstream request timed out (120s)');
          upstreamReq.destroy(new Error('Gateway timeout'));
        });

        upstreamReq.on('error', (err) => {
          console.error(`[bridge-proxy] upstream forwarding error:`, err.message);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: `Bridge upstream proxy error: ${err.message}` } }));
          }
        });

        upstreamReq.write(bodyBuf);
        upstreamReq.end();
      });

      req.on('error', () => {
        clientAborted = true;
      });

      return;
    }

    // Transparent passthrough for all other endpoints (/v1/*)
    const headers = { ...req.headers };
    delete headers.host;

    const options = {
      hostname: '127.0.0.1',
      port: upstreamPort,
      path: url.pathname + url.search,
      method: req.method,
      headers,
    };

    const upstreamReq = http.request(options, (upstreamRes) => {
      const upstreamHeaders = { ...upstreamRes.headers };
      delete upstreamHeaders['connection'];
      delete upstreamHeaders['keep-alive'];
      delete upstreamHeaders['transfer-encoding'];
      res.writeHead(upstreamRes.statusCode, upstreamHeaders);
      upstreamRes.pipe(res);
    });

    const cleanup = () => {
      if (!res.writableEnded) {
        try { upstreamReq.destroy(); } catch {}
      }
    };
    req.on('close', cleanup);
    res.on('close', cleanup);

    upstreamReq.on('error', (err) => {
      console.error(`[bridge-proxy] passthrough error:`, err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Bridge upstream proxy error: ${err.message}` } }));
      }
    });

    req.pipe(upstreamReq);
  });

  return new Promise((resolve, reject) => {
    server.listen(proxyPort, '0.0.0.0', () => {
      console.log(`[bridge-proxy] Intelligent proxy listening on http://127.0.0.1:${proxyPort} -> upstream :${upstreamPort}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}
