// lib/server.js — Standalone runner for the Gemini Web Bridge (Supervisor + Proxy)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSidecar } from './supervisor.js';
import { refreshAndSyncModels } from './scanner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, '..', 'bin');

console.log('[gemini-web-bridge] Starting supervisor and intelligent proxy...');
startSidecar(BIN_DIR, 51130, 51131)
  .then(async (res) => {
    console.log('[gemini-web-bridge] Service active:', res);
    try {
      console.log('[gemini-web-bridge] Running initial available-only model discovery...');
      const report = await refreshAndSyncModels('http://127.0.0.1:51130/v1', { apply: true });
      console.log(`[gemini-web-bridge] Models synced: ${report.unlocked}/${report.total} available.`);
    } catch (e) {
      console.warn('[gemini-web-bridge] Initial model sync warning:', e.message);
    }
  })
  .catch((err) => {
    console.error('[gemini-web-bridge] Fatal bootstrap error:', err);
    process.exit(1);
  });
