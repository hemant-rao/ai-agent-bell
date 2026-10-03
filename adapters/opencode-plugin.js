'use strict';

/**
 * ai-agent-bell — standalone global opencode plugin.
 *
 * Installed by `ai-agent-bell setup` to ~/.config/opencode/plugins/ai-agent-bell.js
 * (auto-loaded, no opencode.json edit needed). This file must stay
 * SELF-CONTAINED: it is copied out of the package, so it cannot require()
 * sibling files. Event mapping mirrors detectors/ (source of truth).
 *
 * Strategy: detached-spawn the real CLI (baked absolute path below) so the
 * full engine runs — detectors, distinct sounds, config-file repeat count,
 * click-to-stop. If the CLI is missing, a small inline fallback beeps.
 */

// Replaced by setup with the absolute CLI path (JSON string). If this file was
// copied by hand and the token is still here, spawn fails and the fallback runs.
const CLI_JS = '__CLI_ABS_PATH__';

const KIND_BY_EVENT = {
  'session.idle': 'complete',
  'session.error': 'error',
  'permission.asked': 'question',
};

const FALLBACK_FREQ = { complete: 1000, question: 1400, error: 450, warning: 800 };

function readTimes() {
  try {
    const path = require('path');
    const os = require('os');
    const fs = require('fs');
    const file = path.join(os.homedir(), '.config', 'ai-agent-bell', 'config.json');
    const n = Math.floor(Number(JSON.parse(fs.readFileSync(file, 'utf8')).times));
    if (Number.isInteger(n) && n >= 1 && n <= 30) return n;
  } catch (_) {
    /* missing/corrupt config -> default */
  }
  return 10;
}

function fallbackBeep(kind) {
  try {
    const cp = require('child_process');
    const n = readTimes();
    const f = FALLBACK_FREQ[kind] || 1000;
    const script =
      kind === 'question'
        ? `for ($i=0; $i -lt ${n}; $i++) { [console]::beep(1250,280); [console]::beep(1750,280); Start-Sleep -Milliseconds 150 }`
        : kind === 'error'
          ? `for ($i=0; $i -lt ${n}; $i++) { [console]::beep(${f},220); Start-Sleep -Milliseconds 150; [console]::beep(${f},220); Start-Sleep -Milliseconds 350 }`
          : `for ($i=0; $i -lt ${n}; $i++) { [console]::beep(${f},700); Start-Sleep -Milliseconds 200 }`;
    cp.execFileSync('powershell', ['-NoProfile', '-Command', script], {
      stdio: 'ignore',
      timeout: (n * 3 + 10) * 1000,
      windowsHide: true,
    });
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
    return typeof CLI_JS === 'string' && CLI_JS.endsWith('ai-agent-bell.js') && require('fs').existsSync(CLI_JS);
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
    const cp = require('child_process');
    const child = cp.spawn(process.execPath, [CLI_JS, '--event', kind], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch (_) {
    fallbackBeep(kind);
  }
}

async function TaskAlarm() {
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

module.exports = { TaskAlarm };
