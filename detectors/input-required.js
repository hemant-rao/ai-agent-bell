'use strict';

// Detector: the agent needs input (question, approval, permission).
// Urgent two-tone siren so it is impossible to confuse with "complete".
module.exports = {
  id: 'question',
  title: 'Input needed',
  description: 'Fired when the agent asks a question or waits for approval.',
  pattern: 'urgent', // alternating high/low beeps per round
  freq: 1250,
  freqAlt: 1750,
  gapMs: 150,
  sounds: {
    mac: 'Ping.aiff',
    linux: 'dialog-question.oga',
  },
  matches: {
    opencode: ['permission.asked'],
    claude: ['Notification'],
    codex: ['PermissionRequest'],
  },
};
