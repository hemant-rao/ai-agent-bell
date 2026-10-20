/**
 * ai-agent-bell — standalone global opencode plugin.
 *
 * Installed by `ai-agent-bell setup` to ~/.config/opencode/plugins/ai-agent-bell.js
 * (auto-loaded, no opencode.json edit needed). This file must stay
 * SELF-CONTAINED: it is copied out of the package, so it cannot import
 * sibling files. Event mapping mirrors detectors/ (source of truth).
 *
 * Module shape (probed on opencode 2.0.32): the server reads the DEFAULT
 * export and requires a definition with an `id` plus an `effect` or `setup`
 * function. A V1-style named export drops the whole file with
 * "Plugin must export a default definition with an id and an effect or setup
 * function." Events arrive through ctx.event.subscribe(); on 2.x the payload
 * sits on event.data. The extra server() method keeps this same file working
 * on opencode 1.18.29+, which calls an object entrypoint's server() and
 * delivers events with the payload on event.properties.
 *
 * Strategy: spawn the real CLI with node (baked absolute paths below) so the
 * full engine runs — detectors, distinct sounds, config-file repeat count,
 * click-to-stop. node is never the hosting process binary: inside opencode
 * that is the opencode binary itself, which cannot run JS. If the CLI cannot
 * be spawned, a small inline fallback beeps.
 */

import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Replaced by setup with absolute paths (JSON strings). A hand-copied file
// keeps the harmless placeholder strings: cliAvailable() is then false and
// nodeBin() falls back to 'node' from PATH.
const CLI_JS = '__CLI_ABS_PATH__';
const NODE_BIN = '__NODE_BIN_PATH__';

const KIND_BY_EVENT = {
  'session.execution.succeeded': 'complete', // 2.x: execution (turn) finished
  'session.execution.failed': 'error', // 2.x: execution (turn) failed
  'session.idle': 'complete', // legacy 1.x idle signal
  'session.error': 'error', // legacy 1.x error signal
  'permission.asked': 'question',
  'form.created': 'question', // 2.x question/elicitation form — user must answer
  'permission.updated': 'question', // legacy 1.x event, kept for server()
  'question.asked': 'question', // legacy 1.x event, kept for server()
};
// NOTE: 'session.status' (busy/idle/...) and 'tool.execute.before' (every tool)
// are resolved in the event handler with property guards — never here — so a
// mid-task busy transition or a non-question tool can never ring.

// Cooldown per (kind + session): kills double-fires — 1.x 'session.idle' +
// 'session.status' for the SAME completion, and the same 2.x event seen by
// the several plugin instances opencode 2.x runs per server (4 observed on
// 2.0.32). In-memory timers only dedup one instance, so the claim lives in
// exclusive lock files under the OS temp dir: the first instance rings, the
// others see a fresh claim and stay silent. Question/error keep a short
// fuse: the user must act every time.
const COOLDOWN_MS = { complete: 15000, question: 3000, error: 3000, warning: 0 };

// Child (Task-tool subagent) sessions. Their idle/error events are
// structurally identical to the main session's (upstream opencode issue:
// session.status/session.idle carry no parentID), but the main task is still
// running — ringing for them is exactly the "mid-task alarm" bug. Child ids
// are learned from session.created/session.updated, which DO carry parentID.
const CHILD_SESSIONS = new Set();

function propsOf(event) {
  // 2.x: payload on event.data. 1.x: payload on event.properties.
  return (event && (event.data || event.properties)) || {};
}

function sessionIdOf(props) {
  const info = (props && props.info) || {};
  const form = (props && props.form) || {};
  return props.sessionID || props.sessionId || info.sessionID || info.id || form.sessionID || '';
}

function statusOf(props) {
  const st = props && props.status;
  return typeof st === 'string' ? st : (st && st.type) || '';
}

function toolNameOf(props) {
  const t =
    props.tool !== undefined ? props.tool : props.toolName !== undefined ? props.toolName : props.name;
  return typeof t === 'string' ? t : (t && (t.id || t.name)) || '';
}

function noteChildSession(props) {
  const info = (props && props.info) || {};
  const sid = sessionIdOf(props);
  const pid = props.parentID || props.parentId || info.parentID || info.parentId || '';
  if (sid && pid) CHILD_SESSIONS.add(sid);
}

function cooledDown(kind, sid) {
  const ms = COOLDOWN_MS[kind] || 0;
  if (ms <= 0) return false;
  const dir = path.join(os.tmpdir(), 'ai-agent-bell-locks');
  const lock = path.join(
    dir,
    kind + '-' + (String(sid || 'none').replace(/[^\w-]/g, '') || 'none') + '.lock'
  );
  const now = Date.now();
  const claim = () => {
    try {
      fs.writeFileSync(lock, String(now), { flag: 'wx' }); // atomic create
      return true;
    } catch (e) {
      // EEXIST = another instance holds a claim; any other fs error must
      // never mute the bell.
      return !e || e.code !== 'EEXIST';
    }
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (claim()) return false;
    let age = null;
    try {
      age = now - fs.statSync(lock).mtimeMs;
    } catch (_) {
      /* vanished between claim and stat */
    }
    if (age !== null && age < ms) return true; // another instance rang just now
    if (age === null) return !claim(); // lock vanished: retry the claim
    // Stale claim: take it over via an atomic rename so exactly one instance
    // wins even when several race here.
    const tomb = lock + '.' + process.pid + '.' + Math.random().toString(36).slice(2);
    try {
      fs.renameSync(lock, tomb);
      try {
        fs.unlinkSync(tomb);
      } catch (_) {}
    } catch (_) {
      return true; // another instance took over — it rings instead
    }
    return !claim();
  } catch (_) {
    return false; // lock dir unusable: never mute the bell
  }
}

