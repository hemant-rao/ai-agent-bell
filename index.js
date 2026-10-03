'use strict';

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
 */

const detectors = require('./detectors');
const { playAlarm } = require('./lib/alarm');

async function TaskAlarm() {
  return {
    event: async ({ event }) => {
      const det = detectors.forToolEvent('opencode', event && event.type);
      if (!det) return;
      playAlarm({ event: det.id, quiet: true, keyStop: false }).catch(() => {});
    },
  };
}

module.exports = { TaskAlarm };
