'use strict';

// Orchestrator: detector -> terminal + desktop + sound.
// All callers (CLI, opencode plugin) come through here.

const detectors = require('../detectors');
const config = require('./config');
const sound = require('../notifications/sound');
const desktop = require('../notifications/desktop');
const terminal = require('../notifications/terminal');

/**
 * @param {{ event?: string, times?: number, quiet?: boolean, keyStop?: boolean }} opts
 * @returns Promise<{ event: string, times: number, stoppedEarly: boolean }>
 */
async function playAlarm(opts = {}) {
  const detector = detectors.byId(opts.event) || detectors.byId('complete');
  const n = config.resolveTimes(opts.times);
  if (!opts.quiet) terminal.announce(detector.title, n);
  terminal.bell(2);
  desktop.toast('AI Agent Bell', `${detector.title} — check your terminal`);
  const res = await sound.playSound(detector, n, { keyStop: opts.keyStop });
  terminal.bell(1);
  return { event: detector.id, times: n, stoppedEarly: res.stoppedEarly };
}

// Backwards-compatible event map (same shape as before the detectors/ split).
const EVENTS = detectors.EVENTS;

module.exports = { playAlarm, EVENTS };