const FALLBACK_FREQ = { complete: 1000, question: 1400, error: 450, warning: 800 };

function readTimes() {
  try {
    const file = path.join(os.homedir(), '.config', 'ai-agent-bell', 'config.json');
    const n = Math.floor(Number(JSON.parse(fs.readFileSync(file, 'utf8')).times));
    if (Number.isInteger(n) && n >= 1 && n <= 30) return n;
  } catch (_) {
    /* missing/corrupt config -> default */
  }
  return 5;
}

function nodeBin() {
  // The baked path is setup's own node (guaranteed to run the CLI).
  // Anything else (hand-copied file, deleted runtime) falls back to PATH.
  try {
    if (typeof NODE_BIN === 'string' && /node(\.exe)?$/i.test(NODE_BIN) && fs.existsSync(NODE_BIN)) {
      return NODE_BIN;
    }
  } catch (_) {
    /* fall through to PATH lookup */
  }
  return 'node';
}

function fallbackBeep(kind) {
  // Fire-and-forget inline beeps: the event handler must never block for
  // the whole alarm. Never hides or minimizes any window.
  try {
    const n = readTimes();
    const f = FALLBACK_FREQ[kind] || 1000;
    const script =
      kind === 'question'
        ? `for ($i=0; $i -lt ${n}; $i++) { [console]::beep(1250,280); [console]::beep(1750,280); Start-Sleep -Milliseconds 150 }`
        : kind === 'error'
          ? `for ($i=0; $i -lt ${n}; $i++) { [console]::beep(${f},220); Start-Sleep -Milliseconds 150; [console]::beep(${f},220); Start-Sleep -Milliseconds 350 }`
          : `for ($i=0; $i -lt ${n}; $i++) { [console]::beep(${f},700); Start-Sleep -Milliseconds 200 }`;
    const child = cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (child && typeof child.unref === 'function') child.unref();
  } catch (_) {
    try {
      process.stdout.write('\x07'.repeat(3));
    } catch (_) {}
  }
}

function cliAvailable() {
  // The placeholder below is replaced by setup; a hand-copied file keeps a
  // value that never ends with the CLI name, so we fall back to beeps.
  try {
    return typeof CLI_JS === 'string' && CLI_JS.endsWith('ai-agent-bell.js') && fs.existsSync(CLI_JS);
  } catch (_) {
    return false;
  }
}

function alarm(kind) {
  if (!cliAvailable()) {
    fallbackBeep(kind);
    return;
  }
  try {
    const child = cp.spawn(nodeBin(), [CLI_JS, '--event', kind], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    // Async spawn failures (node missing from PATH) never throw here —
    // without this handler the alarm would die silently.
    if (child && typeof child.on === 'function') {
      child.on('error', () => {
        try {
          fallbackBeep(kind);
        } catch (_) {}
      });
    }
    if (child && typeof child.unref === 'function') child.unref();
  } catch (_) {
    fallbackBeep(kind);
  }
}

function handleEvent(event) {
  // Shared by the 2.x ctx.event.subscribe() loop and the 1.x `event` hook.
  try {
    const type = event && event.type;
    if (!type) return;
    const props = propsOf(event);
    // Learn subagent ids first — never ring for these bookkeeping events.
    if (type === 'session.created' || type === 'session.updated') {
      noteChildSession(props);
      return;
    }
    let kind = KIND_BY_EVENT[type] || null;
    if (type === 'session.status') {
      // Modern replacement for deprecated session.idle. Busy/retry
      // transitions mid-task must stay silent — idle-only.
      if (statusOf(props) !== 'idle') return;
      kind = 'complete';
    } else if (type === 'tool.execute.before') {
      // Fires before every tool — only the question tool needs the user.
      if (toolNameOf(props) !== 'question') return;
      kind = 'question';
    }
    if (!kind) return;
    const sid = sessionIdOf(props);
    // Subagent finished/failed while the main task continues: stay silent.
    if ((kind === 'complete' || kind === 'error') && sid && CHILD_SESSIONS.has(sid)) return;
    // Same-session double-fire (idle + status for one completion): ring once.
    if (cooledDown(kind, sid)) return;
    alarm(kind);
  } catch (_) {
    try {
      fallbackBeep('complete');
    } catch (_) {}
  }
}

export default {
  id: 'ai-agent-bell',
  setup(ctx) {
    // opencode 2.x: subscribe to the server event stream. The loop must not
    // die on a stream hiccup (the bell would go silent), so it resubscribes
    // until the plugin unloads via the returned cleanup.
    if (!ctx || !ctx.event || typeof ctx.event.subscribe !== 'function') return undefined;
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            handleEvent(event);
          }
        } catch (_) {
          /* stream ended or aborted */
        }
        if (!controller.signal.aborted) await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return () => controller.abort();
  },
  // opencode 1.18.29+ object entrypoint: same guards, V1 event shape.
  async server() {
    return {
      event: async ({ event }) => handleEvent(event),
    };
  },
};
