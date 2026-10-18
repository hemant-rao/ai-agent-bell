#!/usr/bin/env node
'use strict';

/**
 * Live ring acceptance: prove the bell actually RINGS, not just that the
 * plugin loads.
 *
 * WHY THIS EXISTS
 *   Twice a release shipped silence because it was verified only as "the
 *   plugin loads" (1.0.3: dropped copy; 1.0.5: dead V1 event names on
 *   opencode 2.x). Loading is not ringing. This tool runs REAL headless
 *   sessions on the installed opencode and watches the process table for
 *   the one artifact that exists only when the bell truly rings: the alarm
 *   CLI the plugin spawns (`node ... --event <kind>`). It plays REAL SOUND.
 *
 * SCENARIOS (default: complete x3, error, question, child)
 *   complete  `opencode run "Reply with exactly: ok. Do not use any tools."`
 *             must spawn exactly ONE `--event complete` process.
 *   error     forced provider failure (unknown model)
 *             must spawn exactly ONE `--event error` process.
 *   question  headless question tool (the form auto-cancels)
 *             must spawn exactly ONE `--event question` process.
 *   child     Task-tool subagent inside one turn (best effort: needs a model
 *             that obeys). The subagent completes MID-turn and must stay
 *             silent; only the parent turn end may ring — so exactly ONE
 *             `--event complete` process for the whole run.
 *
 * Windows-only process observation (PowerShell CIM through the process
 * table); elsewhere it prints SKIP and exits 0 so CI can call it safely.
 * Run it on the author machine before every release and again after every
 * install/re-bake: `npm run ring-check` (this is the release gate for the
 * bell itself — see "The ring is sacred" in memory/MEMORY.md).
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const OPENCODE = process.env.OPENCODE_BIN || 'opencode';
const BAD_MODEL = process.env.RING_CHECK_BAD_MODEL || 'opencode/definitely-not-a-model';
// Keep sampling this long after a run exits: the alarm spawns at turn end
// and lives roughly 2s (times setting), so 6s of tail is plenty.
const TAIL_MS = 6000;

function usage() {
  return [
    'Usage: npm run ring-check -- [options]',
    '',
    '  --runs N        completion runs to repeat (default 3, max 10)',
    '  --quick         same as --runs 1',
    '  --no-child      skip the task-tool subagent scenario (needs an obedient model)',
    '  --only KIND     run one kind only: complete | error | question | child',
    '',
    'Plays REAL sound. Windows only. Exits non-zero if any scenario fails.',
  ].join('\n');
}

// ---------------------------------------------------------------- args ----
let runs = 3;
let withChild = true;
let only = '';
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (a === '--quick') {
      runs = 1;
    } else if (a === '--no-child') {
      withChild = false;
    } else if (a === '--only') {
      only = String(argv[++i] || '');
    } else if (a.startsWith('--only=')) {
      only = a.slice('--only='.length);
    } else if (a === '--runs') {
      runs = Number(argv[++i]) || 3;
    } else if (a.startsWith('--runs=')) {
      runs = Number(a.slice('--runs='.length)) || 3;
    } else {
      console.error('unknown argument: ' + a + '\n\n' + usage());
      process.exit(2);
    }
  }
  runs = Math.max(1, Math.min(10, runs));
}

if (!IS_WIN) {
  console.log('[ring-check] SKIP: process-level ringing is only observable on Windows');
  process.exit(0);
}

// ------------------------------------------------- process observer --------
// One PowerShell child polls the process table (~100ms cadence) and streams
// `timestamp|pid|kind` lines. `kind` is parsed from the alarm CLI arguments
// (`--event complete|question|error`); anything else on an ai-agent-bell
// process reads `other`, which analysis treats as a stray.
const POLL_PS1 = path.join(os.tmpdir(), 'ai-agent-bell-ringcheck', 'poll.ps1');
const POLL_PS1_SOURCE = [
  'param([int]$ExcludePid = 0, [int]$MaxSeconds = 600)',
  '$deadline = (Get-Date).AddSeconds($MaxSeconds)',
  'while ((Get-Date) -lt $deadline) {',
  '  $procs = @(Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" -ErrorAction SilentlyContinue |',
  "    Where-Object { $_.CommandLine -and $_.CommandLine -match 'ai-agent-bell' -and $_.CommandLine -notmatch 'ring-check' -and $_.ProcessId -ne $ExcludePid })",
  '  foreach ($p in $procs) {',
  "    $kind = 'other'",
  "    if ($p.CommandLine -match '--event\\s+(\\w+)') { $kind = $Matches[1] }",
  "    '{0}|{1}|{2}' -f (Get-Date -Format o), $p.ProcessId, $kind",
  '  }',
  '  Start-Sleep -Milliseconds 100',
  '}',
  '',
].join('\n');
fs.mkdirSync(path.dirname(POLL_PS1), { recursive: true });
fs.writeFileSync(POLL_PS1, POLL_PS1_SOURCE);

let activePoller = null;
let activeRunChild = null;
function killTree(pid) {
  if (!pid) return;
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } catch (_) {
    /* best effort */
  }
}
process.on('SIGINT', () => {
  if (activePoller) killTree(activePoller.pid);
  if (activeRunChild) killTree(activeRunChild.pid);
  process.exit(130);
});
// Never die silently: surface the error text and exit non-zero.
process.on('uncaughtException', (e) => {
  console.error('[ring-check] crashed (uncaught): ' + (e && e.stack || e));
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('[ring-check] crashed (rejection): ' + (e && e.stack || e));
  process.exit(1);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startPoller(maxSeconds) {
  const child = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', POLL_PS1, '-ExcludePid', String(process.pid), '-MaxSeconds', String(maxSeconds)],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  activePoller = child;
  const samples = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let ix;
    while ((ix = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, ix).trim();
      buf = buf.slice(ix + 1);
      if (!line) continue;
      const parts = line.split('|');
      if (parts.length === 3 && /^\d+$/.test(parts[1])) samples.push({ ts: parts[0], pid: Number(parts[1]), kind: parts[2] });
    }
  });
  child.on('error', () => { /* poller died: samples stay partial, analysis reports it */ });
  return {
    samples,
    async stop() {
      killTree(child.pid);
      await sleep(250);
      if (activePoller === child) activePoller = null;
      return samples;
    },
  };
}

