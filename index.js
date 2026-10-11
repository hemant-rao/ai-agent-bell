/**
 * ai-agent-bell — npm plugin entry for opencode.
 *
 * Usage in opencode.json (any project, or global ~/.config/opencode/opencode.jsonc):
 *   { "$schema": "https://opencode.ai/config.json", "plugin": ["ai-agent-bell"] }
 *
 * Dispatches to the shared engine (detectors/ + notifications/) via lib/alarm.
 * Fire-and-forget, plugin-safe: quiet (the TUI already shows state) and
 * keyStop:false (never steals keys from the opencode TUI).
 * Sound-only side effect. No project files touched, nothing added to builds.
 *
 * Module shape matters: opencode calls EVERY export as a plugin factory and
 * drops the whole file when any export is not a function. So this file has
 * exactly ONE export (TaskAlarm, ESM) and must never use CJS-style exports.
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
  return (props && (props.sessionID || props.sessionId || info.sessionID || info.id)) || '';
}

export async function TaskAlarm() {
  return {
    event: async ({ event }) => {
      const type = event && event.type;
      if (!type) return;
      const props = (event && event.properties) || {};
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
    },
  };
}
