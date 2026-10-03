#!/usr/bin/env node
'use strict';

/**
 * ai-agent-bell / ai-agent-bell CLI.
 *
 *   ai-agent-bell                              -> complete alarm (repeats from config file)
 *   ai-agent-bell --event question --times 5   -> input-needed alarm, 5 rounds, one-shot
 *   ai-agent-bell --event error                -> failed-task alarm (repeats from config file)
 *   ai-agent-bell test                         -> short 2-round sound check
 *   ai-agent-bell config                       -> show the repeat-count file and value
 *   ai-agent-bell config --times 8             -> ring 8 times from now on
 *   ai-agent-bell setup [--tools opencode,claude,codex] [--times 8]
 *   ai-agent-bell --help
 *
 * How many times it rings lives in ONE file:
 *   ~/.config/ai-agent-bell/config.json   { "times": 10 }
 * Hooks call the CLI without any count, so editing that file (or one
 * `setup --times N`) changes every tool at once — no re-setup needed.
 *
 * Design rule: `setup` touches ONLY home-directory configs
 * (~/.config/opencode, ~/.config/ai-agent-bell, ~/.claude, ~/.codex).
 * It NEVER writes into the current project, NEVER adds a dependency,
 * NEVER affects any build.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { playAlarm } = require('../lib/alarm');
const detectors = require('../detectors');
const config = require('../lib/config');

const VERSION = '1.0.0';
const KNOWN_TOOLS = ['opencode', 'claude', 'codex'];

function printHelp() {
  console.log(`
ai-agent-bell v${VERSION} — audible alarm for AI coding agents (CMD only)

USAGE
  ai-agent-bell [options]                Play alarm (repeats read from config file)
  ai-agent-bell test                     Play a short 2-round sound check
  ai-agent-bell config                   Show repeat-count file and current value
  ai-agent-bell config --times N         Ring N times from now on (1..30)
  ai-agent-bell setup [options]          Wire global configs (home dir ONLY, project untouched)

OPTIONS
  --event <name>        complete | question | warning | error   (default: complete)
  --times <N>           1..30, one-shot override (default: value from config file)
  --duration <N>        deprecated alias of --times (kept for old hooks)
  --tools <list>        setup only: opencode,claude,codex      (default: all three)
  --quiet               Less console output (sound still plays)
  -h, --help            Show this help
  -v, --version         Show version

EACH EVENT SOUNDS DIFFERENT
  complete        steady chime            (task finished)
  question        urgent two-tone siren   (agent needs input — answer it)
  error           low double-beep         (run failed)
  warning         slow spaced beeps

STOPPING EARLY
  Click any mouse button (Windows), press any key in the terminal,
  or just let all N rounds play.

EXAMPLES
  ai-agent-bell
  ai-agent-bell --event question --times 5
  ai-agent-bell setup --times 8
  ai-agent-bell config --times 8

ZERO PROJECT IMPACT
  setup edits only:  ~/.config/opencode/plugins/ai-agent-bell.js
                     ~/.config/ai-agent-bell/config.json
                     ~/.claude/settings.json      (global hooks only)
                     ~/.codex/config.toml         (global notify only)
  It never creates files in your project and never changes your build.
`);
}

function fail(msg) {
  console.error(`ai-agent-bell: ${msg}\nRun "ai-agent-bell --help" for usage.`);
  process.exit(2);
}

function takeValue(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('-')) fail(`${flag} needs a value`);
  return v;
}

function parseTimes(raw, flag) {
  if (String(raw).trim() === '') fail(`${flag} needs a value`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < config.MIN_TIMES || n > config.MAX_TIMES) {
    fail(`${flag} must be a whole number ${config.MIN_TIMES}..${config.MAX_TIMES}`);
  }
  return n;
}

function parseArgs(argv) {
  const out = { event: 'complete', times: undefined, quiet: false, tools: null, cmd: 'alarm' };
  let cmdSeen = null;
  let deprecatedWarned = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'setup' || a === 'test' || a === 'config') {
      if (cmdSeen) fail(`only one command allowed (saw "${cmdSeen}" and "${a}")`);
      cmdSeen = a;
      out.cmd = a;
    } else if (a === '--event' || a.startsWith('--event=')) {
      out.event = a.includes('=') ? a.split('=').slice(1).join('=') : takeValue(argv, i, '--event');
      if (!a.includes('=')) i++;
      if (!out.event) fail('--event needs a value');
    } else if (a === '--times' || a.startsWith('--times=')) {
      const raw = a.includes('=') ? a.split('=').slice(1).join('=') : takeValue(argv, i, '--times');
      if (!a.includes('=')) i++;
      out.times = parseTimes(raw, '--times');
    } else if (a === '--duration' || a.startsWith('--duration=')) {
      // Deprecated alias from v1 duration-seconds era (1s ~= 1 round).
      if (!deprecatedWarned) {
        console.error('ai-agent-bell: warning: --duration is deprecated, use --times (same numbers).');
        deprecatedWarned = true;
      }
      const raw = a.includes('=') ? a.split('=').slice(1).join('=') : takeValue(argv, i, '--duration');
      if (!a.includes('=')) i++;
      out.times = parseTimes(raw, '--duration');
    } else if (a === '--tools' || a.startsWith('--tools=')) {
      const raw = a.includes('=') ? a.split('=').slice(1).join('=') : takeValue(argv, i, '--tools');
      if (!a.includes('=')) i++;
      out.tools = String(raw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else if (a === '--quiet') out.quiet = true;
    else if (a === '-h' || a === '--help') return { ...out, cmd: 'help' };
    else if (a === '-v' || a === '--version') return { ...out, cmd: 'version' };
    else fail(`unknown argument "${a}"`);
  }
  if (out.cmd === 'alarm' && !detectors.byId(out.event)) {
    fail(`unknown event "${out.event}". Use: ${detectors.ALL.map((d) => d.id).join(', ')}`);
  }
  if (out.cmd !== 'setup' && out.cmd !== 'config' && out.tools) {
    console.error('ai-agent-bell: warning: --tools only affects "setup", ignoring it here.');
    out.tools = null;
  }
  return out;
}

// ---------------------------------------------------------------- setup ---

function home() {
  return os.homedir();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function loadJsonFile(file) {
  // Returns { data } or { corrupt: true }. A corrupt global settings file is
  // never silently overwritten — the caller backs it up first.
  try {
    return { data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { data: null };
    return { corrupt: true };
  }
}

// Old brand names from pre-release installs (ai-task-alarm / ai-alarm).
// Detected for idempotency and rewritten to the current brand in place.
const OLD_BRANDS = ['ai-task-alarm', 'ai-alarm'];

function hookEntryHasBrand(hooksArr) {
  return (hooksArr || []).some((h) => {
    const s = JSON.stringify(h);
    return s.includes('ai-agent-bell') || OLD_BRANDS.some((b) => s.includes(b));
  });
}

function rebrandClaudeEntries(cfg, matchers) {
  // Rewrite our own old-brand hook commands to ai-agent-bell so a rebrand
  // never leaves duplicates or dead commands. Missing matchers are backfilled
  // so old entries gain current filtering. Returns groups touched.
  let touched = 0;
  for (const key of ['Stop', 'StopFailure', 'Notification']) {
    if (!Array.isArray(cfg[key])) continue;
    cfg[key] = cfg[key].map((group) => {
      let s = JSON.stringify(group);
      if (!OLD_BRANDS.some((b) => s.includes(b))) return group;
      s = s.split('ai-task-alarm').join('ai-agent-bell').replace(/\bai-alarm\b/g, 'ai-agent-bell');
      touched++;
      const obj = JSON.parse(s);
      if (matchers && matchers[key] && !obj.matcher) obj.matcher = matchers[key];
      return obj;
    });
  }
  return touched;
}

function setupOpencode() {
  // Global plugin dir is auto-loaded by opencode at startup. No opencode.json
  // edit needed, no project file touched. The CLI path is baked in so the
  // tiny dispatcher always finds the real engine (detectors + notifications).
  const dir = path.join(home(), '.config', 'opencode', 'plugins');
  ensureDir(dir);
  const src = path.join(__dirname, '..', 'adapters', 'opencode-plugin.js');
  const dest = path.join(dir, 'ai-agent-bell.js');
  const cliAbs = path.join(__dirname, 'ai-agent-bell.js');
  let body = fs.readFileSync(src, 'utf8');
  // Replace the whole quoted token so the baked file holds a valid JS string.
  // An unbaked (hand-copied) file keeps the harmless placeholder string and
  // the plugin falls back to inline beeps.
  body = body.split(`'__CLI_ABS_PATH__'`).join(JSON.stringify(cliAbs));
  const existed = fs.existsSync(dest);
  fs.writeFileSync(dest, body);
  // Remove our own pre-release copy so two plugins never ring twice.
  let legacyNote = '';
  try {
    const legacy = path.join(dir, 'ai-task-alarm.js');
    if (fs.existsSync(legacy)) {
      fs.unlinkSync(legacy);
      legacyNote = ' (removed legacy ai-task-alarm.js)';
    }
  } catch (_) {
    /* best effort */
  }
  return `${existed ? 'updated' : 'created'} ${dest}${legacyNote}`;
}

