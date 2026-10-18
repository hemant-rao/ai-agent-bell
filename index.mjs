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
import detectors from './detectors/index.js';
import alarmLib from './lib/alarm.js';

// Subagent (Task-tool child) sessions emit idle/error events identical to the
// main session's while the main task still runs — ringing for them is the
// "mid-task alarm" bug. Learned from session.created/session.updated, which
// carry parentID (session.status/session.idle do not). Mirrors the guards in
// adapters/opencode-plugin.js (that file is self-contained, so logic is
// duplicated, not imported — keep both in sync).
const CHILD_SESSIONS = new Set();
const LAST_RING_MS = new Map();
const COOLDOWN_MS = { complete: 15000, question: 3000, error: 3000, warning: 0 };

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
  const cd = COOLDOWN_MS[det.id] || 0;
  if (cd > 0) {
    const key = det.id + ':' + (sid || '-');
    const now = Date.now();
    if (now - (LAST_RING_MS.get(key) || 0) < cd) return;
    LAST_RING_MS.set(key, now);
  }
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
