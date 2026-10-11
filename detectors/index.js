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
 * @param {string|object} typeOrEvent native event name (e.g. 'session.idle')
 *   or the full event object ({ type, properties })
 * @param {object} [extraProps] event properties when only the type string is passed
 * @returns detector or null when the event needs no alarm
 */
function forToolEvent(tool, typeOrEvent, extraProps) {
  let type = null;
  let props = null;
  if (typeOrEvent && typeof typeOrEvent === 'object') {
    type = typeOrEvent.type || null;
    props = typeOrEvent.properties || extraProps || null;
  } else {
    type = typeOrEvent || null;
    props = extraProps || null;
  }
  if (!type) return null;
  if (tool === 'opencode' && type === 'session.status') {
    // Fires for EVERY busy/idle/retry transition — only idle means "done".
    // A mid-task busy transition must never ring "complete".
    const st = props && props.status;
    const s = typeof st === 'string' ? st : st && st.type;
    return s === 'idle' ? BY_ID.complete : null;
  }
  if (tool === 'opencode' && type === 'tool.execute.before') {
    // Fires before EVERY tool run — only the question tool means "answer me".
    const t = props && (props.tool !== undefined ? props.tool : props.toolName !== undefined ? props.toolName : props.name);
    const n = typeof t === 'string' ? t : t && (t.id || t.name);
    return n === 'question' ? BY_ID.question : null;
  }
  return ALL.find((d) => (d.matches[tool] || []).includes(type)) || null;
}

module.exports = { ALL, BY_ID, EVENTS, byId, forToolEvent };