function setupClaude() {
  // Global file only: ~/.claude/settings.json. Project .claude/ untouched.
  // No repeat count here: the CLI reads it from the config file at runtime.
  const file = path.join(home(), '.claude', 'settings.json');
  ensureDir(path.dirname(file));
  const loaded = loadJsonFile(file);
  if (loaded.corrupt) {
    const bak = `${file}.bak-${Date.now()}`;
    fs.copyFileSync(file, bak);
    console.error(`ai-agent-bell: warning: ${file} was not valid JSON; backed up to ${bak} and recreated.`);
  }
  const cfg = loaded.data && typeof loaded.data === 'object' ? loaded.data : {};
  cfg.hooks = cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : {};

  const cmdFor = (event) => `npx -y ai-agent-bell --event ${event}`;
  // Notification fires for many non-actionable types too (auth, quota,
  // elicitation results...). Ring only for types where the user must act.
  const INPUT_NOTIFICATIONS = 'permission_prompt|idle_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input';
  const skipped = [];
  const rebranded = rebrandClaudeEntries(cfg, { Notification: INPUT_NOTIFICATIONS });
  const ensure = (key, event, matcher) => {
    if (cfg[key] !== undefined && !Array.isArray(cfg[key])) {
      skipped.push(key); // unexpected user shape — leave their data alone
      return;
    }
    cfg[key] = Array.isArray(cfg[key]) ? cfg[key] : [];
    if (!hookEntryHasBrand(cfg[key])) {
      const group = { hooks: [{ type: 'command', command: cmdFor(event), timeout: 30 }] };
      if (matcher) group.matcher = matcher;
      cfg[key].push(group);
    }
  };

  ensure('Stop', 'complete'); // response/turn finished (NOT whole task)
  ensure('StopFailure', 'error'); // turn ended on API error
  ensure('Notification', 'question', INPUT_NOTIFICATIONS); // actionable input only

  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  const extra = skipped.length ? ` (skipped non-array keys left untouched: ${skipped.join(', ')})` : '';
  const rebrandNote = rebranded ? ` (rebranded ${rebranded} old entr${rebranded === 1 ? 'y' : 'ies'} to ai-agent-bell)` : '';
  return `merged hooks into ${file} (Stop=complete, StopFailure=error, Notification=question)${extra}${rebrandNote}`;
}

