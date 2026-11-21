// lib/token-refresher.js — automatically fetches the live SNlM0e and bl from gemini.google.com via python helper

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = join(__dirname, 'refresh_tokens.py');

export function refreshTokensLive() {
  return new Promise((resolve, reject) => {
    execFile('python', [HELPER_PATH], (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      try {
        const data = JSON.parse(stdout.trim());
        resolve(data);
      } catch (e) {
        reject(new Error(`Failed to parse token refresher output: ${stdout}`));
      }
    });
  });
}
