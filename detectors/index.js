'use strict';

// Registry: single source of truth for every detector.
// The CLI, the opencode plugin and `setup` all resolve through here,
// so tool-event wiring can never drift between them.

const completion = require('./completion');
const inputRequired = require('./input-required');
const error = require('./error');
const warning = require('./warning');

const ALL = [completion, inputRequired, error, warning];
const BY_ID = Object.fromEntries(ALL.map((d) => [d.id, d]));

// Backwards-compatible map for callers that used EVENTS from lib/alarm.
const EVENTS = Object.fromEntries(ALL.map((d) => [d.id, d]));

function byId(id) {
  return BY_ID[id] || null;
}

/**
 * Resolve which detector owns a native tool event.
 * @param {'opencode'|'claude'|'codex'} tool
 * @param {string} type native event name, e.g. 'session.idle'
 * @returns detector or null when the event needs no alarm
 */
function forToolEvent(tool, type) {
  if (!type) return null;
  return ALL.find((d) => (d.matches[tool] || []).includes(type)) || null;
}

module.exports = { ALL, BY_ID, EVENTS, byId, forToolEvent };
