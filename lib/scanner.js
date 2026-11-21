// lib/scanner.js — dynamic model discovery, official name mapping, strictly unlocked/available-only filtering
// v4: True Entitlement Testing against upstream directly (51131) to detect real Google account capabilities.
// Zero-faking: unentitled models (e.g. Carbon without Chai subscription) and non-existent cloud models (Nano 4) are completely pruned.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
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
export const PROFILE_PATCH = DSH_ROOT + '/profiles/desktop/cordis.patch.yml';
export const STATE_FILE = DSH_ROOT + '/gemini-web-models.json';
const PROVIDER_KEY = 'gemini-web-agent';
const BRIDGE_API_KEY = 'sk-gemini-web';
const DEFAULT_PORT = 51130;
const UPSTREAM_PORT = 51131;

/**
 * Probes one candidate model directly against upstream (51131).
 * Passes ONLY on HTTP 200 with NO X-Model-Fallback downgrade.
 */
export async function verifyModel(probeUrl = 'http://127.0.0.1:' + UPSTREAM_PORT + '/v1', candidateModelId, timeoutMs = 35000) {
  const backendModel = resolveBackendModel(candidateModelId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(probeUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + BRIDGE_API_KEY },
      body: JSON.stringify({
        model: backendModel,
        messages: [{ role: 'user', content: '1' }],
        max_tokens: 3,
      }),
      signal: controller.signal,
    });
    const fallback = res.headers.get('X-Model-Fallback');
    const resolved = res.headers.get('X-Resolved-Model');
    if (!res.ok) {
      const transient = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
      const verdict = transient ? 'unstable' : res.status >= 400 && res.status < 500 ? 'locked' : 'unstable';
      return { ok: false, verdict, id: candidateModelId, backendModel, resolved, reason: 'HTTP ' + res.status };
    }
    if (fallback === 'true') {
      return {
        ok: false,
        verdict: 'downgraded',
        id: candidateModelId,
        backendModel,
        resolved,
        reason: '当前账号未解锁该模型权限（已降级至 ' + resolved + '）'
      };
    }
    const official = OFFICIAL_MODELS.find((m) => m.id === candidateModelId) || {};
    return {
      ok: true,
      verdict: 'ok',
      id: candidateModelId,
      backendModel,
      resolved,
      officialLabel: official.officialLabel,
      name: official.name,
      location: official.location,
      category: official.category
    };
  } catch (err) {
    return { ok: false, verdict: 'unstable', id: candidateModelId, backendModel, reason: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes candidate models sequentially with a safety gap.
 */
export async function scanModels(probeUrl = 'http://127.0.0.1:' + UPSTREAM_PORT + '/v1', gapMs = 1500, attempts = 2) {
  const results = [];
  for (const item of OFFICIAL_MODELS) {
    let r = await verifyModel(probeUrl, item.id);
    for (let i = 1; i < attempts && !r.ok && r.verdict === 'unstable'; i++) {
      await new Promise((res) => setTimeout(res, gapMs));
      r = await verifyModel(probeUrl, item.id);
    }
    results.push(r);
    await new Promise((res) => setTimeout(res, gapMs));
  }
  return results;
}

/**
 * Builds the clean, deduplicated gemini-web-agent provider block.
 * Uses official model IDs (gemini-4-hydrogen, etc.) which are routed by the bridge.
 */
export function buildProviderBlock(providerIndent, models, port = DEFAULT_PORT) {
  const pad = (n) => ' '.repeat(n);
  const child = providerIndent + 2;
  const out = [];
  out.push(pad(providerIndent) + PROVIDER_KEY + ':');
  out.push(pad(child) + 'api: openai-completions');
  out.push(pad(child) + 'baseURL: http://127.0.0.1:' + port + '/v1');
  out.push(pad(child) + 'apiKey: ' + BRIDGE_API_KEY);
  out.push(pad(child) + 'apiKeyEnv: GEMINI_WEB_AGENT_API_KEY');
  out.push(pad(child) + 'models:');

  const seen = new Set();
  for (const m of models) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const official = OFFICIAL_MODELS.find((o) => o.id === m.id) || {};
    const label = official.name || m.name || m.id;
    out.push(pad(child + 2) + '- id: ' + m.id);
    out.push(pad(child + 4) + 'name: "' + String(label).replace(/"/g, '\\"') + '"');
  }
  return out;
}

/**
 * Surgically replaces ONLY the gemini-web-agent provider subtree inside a YAML patch file.
 */
export function spliceProvider(filePath, models, port = DEFAULT_PORT) {
  const src = readFileSync(filePath, 'utf-8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const re = new RegExp('^( *)' + PROVIDER_KEY + ':\\s*$');
  let start = -1;
  let indent = 0;
  for (let i = 0; i < lines.length; i++) {
    const hit = re.exec(lines[i]);
    if (hit) { start = i; indent = hit[1].length; break; }
  }
  if (start < 0) return { ok: false, reason: 'provider "' + PROVIDER_KEY + '" not found in ' + filePath };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const ind = raw.match(/^ */)[0].length;
    if (ind <= indent) { end = i; break; }
  }
  const block = buildProviderBlock(indent, models, port);
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const merged = before.concat(block, after).join(eol);
  return { ok: true, filePath, replacedLines: end - start, newLines: block.length, merged, eol, startLine: start + 1 };
}

/**
 * Full cycle:
 * Strict Available-Only Principle: Only models with ok === true and verdict === 'ok' are kept.
 * Persists results to gemini-web-models.json and syncs to cordis.patch.yml.
 */
export async function refreshAndSyncModels(probeUrl = 'http://127.0.0.1:' + UPSTREAM_PORT + '/v1', opts = {}) {
  const apply = opts.apply === true;
  const results = await scanModels(probeUrl, opts.gapMs);

  // STRICT AVAILABLE-ONLY RULE:
  // Must have passed probe with HTTP 200 and NO fallback downgrade.
  const active = results.filter((r) => r.ok === true && r.verdict === 'ok');

  const report = {
    scannedAt: new Date().toISOString(),
    total: results.length,
    unlocked: active.length,
    models: results.map((r) => ({
      id: r.id,
      backendModel: r.backendModel,
      ok: r.ok,
      verdict: r.verdict,
      resolved: r.resolved || null,
      reason: r.reason || null,
      kept: active.some((a) => a.id === r.id),
    })),
  };

  if (!active.length) {
    return Object.assign(report, {
      applied: false,
      reason: 'No models currently verified as available. Refusing to write empty provider block.',
    });
  }

  const spliced = spliceProvider(PROFILE_PATCH, active, DEFAULT_PORT);
  if (!spliced.ok) return Object.assign(report, { applied: false, reason: spliced.reason });

  report.proposedBlock = buildProviderBlock(6, active, DEFAULT_PORT).join('\n');
  report.target = PROFILE_PATCH;

  // Persist state file
  writeFileSync(STATE_FILE, JSON.stringify(report, null, 2), 'utf-8');

  if (!apply) return Object.assign(report, { applied: false, dryRun: true });

  copyFileSync(PROFILE_PATCH, PROFILE_PATCH + '.bak-gemini-sync');
  writeFileSync(PROFILE_PATCH, spliced.merged, 'utf-8');

  return Object.assign(report, { applied: true, backup: PROFILE_PATCH + '.bak-gemini-sync' });
}

// CLI: node lib/scanner.js [--apply]
if (process.argv[1] && /scanner\.js$/.test(process.argv[1])) {
  const apply = process.argv.includes('--apply');
  refreshAndSyncModels(undefined, { apply })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error('scan failed: ' + (e && e.message));
      process.exit(1);
    });
}
