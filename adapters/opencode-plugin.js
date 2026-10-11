/**
 * ai-agent-bell — standalone global opencode plugin.
 *
 * Installed by `ai-agent-bell setup` to ~/.config/opencode/plugins/ai-agent-bell.js
 * (auto-loaded, no opencode.json edit needed). This file must stay
 * SELF-CONTAINED: it is copied out of the package, so it cannot import
 * sibling files. Event mapping mirrors detectors/ (source of truth).
 *
 * Module shape matters: opencode calls EVERY export as a plugin factory and
 * drops the whole file when any export is not a function. So this file has
 * exactly ONE export (TaskAlarm, ESM) and must never use CJS-style exports.
 * (A CJS-shaped copy fails to load with "Plugin export is not a function" —
 * probed on opencode 1.18.x.)
 *
 * Strategy: spawn the real CLI with node (baked absolute paths below) so the
 * full engine runs — detectors, distinct sounds, config-file repeat count,
 * click-to-stop. node is never the hosting process binary: inside opencode
 * that is the opencode binary itself, which cannot run JS. If the CLI cannot
 * be spawned, a small inline fallback beeps.
 */

import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Replaced by setup with absolute paths (JSON strings). A hand-copied file
// keeps the harmless placeholder strings: cliAvailable() is then false and
// nodeBin() falls back to 'node' from PATH.
const CLI_JS = '__CLI_ABS_PATH__';
const NODE_BIN = '__NODE_BIN_PATH__';

const KIND_BY_EVENT = {
  'session.idle': 'complete',
  'session.error': 'error',
  'permission.asked': 'question',
  'question.asked': 'question',
};

const FALLBACK_FREQ = { complete: 1000, question: 1400, error: 450, warning: 800 };

function readTimes() {
  try {
    const file = path.join(os.homedir(), '.config', 'ai-agent-bell', 'config.json');
    const n = Math.floor(Number(JSON.parse(fs.readFileSync(file, 'utf8')).times));
    if (Number.isInteger(n) && n >= 1 && n <= 30) return n;
  } catch (_) {
    /* missing/corrupt config -> default */
  }
  return 5;
}

function nodeBin() {
  // The baked path is setup's own node (guaranteed to run the CLI).
  // Anything else (hand-copied file, deleted runtime) falls back to PATH.
  try {
    if (typeof NODE_BIN === 'string' && /node(\.exe)?$/i.test(NODE_BIN) && fs.existsSync(NODE_BIN)) {
      return NODE_BIN;
    }
  } catch (_) {
    /* fall through to PATH lookup */
  }
  return 'node';
}

function fallbackBeep(kind) {
  // Fire-and-forget inline beeps: the event handler must never block for
  // the whole alarm. Never hides or minimizes any window.
  try {
    const n = readTimes();
    const f = FALLBACK_FREQ[kind] || 1000;
    const script =
      kind === 'question'
        ? `for ($i=0; $i -lt ${n}; $i++) { [console]::beep(1250,280); [console]::beep(1750,280); Start-Sleep -Milliseconds 150 }`
        : kind === 'error'
          ? `for ($i=0; $i -lt ${n}; $i++) { [console]::beep(${f},220); Start-Sleep -Milliseconds 150; [console]::beep(${f},220); Start-Sleep -Milliseconds 350 }`
          : `for ($i=0; $i -lt ${n}; $i++) { [console]::beep(${f},700); Start-Sleep -Milliseconds 200 }`;
    const child = cp.spawn('powershell', ['-NoProfile', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (child && typeof child.unref === 'function') child.unref();
  } catch (_) {
    try {
      process.stdout.write('\x07'.repeat(3));
    } catch (_) {}
  }
}

function cliAvailable() {
  // The placeholder below is replaced by setup; a hand-copied file keeps a
  // value that never ends with the CLI name, so we fall back to beeps.
  try {
    return typeof CLI_JS === 'string' && CLI_JS.endsWith('ai-agent-bell.js') && fs.existsSync(CLI_JS);
  } catch (_) {
    return false;
  }
}

function alarm(kind) {
  if (!cliAvailable()) {
    fallbackBeep(kind);
    return;
  }
  try {
    const child = cp.spawn(nodeBin(), [CLI_JS, '--event', kind], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    // Async spawn failures (node missing from PATH) never throw here —
    // without this handler the alarm would die silently.
    if (child && typeof child.on === 'function') {
      child.on('error', () => {
        try {
          fallbackBeep(kind);
        } catch (_) {}
      });
    }
    if (child && typeof child.unref === 'function') child.unref();
  } catch (_) {
    fallbackBeep(kind);
  }
}

export async function TaskAlarm() {
  return {
    event: async ({ event }) => {
      const kind = KIND_BY_EVENT[event && event.type];
      if (!kind) return;
      try {
        alarm(kind);
      } catch (_) {
        fallbackBeep(kind);
      }
    },
  };
}
