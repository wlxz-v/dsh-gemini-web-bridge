// lib/supervisor.js — manages the native gemini-web2api sidecar (port 51131) and the intelligent proxy (port 51130)

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { refreshTokensLive } from './token-refresher.js';
import { startProxyServer } from './proxy.js';

const DEFAULT_PROXY_PORT = 51130;
const DEFAULT_UPSTREAM_PORT = 51131;

let sidecarProcess = null;
let proxyServerInstance = null;
let watchdogTimer = null;
let isStopping = false;

/**
 * Checks if a port is responding to HTTP requests.
 */
export async function isPortHealthy(port = DEFAULT_PROXY_PORT) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Checks if upstream daemon on 51131 is responding.
 */
export async function isUpstreamHealthy(port = DEFAULT_UPSTREAM_PORT) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Starts the native binary on upstream port (51131) and the intelligent proxy on proxy port (51130).
 */
export async function startSidecar(binDir, proxyPort = DEFAULT_PROXY_PORT, upstreamPort = DEFAULT_UPSTREAM_PORT) {
  isStopping = false;

  const exePath = join(binDir, 'gemini-web2api.exe');
  const configPath = join(binDir, 'config.json');

  if (!existsSync(exePath)) {
    return { ok: false, error: `Executable not found at ${exePath}` };
  }

  // 1. Ensure Upstream daemon on 51131 is running
  const upstreamRunning = await isUpstreamHealthy(upstreamPort);
  if (!upstreamRunning) {
    try {
      console.log('[gemini-web-bridge] Refreshing live session tokens before spawn...');
      await refreshTokensLive();
    } catch (err) {
      console.warn('[gemini-web-bridge] Token refresh warning:', err.message);
    }

    try {
      sidecarProcess = spawn(exePath, ['--config', configPath], {
        cwd: binDir,
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });

      sidecarProcess.unref();
      console.log(`[gemini-web-bridge] Spawned upstream daemon (PID: ${sidecarProcess.pid}) on :${upstreamPort}`);

      // Wait up to 6s for upstream to be ready
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isUpstreamHealthy(upstreamPort)) {
          console.log(`[gemini-web-bridge] Upstream listening on http://127.0.0.1:${upstreamPort}`);
          break;
        }
      }
    } catch (err) {
      console.error(`[gemini-web-bridge] Failed to spawn upstream daemon:`, err.message);
      return { ok: false, error: err.message };
    }
  } else {
    console.log(`[gemini-web-bridge] Upstream on port ${upstreamPort} is already healthy.`);
  }

  // 2. Ensure Intelligent Proxy on 51130 is running
  const proxyRunning = await isPortHealthy(proxyPort);
  if (!proxyRunning && !proxyServerInstance) {
    try {
      proxyServerInstance = await startProxyServer(proxyPort, upstreamPort);
      console.log(`[gemini-web-bridge] Intelligent proxy running on http://127.0.0.1:${proxyPort}`);
    } catch (err) {
      console.error(`[gemini-web-bridge] Failed to start proxy on port ${proxyPort}:`, err.message);
    }
  } else if (proxyRunning) {
    console.log(`[gemini-web-bridge] Port ${proxyPort} is already listening.`);
  }

  // 3. Start Watchdog
  startWatchdog(binDir, proxyPort, upstreamPort);

  return {
    ok: true,
    proxyPort,
    upstreamPort,
    pid: sidecarProcess ? sidecarProcess.pid : undefined,
  };
}

/**
 * Watchdog daemon: checks health every 20s and auto-respawns / renews token if dropped.
 */
function startWatchdog(binDir, proxyPort = DEFAULT_PROXY_PORT, upstreamPort = DEFAULT_UPSTREAM_PORT) {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(async () => {
    if (isStopping) return;

    // Check upstream
    const upOk = await isUpstreamHealthy(upstreamPort);
    if (!upOk) {
      console.warn(`[gemini-web-bridge watchdog] Upstream :${upstreamPort} is down! Auto-healing...`);
      await startSidecar(binDir, proxyPort, upstreamPort);
    }

    // Check proxy
    const proxyOk = await isPortHealthy(proxyPort);
    if (!proxyOk && !proxyServerInstance) {
      try {
        proxyServerInstance = await startProxyServer(proxyPort, upstreamPort);
      } catch (err) {
        console.warn(`[gemini-web-bridge watchdog] Proxy restart error:`, err.message);
      }
    }
  }, 20000);
}

export function stopSidecar() {
  isStopping = true;
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  if (proxyServerInstance) {
    try {
      proxyServerInstance.close();
    } catch {}
    proxyServerInstance = null;
  }
  if (sidecarProcess) {
    try {
      sidecarProcess.kill();
    } catch {}
    sidecarProcess = null;
  }
}
