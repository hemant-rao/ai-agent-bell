'use strict';

// Detector: warning worth a look, but not idle and not failed.
// Slow spaced beeps. Mostly triggered manually:
//   ai-agent-bell --event warning
module.exports = {
  id: 'warning',
  title: 'Warning',
  description: 'Fired manually when something deserves attention.',
  pattern: 'slow', // one beep per round with a long pause
  freq: 800,
  freqAlt: 800,
  gapMs: 600,
  sounds: {
    mac: 'Funk.aiff',
    linux: 'dialog-warning.oga',
  },
  matches: {
    opencode: [],
    claude: [],
    codex: [],
  },
};
