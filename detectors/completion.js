'use strict';

// Detector: task / turn completed. Steady, friendly chime.
module.exports = {
  id: 'complete',
  title: 'Task complete',
  description: 'Fired when the agent finishes a task or turn.',
  pattern: 'steady', // one even beep per round
  freq: 1000,
  freqAlt: 1000,
  gapMs: 200,
  sounds: {
    mac: 'Glass.aiff',
    linux: 'complete.oga',
  },
  matches: {
    // NOTE: 'session.status' fires for EVERY busy/idle/retry transition, so
    // forToolEvent() guards it to idle-only (see detectors/index.js).
    // Without that guard a mid-task busy->... transition would ring "complete".
    opencode: ['session.idle', 'session.status'],
    claude: ['Stop'],
    codex: ['Stop'],
  },
};