// One sampling window (used to wait until the process table is quiet).
async function sampleWindow(seconds) {
  const p = startPoller(seconds + 2);
  await sleep(seconds * 1000);
  return p.stop();
}

async function waitQuiet(maxMs) {
  const t0 = Date.now();
  for (;;) {
    const s = await sampleWindow(1);
    if (s.length === 0) return true;
    if (Date.now() - t0 > maxMs) {
      console.log('      note: foreign ai-agent-bell process(es) still alive — continuing anyway');
      return false;
    }
  }
}

// --------------------------------------------------- opencode runner -------
function quoteIfNeeded(s) {
  return /\s/.test(s) && !/^".*"$/.test(s) ? '"' + s + '"' : s;
}

function runOpencode(args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const cmd = [quoteIfNeeded(OPENCODE), ...args.map(quoteIfNeeded)].join(' ');
    const child = spawn(cmd, {
      shell: true,
      windowsHide: true,
      cwd: os.homedir(), // neutral cwd: no project context steers the model
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeRunChild = child;
    let out = '';
    let killed = false;
    let spawnError = '';
    const grab = (d) => {
      out = (out + d.toString()).slice(-6000);
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    child.on('error', (err) => {
      spawnError = err && err.message || String(err);
    });
    const timer = setTimeout(() => {
      killed = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (activeRunChild === child) activeRunChild = null;
      resolve({ code, out, ms: Date.now() - started, killed, spawnError });
    });
  });
}

// ------------------------------------------------------- analysis ----------
// One alarm = one distinct process. Ringers are pids whose kind matches the
// expectation; pids with any other kind are strays (the 4x overlapping alarm
// regression shows up as ringers.length > 1, a child-completion leak on the
// child scenario shows up as 2+ complete ringers in one run). `allowExtra`
// lists kinds that are legitimate follow-ups (a headless question run
// auto-cancels and then FINISHES its turn, so a "complete" alarm legitimately
// follows the "question" one — that is the turn genuinely ending, not dupes).
function analyze(samples, expectKind, allowExtra) {
  const byPid = new Map();
  for (const s of samples) {
    let e = byPid.get(s.pid);
    if (!e) {
      e = { pid: s.pid, kinds: new Set(), n: 0 };
      byPid.set(s.pid, e);
    }
    e.kinds.add(s.kind);
    e.n++;
  }
  const entries = [...byPid.values()].map((e) => ({ pid: e.pid, kinds: [...e.kinds], n: e.n }));
  const ringers = entries.filter((e) => e.kinds.includes(expectKind));
  const extra = entries.filter((e) => !e.kinds.includes(expectKind) && e.kinds.every((k) => allowExtra.includes(k)));
  const strays = entries.filter((e) => e.kinds.some((k) => k !== expectKind && !allowExtra.includes(k)));
  return { entries, ringers, extra, strays };
}

function tail(s, n = 700) {
  s = String(s || '');
  return s.length > n ? '...' + s.slice(-n) : s;
}

// --------------------------------------------------------- scenarios -------
const PROMPT_COMPLETE = 'Reply with exactly: ok. Do not use any tools.';
const PROMPT_QUESTION = 'Call the question tool once to ask the user whether it is OK to continue, then wait for the answer. Do not use any other tools.';
const PROMPT_CHILD = 'Use the task tool to launch one subagent that lists three files in the current directory and reports back. Wait for the subagent to finish, then reply exactly: parent-done. Do not use any other tools.';

const scenarios = [];
for (let i = 1; i <= runs; i++) {
  scenarios.push({ name: 'complete #' + i + '/' + runs, kind: 'complete', allowExtra: [], args: ['run', PROMPT_COMPLETE], timeoutMs: 180000 });
}
scenarios.push({ name: 'error (forced provider failure)', kind: 'error', allowExtra: [], args: ['run', '--model', BAD_MODEL, 'hi'], timeoutMs: 150000 });
scenarios.push({ name: 'question (headless form, auto-cancels)', kind: 'question', allowExtra: ['complete'], args: ['run', PROMPT_QUESTION], timeoutMs: 180000 });
if (withChild) {
  scenarios.push({ name: 'child (subagent must stay silent)', kind: 'complete', allowExtra: [], args: ['run', PROMPT_CHILD], timeoutMs: 240000 });
}

// --only <complete|error|question|child> runs a subset (all matching names).
const selected = only ? scenarios.filter((s) => s.name.startsWith(only)) : scenarios;
if (selected.length === 0) {
  console.error('--only ' + only + ' matched no scenario');
  process.exit(2);
}

// ------------------------------------------------------------- main --------
(async () => {
  console.log('[ring-check] LIVE bell acceptance — this plays REAL sound (' + selected.length + ' scenarios).');
  console.log('[ring-check] opencode: ' + OPENCODE + ' | completion runs: ' + runs + ' | child scenario: ' + (withChild ? 'on' : 'off'));
  console.log('[ring-check] a beep count double your config "times" is expected per alarm.\n');

  let passed = 0;
  for (let i = 0; i < selected.length; i++) {
    const sc = selected[i];
    console.log('[' + (i + 1) + '/' + selected.length + '] ' + sc.name + ' — expecting exactly one "' + sc.kind + '" alarm process');
    await waitQuiet(10000);
    const poller = startPoller(Math.ceil((sc.timeoutMs + TAIL_MS) / 1000) + 60);
    console.log('      running: ' + [OPENCODE, ...sc.args].join(' ').slice(0, 140));
    const r = await runOpencode(sc.args, sc.timeoutMs);
    await sleep(TAIL_MS);
    const samples = await poller.stop();

    const a = analyze(samples, sc.kind, sc.allowExtra);
    console.log('      run exit=' + r.code + (r.killed ? ' (killed: timeout)' : '') + ' after ' + (r.ms / 1000).toFixed(1) + 's; ' + samples.length + ' sample(s), ' + a.entries.length + ' alarm process(es)');
    for (const e of a.entries) console.log('        pid ' + e.pid + '  kinds=' + e.kinds.join(',') + '  samples=' + e.n);
    for (const e of a.extra) console.log('      note: +1 "' + e.kinds.join(',') + '" alarm accepted for this scenario (turn genuinely finished)');

    let why = '';
    if (r.spawnError) why = 'could not start opencode: ' + r.spawnError;
    else if (r.killed) why = 'run did not finish in ' + sc.timeoutMs / 1000 + 's';
    else if (a.ringers.length === 0) why = 'NO "' + sc.kind + '" alarm process was observed — the bell did NOT ring';
    else if (a.ringers.length > 1) why = a.ringers.length + ' "' + sc.kind + '" alarm processes — duplicate ringing';
    else if (a.strays.length > 0) why = 'unexpected alarm kind(s): ' + a.strays.map((e) => e.kinds.join(',')).join(' / ');

    if (why) {
      console.log('FAIL  ' + sc.name + ': ' + why);
      if (r.out.trim()) console.log('      run output tail: ' + tail(r.out).replace(/\s+/g, ' ').trim());
    } else {
      passed++;
      console.log('PASS  ' + sc.name + ': exactly one "' + sc.kind + '" alarm (pid ' + a.ringers[0].pid + ')');
    }
  }

  console.log('\nring-check summary: ' + passed + '/' + selected.length + ' scenarios passed');
  if (passed === selected.length) {
    console.log('The bell rang for every path. If you did not HEAR it, check system volume and the "times" setting.');
  } else {
    console.log('DO NOT release from this state: a core ringing path failed. See "The ring is sacred" in memory/MEMORY.md.');
  }
  process.exitCode = passed === selected.length ? 0 : 1;
})().catch((err) => {
  console.error('[ring-check] crashed: ' + (err && err.stack || err));
  if (activePoller) killTree(activePoller.pid);
  if (activeRunChild) killTree(activeRunChild.pid);
  process.exit(1);
});
