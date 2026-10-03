'use strict';

// Detector: the agent run failed. Low double-beep, clearly "bad news".
module.exports = {
  id: 'error',
  title: 'Task failed',
  description: 'Fired when the agent run ends with an error.',
  pattern: 'double', // two short low beeps per round
  freq: 450,
  freqAlt: 450,
  gapMs: 350,
  sounds: {
    mac: 'Basso.aiff',
    linux: 'dialog-error.oga',
  },
  matches: {
    opencode: ['session.error'],
    claude: ['StopFailure'],
    codex: [],
  },
};
