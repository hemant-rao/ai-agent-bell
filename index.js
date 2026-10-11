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

export async function TaskAlarm() {
  return {
    event: async ({ event }) => {
      const det = detectors.forToolEvent('opencode', event && event.type);
      if (!det) return;
      alarmLib.playAlarm({ event: det.id, quiet: true, keyStop: false }).catch(() => {});
    },
  };
}