function setupCodex() {
  // Global file only: ~/.codex/config.toml. Project .codex/ untouched.
  // Turn-complete -> [[hooks.Stop]]; approvals -> [[hooks.PermissionRequest]].
  // A top-level `notify` key is deliberately NOT written: if the user already
  // has one, a second key would be a duplicate-TOML-key parse error.
  const file = path.join(home(), '.codex', 'config.toml');
  ensureDir(path.dirname(file));
  const MARK = '# >>> ai-agent-bell (global, safe to delete) >>>';
  const END = '# <<< ai-agent-bell <<<';
  const OLD_MARK = '# >>> ai-task-alarm (global, safe to delete) >>>';
  const OLD_END = '# <<< ai-task-alarm <<<';
  const STOP_GROUP = [
    '[[hooks.Stop]]',
    '[[hooks.Stop.hooks]]',
    'type = "command"',
    'command = "npx -y ai-agent-bell --event complete"',
  ];
  let cur = '';
  try {
    cur = fs.readFileSync(file, 'utf8');
  } catch (_) {
    cur = '';
  }
  if (!cur.includes(MARK) && (cur.includes(OLD_MARK) || cur.includes(OLD_END))) {
    // Rebrand our own pre-release block: markers + commands, block only.
    const out = [];
    let inBlock = false;
    for (const line of cur.split('\n')) {
      if (line.includes(OLD_MARK)) {
        out.push(MARK);
        inBlock = true;
        continue;
      }
      if (line.includes(OLD_END)) {
        out.push(END);
        inBlock = false;
        continue;
      }
      out.push(
        inBlock
          ? line.split('ai-task-alarm').join('ai-agent-bell').replace(/\bai-alarm\b/g, 'ai-agent-bell')
          : line
      );
    }
    cur = out.join('\n');
    fs.writeFileSync(file, cur);
  }
  if (cur.includes(MARK)) {
    if (cur.includes('[[hooks.Stop]]')) return `already present in ${file}`;
    // Migrate our own pre-Stop block: drop the old top-level `notify`
    // line (any unrelated user `notify` stays untouched), insert Stop group.
    const kept = cur.split('\n').filter((l) => !(l.includes('ai-agent-bell') && /^\s*notify\s*=/.test(l)));
    const at = kept.findIndex((l) => l.includes(MARK));
    kept.splice(at + 1, 0, ...STOP_GROUP);
    fs.writeFileSync(file, kept.join('\n'));
    return `migrated to [[hooks.Stop]] in ${file} (old notify line removed)`;
  }
  const block = `
${MARK}
${STOP_GROUP.join('\n')}
[[hooks.PermissionRequest]]
matcher = ".*"
[[hooks.PermissionRequest.hooks]]
type = "command"
command = "npx -y ai-agent-bell --event question"
# <<< ai-agent-bell <<<
`;
  fs.writeFileSync(file, (cur.endsWith('\n') || cur === '' ? cur : cur + '\n') + block);
  return `appended [[hooks.Stop]]+PermissionRequest to ${file}`;
}

