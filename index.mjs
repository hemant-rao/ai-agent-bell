/**
 * ai-agent-bell — npm plugin entry for opencode.
 *
 * Usage in opencode.json (any project, or global ~/.config/opencode/opencode.jsonc):
 *   V2 (opencode 2.x):  { "$schema": "https://opencode.ai/config.json", "plugins": ["ai-agent-bell"] }
 *   V1 (opencode 1.18.29+): same value under the old "plugin" key.
 *
 * Dispatches to the shared engine (detectors/ + notifications/) via lib/alarm.
 * Fire-and-forget, plugin-safe: quiet (the TUI already shows state) and
 * keyStop:false (never steals keys from the opencode TUI).
 * Sound-only side effect. No project files touched, nothing added to builds.
 *
 * Module shape (probed on opencode 2.0.32): the server reads the DEFAULT
 * export and requires a definition with an `id` plus an `effect` or `setup`
 * function; a V1-style named export fails with "Plugin must export a default
 * definition with an id and an effect or setup function." Events arrive via
 * ctx.event.subscribe() with the payload on event.data (V1 hooks used
 * event.properties). The server() method keeps 1.18.29+ working, which calls
 * object entrypoints' server().
 */

// NOTE: default imports (not destructured) so the bindings always resolve
// through the CJS module objects at call time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import detectors from './detectors/index.js';
import alarmLib from './lib/alarm.js';

// Subagent (Task-tool child) sessions emit completion/error events identical
// to the main session's (2.x: session.execution.succeeded/failed) while the
// main task still runs — ringing for them is the "mid-task alarm" bug.
// Learned from session.created/session.updated, which carry parentID
// (the execution events do not). Mirrors the guards in
// adapters/opencode-plugin.js (that file is self-contained, so logic is
// duplicated, not imported — keep both in sync).
const CHILD_SESSIONS = new Set();
const COOLDOWN_MS = { complete: 15000, question: 3000, error: 3000, warning: 0 };

// Cooldown per (kind + session): kills double-fires — 1.x 'session.idle' +
// 'session.status' for the SAME completion, and the same 2.x event seen by
// the several plugin instances opencode 2.x runs per server (4 observed on
// 2.0.32). In-memory timers only dedup one instance, so the claim lives in
// exclusive lock files under the OS temp dir: the first instance rings, the
// others see a fresh claim and stay silent (mirrors the adapter copy).
function cooledDown(kind, sid) {
  const ms = COOLDOWN_MS[kind] || 0;
  if (ms <= 0) return false;
  const dir = path.join(os.tmpdir(), 'ai-agent-bell-locks');
  const lock = path.join(
    dir,
    kind + '-' + (String(sid || 'none').replace(/[^\w-]/g, '') || 'none') + '.lock'
  );
  const now = Date.now();
  const claim = () => {
    try {
      fs.writeFileSync(lock, String(now), { flag: 'wx' }); // atomic create
      return true;
    } catch (e) {
      // EEXIST = another instance holds a claim; any other fs error must
      // never mute the bell.
      return !e || e.code !== 'EEXIST';
    }
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (claim()) return false;
    let age = null;
    try {
      age = now - fs.statSync(lock).mtimeMs;
    } catch (_) {
      /* vanished between claim and stat */
    }
    if (age !== null && age < ms) return true; // another instance rang just now
    if (age === null) return !claim(); // lock vanished: retry the claim
    // Stale claim: take it over via an atomic rename so exactly one instance
    // wins even when several race here.
    const tomb = lock + '.' + process.pid + '.' + Math.random().toString(36).slice(2);
    try {
      fs.renameSync(lock, tomb);
      try {
        fs.unlinkSync(tomb);
      } catch (_) {}
    } catch (_) {
      return true; // another instance took over — it rings instead
    }
    return !claim();
  } catch (_) {
    return false; // lock dir unusable: never mute the bell
  }
}

function sessionIdOf(props) {
  const info = (props && props.info) || {};
  const form = (props && props.form) || {};
  return (
    (props && (props.sessionID || props.sessionId || info.sessionID || info.id || form.sessionID)) || ''
  );
}

function handleEvent(event) {
  const type = event && event.type;
  if (!type) return;
  const props = (event && (event.data || event.properties)) || {};
  if (type === 'session.created' || type === 'session.updated') {
    const info = props.info || {};
    const sid = sessionIdOf(props);
    const pid = props.parentID || props.parentId || info.parentID || info.parentId || '';
    if (sid && pid) CHILD_SESSIONS.add(sid);
    return;
  }
  const det = detectors.forToolEvent('opencode', event);
  if (!det) return;
  const sid = sessionIdOf(props);
  if ((det.id === 'complete' || det.id === 'error') && sid && CHILD_SESSIONS.has(sid)) return;
  if (cooledDown(det.id, sid)) return;
  alarmLib.playAlarm({ event: det.id, quiet: true, keyStop: false }).catch(() => {});
}

export default {
  id: 'ai-agent-bell',
  setup(ctx) {
    // opencode 2.x: subscribe to the server event stream. The loop must not
    // die on a stream hiccup (the bell would go silent), so it resubscribes
    // until the plugin unloads via the returned cleanup.
    if (!ctx || !ctx.event || typeof ctx.event.subscribe !== 'function') return undefined;
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            handleEvent(event);
          }
        } catch (_) {
          /* stream ended or aborted */
        }
        if (!controller.signal.aborted) await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return () => controller.abort();
  },
  // opencode 1.18.29+ object entrypoint: same guards, V1 event shape.
  async server() {
    return {
      event: async ({ event }) => handleEvent(event),
    };
  },
};
