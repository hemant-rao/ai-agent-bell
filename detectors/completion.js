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
    opencode: ['session.idle'],
    claude: ['Stop'],
    codex: ['Stop'],
  },
};
