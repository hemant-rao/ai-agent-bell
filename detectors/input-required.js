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
    // NOTE: 'tool.execute.before' fires before EVERY tool run, so
    // forToolEvent() guards it to the question tool only (see detectors/index.js).
    // 'form.created' is the 2.x question/elicitation form; 'question.asked' and
    // 'permission.updated' are legacy 1.x events kept for old opencode versions.
    opencode: [
      'permission.asked',
      'form.created',
      'permission.updated',
      'question.asked',
      'tool.execute.before',
    ],
    claude: ['Notification'],
    codex: ['PermissionRequest'],
  },
};
