'use strict';

// User settings: HOW MANY TIMES the alarm rings, and whether the Windows
// global click/key watcher may run.
// File: ~/.config/ai-agent-bell/config.json
//   e.g. { "times": 8, "keyStop": true }
// The user edits this file (or runs `ai-agent-bell config ...`) once,
// and every hook on every tool honours it — no re-setup needed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_TIMES = 5;
const MIN_TIMES = 1;
const MAX_TIMES = 30;
const DEFAULT_KEY_STOP = true;

function configPath() {
  return path.join(os.homedir(), '.config', 'ai-agent-bell', 'config.json');
}

function clampTimes(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_TIMES;
  return Math.min(MAX_TIMES, Math.max(MIN_TIMES, n));
}

/** Read the file. Missing/corrupt file => defaults (never throws). */
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const times = raw && raw.times !== undefined ? clampTimes(raw.times) : DEFAULT_TIMES;
    // Only an explicit `false` disables the watcher; missing/unknown values
    // keep the historical default (on), so old config files behave the same.
    const keyStop = raw && raw.keyStop === false ? false : DEFAULT_KEY_STOP;
    return { times, keyStop };
  } catch (_) {
    return { times: DEFAULT_TIMES, keyStop: DEFAULT_KEY_STOP };
  }
}

/**
 * Persist the user's choice. Returns the repeat count (same as before).
 * `keyStop` is optional; when omitted the current value is preserved.
 * Throws EINVAL when the repeat count is out of range.
 */
function save(times, keyStop) {
  const n = Number(times);
  if (!Number.isInteger(n) || n < MIN_TIMES || n > MAX_TIMES) {
    const err = new Error(`times must be a whole number ${MIN_TIMES}..${MAX_TIMES}`);
    err.code = 'EINVAL';
    throw err;
  }
  const current = load();
  const nextKeyStop = keyStop === undefined ? current.keyStop : keyStop !== false;
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ times: n, keyStop: nextKeyStop }, null, 2) + '\n');
  return n;
}

/** One-shot CLI flag wins, otherwise the file, otherwise the default. */
function resolveTimes(cliTimes) {
  if (cliTimes !== undefined && cliTimes !== null) return clampTimes(cliTimes);
  return load().times;
}

module.exports = {
  DEFAULT_TIMES,
  MIN_TIMES,
  MAX_TIMES,
  DEFAULT_KEY_STOP,
  configPath,
  clampTimes,
  load,
  save,
  resolveTimes,
};