function runSetup(opts) {
  const tools = opts.tools || [...KNOWN_TOOLS];
  const unknown = tools.filter((t) => !KNOWN_TOOLS.includes(t));
  for (const u of unknown) console.error(`ai-agent-bell: warning: unknown tool "${u}" (known: ${KNOWN_TOOLS.join(', ')}), skipping.`);
  const picked = tools.filter((t) => KNOWN_TOOLS.includes(t));
  if (!picked.length) {
    console.error(`ai-agent-bell: nothing to set up. Use --tools with any of: ${KNOWN_TOOLS.join(', ')}.`);
    process.exit(2);
  }
  if (opts.times !== undefined) {
    try {
      config.save(opts.times);
    } catch (e) {
      fail(e.message);
    }
  }
  const results = [];
  if (picked.includes('opencode')) results.push('opencode: ' + setupOpencode());
  if (picked.includes('claude')) results.push('claude: ' + setupClaude());
  if (picked.includes('codex')) results.push('codex: ' + setupCodex());
  const current = config.load().times;
  console.log('[ai-agent-bell] setup done — HOME configs only, project untouched:');
  for (const r of results) console.log('  - ' + r);
  console.log(`  - alarm repeats: x${current}  (file: ${config.configPath()})`);
  console.log('Change the count any time:  ai-agent-bell setup --times N   (no tool re-setup needed)');
  console.log('\nRestart your AI tool (opencode / claude / codex) so the new hooks load.');
}

function runConfig(opts) {
  if (opts.times !== undefined) {
    try {
      config.save(opts.times);
    } catch (e) {
      fail(e.message);
    }
  }
  const cur = config.load();
  console.log(`[ai-agent-bell] config file: ${config.configPath()}`);
  console.log(`alarm repeats: x${cur.times}`);
  if (opts.times === undefined) {
    console.log('Change it:  ai-agent-bell config --times N   (N = 1..30)');
  }
}

// ---------------------------------------------------------------- main ----

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.cmd === 'help') return printHelp();
  if (opts.cmd === 'version') return console.log(VERSION);
  if (opts.cmd === 'config') return runConfig(opts);
  if (opts.cmd === 'setup') return runSetup(opts);
  if (opts.cmd === 'test') {
    await playAlarm({ event: 'complete', times: 2 });
    return;
  }
  await playAlarm({ event: opts.event, times: opts.times, quiet: opts.quiet });
}

main().catch((e) => {
  console.error(`ai-agent-bell: ${e && e.message ? e.message : e}`);
  process.exit(1);
});
