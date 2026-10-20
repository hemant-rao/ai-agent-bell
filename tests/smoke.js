'use strict';

/**
 * Permanent smoke test for ai-agent-bell. SILENT by design:
 *  - never plays a real alarm (no playAlarm / playSound / playRound calls)
 *  - adapter child_process calls are stubbed before firing events
 *  - setup runs in a temp HOME via USERPROFILE override (real HOME untouched)
 *
 * Run: npm test
 */

const { spawnSync } = require('node:child_process');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-agent-bell.js');

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

function run(args, env = {}) {
  // os.homedir() follows USERPROFILE on Windows but HOME on POSIX.
  // Mirror an override to both so the fake HOME works on every OS.
  const homeOverride = env.USERPROFILE || env.HOME;
  const fullEnv = { ...process.env, ...env };
  if (homeOverride) {
    fullEnv.USERPROFILE = homeOverride;
    fullEnv.HOME = homeOverride;
  }
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: fullEnv });
}

async function main() {
  // --- A. CLI arg validation (no side effects, no sound) ---
  check('--version exits 0', run(['--version']).status === 0);
  check(
    '--version matches package.json (never stale)',
    run(['--version']).stdout.trim() === JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  );
  const help = run(['--help']);
  check('--help exits 0 and documents setup', help.status === 0 && help.stdout.includes('setup'));
  check('--help documents --no-key-stop', help.stdout.includes('--no-key-stop'));
  check('--no-key-stop accepted by the parser', run(['--no-key-stop', '--help']).status === 0);
  check('invalid --key-stop exits 2', run(['--key-stop', 'maybe']).status === 2);
  check('dangling --key-stop exits 2', run(['config', '--key-stop']).status === 2);
  check('unknown event exits 2', run(['--event', 'foo']).status === 2);
  check('unknown positional exits 2', run(['hello']).status === 2);
  check('dangling --event exits 2', run(['--event']).status === 2);
  check('unknown flag exits 2', run(['--nope']).status === 2);
  check('double command exits 2', run(['setup', 'test']).status === 2);
  check('empty --duration= exits 2', run(['--duration=']).status === 2);
  check('--times 0 exits 2', run(['--times', '0']).status === 2);
  check('--times 31 exits 2', run(['--times', '31']).status === 2);
  check('--times abc exits 2', run(['--times', 'abc']).status === 2);
  check('--times 2.5 exits 2', run(['--times', '2.5']).status === 2);
  check('setup --tools foo exits 2', run(['setup', '--tools', 'foo']).status === 2);
  check('setup --times 0 exits 2', run(['setup', '--times', '0']).status === 2);
  check('bare number out of range exits 2', run(['99']).status === 2);
  check('two bare numbers exits 2', run(['3', '4']).status === 2);
  check('flag plus bare number exits 2', run(['--times', '3', '4']).status === 2);
  check('help documents number shortcut', help.stdout.includes('ai-agent-bell 5'));
  const cfgShow = run(['config']);
  check('config shows file path', cfgShow.status === 0 && cfgShow.stdout.includes('config.json'));

  // Fresh machine (no config file yet) -> default x5, no setup needed.
  const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aitest-fresh-'));
  try {
    const cfgDefault = run(['config'], { USERPROFILE: freshHome });
    check(
      'missing file -> default x5',
      cfgDefault.status === 0 && cfgDefault.stdout.includes('alarm repeats: x5')
    );
    check(
      'missing file -> global click/key stop on',
      cfgDefault.status === 0 && cfgDefault.stdout.includes('global click/key stop: on')
    );
  } finally {
    fs.rmSync(freshHome, { recursive: true, force: true });
  }
  check('DEFAULT_TIMES is 5', require('../lib/config').DEFAULT_TIMES === 5);
  check('DEFAULT_KEY_STOP is true', require('../lib/config').DEFAULT_KEY_STOP === true);
  const adapterSrc = fs.readFileSync(path.join(ROOT, 'adapters', 'opencode-plugin.js'), 'utf8');
  check(
    'adapter is a V2 default definition (id + setup), no CJS exports',
    adapterSrc.includes('export default {') &&
      adapterSrc.includes("id: 'ai-agent-bell'") &&
      adapterSrc.includes('setup(ctx)') &&
      !adapterSrc.includes('module.exports') &&
      (adapterSrc.match(/^export /gm) || []).length === 1
  );
  check(
    'adapter keeps a V1 server() entrypoint (opencode 1.18.29+)',
    adapterSrc.includes('async server()') && adapterSrc.includes('handleEvent')
  );
  check(
    'adapter subscribes to the 2.x event stream',
    adapterSrc.includes('ctx.event.subscribe({ signal: controller.signal })')
  );
  check('adapter reads 2.x .data and legacy .properties', adapterSrc.includes('event.data || event.properties'));
  check('adapter maps question.asked (agent question pauses)', adapterSrc.includes("'question.asked': 'question'"));
  check('adapter maps form.created (2.x question form)', adapterSrc.includes("'form.created': 'question'"));
  check(
    'adapter maps session.execution.succeeded (2.x completion)',
    adapterSrc.includes("'session.execution.succeeded': 'complete'")
  );
  check(
    'adapter maps session.execution.failed (2.x failure)',
    adapterSrc.includes("'session.execution.failed': 'error'")
  );
  check(
    'adapter dedups rings across plugin instances (temp-dir claims)',
    adapterSrc.includes("'ai-agent-bell-locks'")
  );
  check(
    'adapter spawns baked node, never the host binary',
    adapterSrc.includes('cp.spawn(nodeBin()') && !adapterSrc.includes('process.execPath')
  );
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.mjs'), 'utf8');
  check(
    'npm entry is a V2 default definition too (.mjs keeps ESM unambiguous)',
    indexSrc.includes('export default {') &&
      indexSrc.includes("id: 'ai-agent-bell'") &&
      indexSrc.includes('setup(ctx)') &&
      !indexSrc.includes('module.exports') &&
      (indexSrc.match(/^export /gm) || []).length === 1
  );
  check('npm entry keeps a V1 server() entrypoint', indexSrc.includes('async server()'));
  check('npm entry reads 2.x .data and legacy .properties', indexSrc.includes('event.data || event.properties'));
  check('npm entry dedups rings across plugin instances', indexSrc.includes("'ai-agent-bell-locks'"));
  check(
    'adapter fallback default is 5 (no stale 10)',
    adapterSrc.includes('return 5;') && !adapterSrc.includes('return 10;')
  );
  const cliSrc = fs.readFileSync(CLI, 'utf8');
  check(
    'test rings saved count unless overridden (no hardcoded 2)',
    cliSrc.includes('opts.times ?? config.load().times')
  );

  // --- B. detectors registry (pure data, no sound) ---
  const detectors = require('../detectors');
  check('4 detectors registered', detectors.ALL.length === 4);
  check('all ids known', ['complete', 'question', 'error', 'warning'].every((id) => !!detectors.byId(id)));
  check('unknown id -> null', detectors.byId('nope') === null);
  check(
    'distinct sounds per detector',
    new Set(detectors.ALL.map((d) => `${d.pattern}:${d.freq}:${d.freqAlt}`)).size === 4
  );
  check('opencode idle -> complete', detectors.forToolEvent('opencode', 'session.idle')?.id === 'complete');
  check('opencode error -> error', detectors.forToolEvent('opencode', 'session.error')?.id === 'error');
  check(
    'opencode session.execution.succeeded -> complete (2.x)',
    detectors.forToolEvent('opencode', { type: 'session.execution.succeeded', data: { sessionID: 's' } })?.id ===
      'complete'
  );
  check(
    'opencode session.execution.failed -> error (2.x)',
    detectors.forToolEvent('opencode', { type: 'session.execution.failed', data: { sessionID: 's' } })?.id === 'error'
  );
  check('opencode permission -> question', detectors.forToolEvent('opencode', 'permission.asked')?.id === 'question');
  check('opencode permission.updated -> question', detectors.forToolEvent('opencode', 'permission.updated')?.id === 'question');
  check('opencode question.asked -> question', detectors.forToolEvent('opencode', 'question.asked')?.id === 'question');
  check(
    'opencode form.created -> question (2.x question form)',
    detectors.forToolEvent('opencode', { type: 'form.created', data: { form: { sessionID: 's' } } })?.id === 'question'
  );
  check(
    '2.x .data payload drives session.status idle -> complete',
    detectors.forToolEvent('opencode', { type: 'session.status', data: { status: { type: 'idle' } } })?.id === 'complete'
  );
  check(
    'opencode status idle -> complete (object shape)',
    detectors.forToolEvent('opencode', { type: 'session.status', properties: { status: { type: 'idle' } } })?.id === 'complete'
  );
  check(
    'opencode status idle -> complete (string shape)',
    detectors.forToolEvent('opencode', { type: 'session.status', properties: { status: 'idle' } })?.id === 'complete'
  );
  check(
    'opencode status busy stays silent (no mid-task complete)',
    detectors.forToolEvent('opencode', { type: 'session.status', properties: { status: { type: 'busy' } } }) === null
  );
  check(
    'opencode status without props stays silent',
    detectors.forToolEvent('opencode', 'session.status') === null
  );
  check(
    'tool.execute.before question tool -> question',
    detectors.forToolEvent('opencode', { type: 'tool.execute.before', properties: { tool: 'question' } })?.id === 'question'
  );
  check(
    'tool.execute.before question tool object -> question',
    detectors.forToolEvent('opencode', { type: 'tool.execute.before', properties: { tool: { id: 'question' } } })?.id === 'question'
  );
  check(
    'tool.execute.before other tool stays silent',
    detectors.forToolEvent('opencode', { type: 'tool.execute.before', properties: { tool: 'read' } }) === null
  );
  check('claude Stop -> complete', detectors.forToolEvent('claude', 'Stop')?.id === 'complete');
  check('claude Notification -> question', detectors.forToolEvent('claude', 'Notification')?.id === 'question');
  check('codex Stop -> complete', detectors.forToolEvent('codex', 'Stop')?.id === 'complete');
  check('codex approval -> question', detectors.forToolEvent('codex', 'PermissionRequest')?.id === 'question');
  check('unknown tool event -> null', detectors.forToolEvent('opencode', 'nope') === null);
  check('empty type -> null', detectors.forToolEvent('opencode', '') === null);

  // --- B2. Windows scripts (pure string building, no sound) ---
  const soundMod = require('../notifications/sound');
  for (const d of detectors.ALL) {
    const script = soundMod.buildWindowsLoop(d, 5);
    check(
      `win loop ${d.id}: 5 rounds + own freq, no window flags`,
      script.includes('$i -lt 5') &&
        script.includes(String(d.freq)) &&
        !script.includes('WindowStyle') &&
        !script.includes('exit 7')
    );
  }
  const watcher = soundMod.buildWindowsWatcher();
  check('watcher polls GetAsyncKeyState', watcher.includes('GetAsyncKeyState'));
  check('watcher exits 7 on activity', watcher.includes('exit 7'));
  check('watcher polls every 50ms', watcher.includes('Start-Sleep -Milliseconds 50'));
  check('watcher covers mouse buttons', watcher.includes('@(1,2,4,'));
  check('watcher primes stale input first', watcher.indexOf('Out-Null') < watcher.indexOf('while ($true)'));
  // armKeyStop wiring with a fake TTY stdin (no real keys needed).
  const { EventEmitter } = require('node:events');
  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = true;
  fakeStdin.setRawModeCalled = [];
  fakeStdin.setRawMode = function (v) {
    fakeStdin.setRawModeCalled.push(v);
  };
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  let killed = 0;
  const st = { stop: false, children: [{ kill() { killed++; } }], keyStop: true };
  const disarmFn = soundMod.armKeyStop(st, fakeStdin);
  fakeStdin.emit('data', Buffer.from('x'));
  check('keypress sets stop flag', st.stop === true);
  check('keypress kills tracked children', killed === 1);
  check('raw mode entered', fakeStdin.setRawModeCalled.includes(true));
  disarmFn();
  check('raw mode restored on disarm', fakeStdin.setRawModeCalled.includes(false));
  const plainStdin = new EventEmitter(); // no isTTY -> must stay silent
  const st2 = { stop: false, children: [], keyStop: true };
  soundMod.armKeyStop(st2, plainStdin);
  plainStdin.emit('data', Buffer.from('x'));
  check('non-TTY stdin ignored', st2.stop === false);

  // Packaging: every runtime require must ship on npm, and the tarball npm
  // would actually publish must match. `files[]` can rot silently (the
  // index.js -> index.mjs rename once left main pointing at nothing), so the
  // pack dry-run is checked too — it is the only honest list of what users get.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pkgFiles = pkg.files;
  check('files[] ships detectors/', pkgFiles.includes('detectors/'));
  check('files[] ships notifications/', pkgFiles.includes('notifications/'));
  check('files[] ships lib/', pkgFiles.includes('lib/'));
  check('files[] ships bin/', pkgFiles.includes('bin/'));
  check('files[] ships adapters/', pkgFiles.includes('adapters/'));
  check('files[] ships index.mjs', pkgFiles.includes('index.mjs'));
  check('files[] ships SECURITY.md', pkgFiles.includes('SECURITY.md'));
  check(
    'exports map and main both point at index.mjs',
    !!pkg.exports && pkg.exports['.'] === './index.mjs' && pkg.main === 'index.mjs'
  );
  check('prepublishOnly runs the test suite before any publish', pkg.scripts.prepublishOnly === 'npm test');
  check(
    'verify:opencode script wires the live host check',
    pkg.scripts['verify:opencode'] === 'node tools/verify-opencode.js'
  );
  // DEP0190-safe: Windows gets one command string through the shell, POSIX a
  // plain argv call (no args array + shell:true anywhere).
  const packRun =
    process.platform === 'win32'
      ? spawnSync('npm pack --dry-run --json', {
          cwd: ROOT,
          encoding: 'utf8',
          shell: true,
          windowsHide: true,
          timeout: 60000,
        })
      : spawnSync('npm', ['pack', '--dry-run', '--json'], {
          cwd: ROOT,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 60000,
        });
  let packFiles = [];
  try {
    const out = String(packRun.stdout || '');
    packFiles = (JSON.parse(out.slice(out.indexOf('[')))[0].files || []).map((f) => f.path);
  } catch (_) {}
  const mustShip = [
    'package.json',
    'README.md',
    'SECURITY.md',
    'LICENSE',
    'index.mjs',
    'bin/ai-agent-bell.js',
    'lib/alarm.js',
    'lib/config.js',
    'detectors/index.js',
    'detectors/completion.js',
    'detectors/input-required.js',
    'detectors/error.js',
    'detectors/warning.js',
    'notifications/sound.js',
    'notifications/desktop.js',
    'notifications/terminal.js',
    'adapters/opencode-plugin.js',
  ];
  check('npm pack --dry-run lists the tarball contents', packFiles.length > 0);
  const missingFromTarball = mustShip.filter((f) => !packFiles.includes(f));
  if (missingFromTarball.length) console.log('     missing from tarball: ' + missingFromTarball.join(', '));
  check('tarball ships every runtime file', missingFromTarball.length === 0);
  check(
    'tarball excludes dev-only paths (tests/ tools/ memory/ .github/)',
    !packFiles.some((f) => /^(tests|tools|memory|\.github)\//.test(f))
  );

  // --- C. config save/load roundtrip in fake HOME (silent) ---
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aitest-smoke-'));
  const fakeProj = fs.mkdtempSync(path.join(os.tmpdir(), 'aitest-proj-'));
  try {
    fs.writeFileSync(path.join(fakeProj, 'main.py'), "print('hi')\n");
    const projBefore = fs.readdirSync(fakeProj).join(',');

    const set8 = run(['config', '--times', '8'], { USERPROFILE: fakeHome });
    check('config --times 8 exits 0', set8.status === 0);
    const saved = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.config', 'ai-agent-bell', 'config.json'), 'utf8')
    );
    check('config file holds 8', saved.times === 8);

    const keyOff = run(['config', '--key-stop', 'off'], { USERPROFILE: fakeHome });
    const savedKeyOff = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.config', 'ai-agent-bell', 'config.json'), 'utf8')
    );
    check(
      'config --key-stop off exits 0 and reports off',
      keyOff.status === 0 && keyOff.stdout.includes('global click/key stop: off')
    );
    check('config persists keyStop false', savedKeyOff.keyStop === false);

    const timesKeep = run(['config', '--times', '4'], { USERPROFILE: fakeHome });
    const savedTimesKeep = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.config', 'ai-agent-bell', 'config.json'), 'utf8')
    );
    check(
      'times update preserves keyStop false',
      timesKeep.status === 0 && savedTimesKeep.times === 4 && savedTimesKeep.keyStop === false
    );

    const keyOn = run(['config', '--key-stop', 'on'], { USERPROFILE: fakeHome });
    const savedKeyOn = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.config', 'ai-agent-bell', 'config.json'), 'utf8')
    );
    check('config --key-stop on persists true', keyOn.status === 0 && savedKeyOn.keyStop === true);

    // Pre-existing user configs must be preserved.
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, '.claude', 'settings.json'),
      '{"keep": true, "Stop": [{"hooks": [{"type": "command", "command": "lint"}]}]}'
    );
    fs.mkdirSync(path.join(fakeHome, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.codex', 'config.toml'), 'model = "x"\n');

    // FORCE_COLOR=0 keeps this check deterministic even when CI exports color
    // settings to child processes; the next run tests the green path.
    const r1 = run(['setup', '--times', '7'], { USERPROFILE: fakeHome, FORCE_COLOR: '0' });
    check('setup exits 0', r1.status === 0);
    check('setup prints a success message', r1.stdout.includes('SUCCESS: AI Agent Bell is ready.'));
    check('setup prints the big package name', r1.stdout.includes('A I   A G E N T   B E L L'));
    check(
      'setup prints the safety and trust message',
      r1.stdout.includes('no network calls, no usage tracking') &&
        r1.stdout.includes('no install scripts')
    );
    check(
      'setup result lines are simple English',
      r1.stdout.includes('- OpenCode: alarm plugin') &&
        r1.stdout.includes('- Claude Code: alarm settings') &&
        r1.stdout.includes('- Codex: alarm settings') &&
        !r1.stdout.includes('opencode: OpenCode:')
    );
    check('setup stays plain when piped (no ANSI codes)', !r1.stdout.includes('\x1b['));
    const colorRun = run(['setup', '--tools', 'opencode'], {
      USERPROFILE: fakeHome,
      FORCE_COLOR: '1',
    });
    check(
      'setup uses green when color is enabled',
      colorRun.status === 0 && colorRun.stdout.includes('\x1b[32m') && colorRun.stdout.includes('\x1b[0m')
    );
    const afterSave = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.config', 'ai-agent-bell', 'config.json'), 'utf8')
    );
    check('setup --times persists 7', afterSave.times === 7);

    const keySetup = run(['setup', '--tools', 'opencode', '--key-stop', 'off'], { USERPROFILE: fakeHome });
    const afterKeySetup = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.config', 'ai-agent-bell', 'config.json'), 'utf8')
    );
    check(
      'setup --key-stop off persists',
      keySetup.status === 0 && afterKeySetup.keyStop === false
    );

    // Friendly CLI: bare numbers and plain-English filler words (silent: setup/config only).
    const setPlain = run(['setup', 'alarm', 'repeats', '6'], { USERPROFILE: fakeHome });
    check('plain-English setup exits 0', setPlain.status === 0);
    const afterPlain = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.config', 'ai-agent-bell', 'config.json'), 'utf8')
    );
    check('plain-English setup persists 6', afterPlain.times === 6);
    const setBare = run(['config', '9'], { USERPROFILE: fakeHome });
    check('bare-number config exits 0', setBare.status === 0);
    const afterBare = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.config', 'ai-agent-bell', 'config.json'), 'utf8')
    );
    check('bare-number config persists 9', afterBare.times === 9);
    const claude = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    check('claude custom key preserved', claude.keep === true);
    check('claude old hook preserved', JSON.stringify(claude.Stop).includes('lint'));
    check('claude alarm hook added', JSON.stringify(claude.Stop).includes('ai-agent-bell'));
    check('hook has no hardcoded count', !JSON.stringify(claude).includes('--times'));
    const codex = fs.readFileSync(path.join(fakeHome, '.codex', 'config.toml'), 'utf8');
    check('codex old content preserved', codex.includes('model = "x"'));
    check('codex alarm block added', codex.includes('ai-agent-bell'));
    check('codex uses hooks.Stop (no notify key)', codex.includes('[[hooks.Stop]]') && !codex.includes('notify ='));
    check('codex keeps PermissionRequest', codex.includes('[[hooks.PermissionRequest]]'));
    const pluginCopy = fs.readFileSync(
      path.join(fakeHome, '.config', 'opencode', 'plugins', 'ai-agent-bell.js'),
      'utf8'
    );
    check('opencode copy has baked CLI path', pluginCopy.includes('ai-agent-bell.js'));
    check('opencode copy has baked node binary', pluginCopy.includes('NODE_BIN') && !pluginCopy.includes('__NODE_BIN_PATH__'));
    check('no leftover placeholder', !pluginCopy.includes('__CLI_ABS_PATH__') && !pluginCopy.includes('__NODE_BIN_PATH__'));
    check(
      'opencode copy is V2-shaped (default definition, id + setup)',
      pluginCopy.includes('export default {') &&
        pluginCopy.includes("id: 'ai-agent-bell'") &&
        pluginCopy.includes('setup(ctx)')
    );
    check('project dir untouched', fs.readdirSync(fakeProj).join(',') === projBefore);

    // Idempotency: second run adds nothing.
    run(['setup', '--times', '7'], { USERPROFILE: fakeHome });
    const claude2 = fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8');
    const codex2 = fs.readFileSync(path.join(fakeHome, '.codex', 'config.toml'), 'utf8');
    check('claude idempotent', (claude2.match(/ai-agent-bell/g) || []).length === 3);
    check('codex idempotent', (codex2.match(/ai-agent-bell/g) || []).length === 4);
    const claudeObj = JSON.parse(claude2);
    const notifGroup = (claudeObj.Notification || []).find((g) => JSON.stringify(g).includes('ai-agent-bell'));
    check(
      'Notification restricted to input types',
      !!notifGroup && (notifGroup.matcher || '').includes('permission_prompt')
    );
    check('StopFailure wired to error', JSON.stringify(claudeObj.StopFailure || []).includes('--event error'));

    // Migration: a pre-release codex block (old brand + top-level notify).
    const OLD_BLOCK = [
      'model = "x"',
      '',
      '# >>> ai-task-alarm (global, safe to delete) >>>',
      'notify = ["npx", "-y", "ai-task-alarm", "--event", "complete"]',
      '[[hooks.PermissionRequest]]',
      'matcher = ".*"',
      '[[hooks.PermissionRequest.hooks]]',
      'type = "command"',
      'command = "npx -y ai-task-alarm --event question"',
      '# <<< ai-task-alarm <<<',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(fakeHome, '.codex', 'config.toml'), OLD_BLOCK);
    const mig = run(['setup', '--tools', 'codex'], { USERPROFILE: fakeHome });
    const migrated = fs.readFileSync(path.join(fakeHome, '.codex', 'config.toml'), 'utf8');
    check('migration exits 0', mig.status === 0 && mig.stdout.includes('updated to the new format'));
    check('migration drops old notify line', !migrated.includes('notify ='));
    check('migration adds hooks.Stop', migrated.includes('[[hooks.Stop]]'));
    check('migration keeps PermissionRequest', migrated.includes('[[hooks.PermissionRequest]]'));
    check('migration fully rebranded', !migrated.includes('ai-task-alarm') && !migrated.includes('ai-alarm'));
    const mig2 = run(['setup', '--tools', 'codex'], { USERPROFILE: fakeHome });
    check('post-migration run is already-present', mig2.stdout.includes('already set up'));

    // Opencode: pre-release plugin copy is removed so nothing rings twice.
    const legacyPlugin = path.join(fakeHome, '.config', 'opencode', 'plugins', 'ai-task-alarm.js');
    fs.writeFileSync(legacyPlugin, '// legacy copy');
    const leg = run(['setup', '--tools', 'opencode'], { USERPROFILE: fakeHome });
    check(
      'legacy plugin removed',
      !fs.existsSync(legacyPlugin) && leg.stdout.includes('old ai-task-alarm.js copy removed')
    );
    check(
      'current plugin intact',
      fs.existsSync(path.join(fakeHome, '.config', 'opencode', 'plugins', 'ai-agent-bell.js'))
    );

    // Opencode: a foreign DIY plugin using -WindowStyle Hidden minimizes the
    // user's terminal on every alarm. Setup warns but never deletes it.
    const roguePlugin = path.join(fakeHome, '.config', 'opencode', 'plugins', 'task-alarm.js');
    fs.writeFileSync(roguePlugin, 'powershell -NoProfile -WindowStyle Hidden -Command beep');
    const rogue = run(['setup', '--tools', 'opencode'], { USERPROFILE: fakeHome });
    const rogueOut = (rogue.stdout || '') + (rogue.stderr || '');
    check(
      'foreign -WindowStyle plugin triggers warning',
      rogue.status === 0 && rogueOut.includes('task-alarm.js') && rogueOut.includes('-WindowStyle')
    );
    check('foreign file left untouched (warn-only)', fs.existsSync(roguePlugin));
    fs.unlinkSync(roguePlugin); // keep the fake home clean for later checks

    // Corrupt JSON -> backup, not data loss.
    fs.writeFileSync(path.join(fakeHome, '.claude', 'settings.json'), '{broken');
    const r3 = run(['setup', '--tools', 'claude'], { USERPROFILE: fakeHome });
    const baks = fs.readdirSync(path.join(fakeHome, '.claude')).filter((f) => f.startsWith('settings.json.bak-'));
    check('corrupt json exits 0 with backup', r3.status === 0 && baks.length === 1);
    JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    check('recreated settings valid JSON', true);

    // Rebrand: pre-release hook entries rewrite in place, no duplicates.
    const OLD_CLAUDE = {
      Stop: [{ hooks: [{ type: 'command', command: 'npx -y ai-task-alarm --event complete', timeout: 30 }] }],
      Notification: [
        { hooks: [{ type: 'command', command: 'npx -y ai-alarm --event question', timeout: 30 }] },
      ],
    };
    fs.writeFileSync(path.join(fakeHome, '.claude', 'settings.json'), JSON.stringify(OLD_CLAUDE));
    const rb = run(['setup', '--tools', 'claude'], { USERPROFILE: fakeHome });
    const rebranded = fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8');
    const rebrandedObj = JSON.parse(rebranded);
    check('rebrand exits 0 and reports', rb.status === 0 && rb.stdout.includes('old alarm'));
    check('rebrand drops old brand', !rebranded.includes('ai-task-alarm') && !rebranded.includes('ai-alarm'));
    check('rebrand keeps one Stop group', rebrandedObj.Stop.length === 1);
    check(
      'rebrand backfills Notification matcher',
      (rebrandedObj.Notification[0].matcher || '').includes('permission_prompt')
    );
    const rb2 = run(['setup', '--tools', 'claude'], { USERPROFILE: fakeHome });
    check('post-rebrand run exits 0', rb2.status === 0);
    const rebranded2 = fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8');
    check('rebrand idempotent (no dup groups)', rebranded2 === rebranded);

    // --- D. adapter dispatcher (stubbed children, silent) ---
    // The adapter is ESM (opencode loads it as a module), so it is imported
    // through a .mjs copy; content is byte-identical to the baked file.
    // The 2.x server calls the default export's setup(ctx) and streams events
    // through ctx.event.subscribe({ signal }); the extra server() method
    // covers opencode 1.18.29+ object entrypoints.
    const { pathToFileURL } = require('node:url');
    const esmTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aitest-esm-'));
    // Ring claims live in <tmpdir>/ai-agent-bell-locks (shared across the
    // several plugin instances the host runs). Point tmpdir at a fresh dir so
    // runs never inherit claims from earlier tests or the host machine.
    const lockTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aitest-locks-'));
    const lockDir = path.join(lockTmp, 'ai-agent-bell-locks');
    const prevTmpEnv = { TEMP: process.env.TEMP, TMP: process.env.TMP };
    process.env.TEMP = lockTmp;
    process.env.TMP = lockTmp;
    const spawns = [];
    const execs = []; // records stubbed playAlarm calls in D3
    const origSpawn = cp.spawn;
    cp.spawn = (...a) => {
      spawns.push(a);
      return {
        unref() {
          spawns[spawns.length - 1].unrefCalled = true;
        },
        on() {}, // alarm() attaches an 'error' fallback handler
      };
    };
    // Fake 2.x plugin context: one scripted event stream, then silence until
    // the plugin unloads — exactly how the live stream behaves between bursts.
    const makeCtx = (events) => ({
      event: {
        subscribe: ({ signal }) => ({
          [Symbol.asyncIterator]: () => {
            let i = 0;
            return {
              next: () =>
                i < events.length
                  ? Promise.resolve({ value: events[i++], done: false })
                  : new Promise((resolve) => {
                      if (signal.aborted) return resolve({ value: undefined, done: true });
                      signal.addEventListener('abort', () => resolve({ value: undefined, done: true }), {
                        once: true,
                      });
                    }),
              return: () => Promise.resolve({ value: undefined, done: true }),
            };
          },
        }),
      },
    });
    const waitFor = async (fn, ms = 3000) => {
      const t0 = Date.now();
      while (!fn()) {
        if (Date.now() - t0 > ms) return false;
        await new Promise((r) => setTimeout(r, 10));
      }
      return true;
    };
    try {
      // Pre-seeded claims in the overridden tmpdir: a FRESH claim means
      // another plugin instance rang just now (must stay silent); a STALE
      // claim (1h old) means a real new completion (takeover must ring).
      fs.mkdirSync(lockDir, { recursive: true });
      const freshClaim = String(Date.now());
      fs.writeFileSync(path.join(lockDir, 'complete-ses_fresh.lock'), freshClaim);
      fs.writeFileSync(path.join(lockDir, 'complete-ses_stale.lock'), '0');
      const staleTime = new Date(Date.now() - 3600 * 1000);
      fs.utimesSync(path.join(lockDir, 'complete-ses_stale.lock'), staleTime, staleTime);

      // D1: setup-baked copy — 2.x shape, payloads on .data, plus legacy
      // .properties events still honored for 1.x parity. Spawns stub out.
      const toMjs = (p, name) => {
        const dest = path.join(esmTmp, name);
        fs.writeFileSync(dest, fs.readFileSync(p, 'utf8'));
        return pathToFileURL(dest).href;
      };
      const baked = await import(
        toMjs(path.join(fakeHome, '.config', 'opencode', 'plugins', 'ai-agent-bell.js'), 'baked.mjs')
      );
      check(
        'baked copy default export is a definition (id + setup + server)',
        baked.default.id === 'ai-agent-bell' &&
          typeof baked.default.setup === 'function' &&
          typeof baked.default.server === 'function'
      );
      const stop = baked.default.setup(
        makeCtx([
          { type: 'session.created', data: { sessionID: 'ses_main', info: {} } }, // parent itself: tracked, silent
          { type: 'session.created', data: { sessionID: 'ses_child', parentID: 'ses_main' } }, // subagent: tracked, silent
          { type: 'session.idle', data: { sessionID: 'ses_main' } }, // main done -> complete #1
          { type: 'session.status', data: { sessionID: 'ses_main2', status: { type: 'idle' } } }, // modern idle -> complete #2
          { type: 'session.status', data: { sessionID: 'ses_main2', status: { type: 'busy' } } }, // mid-task busy -> silent
          { type: 'session.execution.succeeded', data: { sessionID: 'ses_v2a' } }, // 2.x completion -> complete #3
          { type: 'session.execution.succeeded', data: { sessionID: 'ses_v2a' } }, // other plugin instance already rang -> claim fresh, silent
          { type: 'session.execution.failed', data: { sessionID: 'ses_v2b' } }, // 2.x failure -> error #4
          { type: 'session.idle', data: { sessionID: 'ses_fresh' } }, // pre-existing fresh claim -> silent
          { type: 'session.execution.succeeded', data: { sessionID: 'ses_stale' } }, // stale claim -> takeover -> complete #5
          { type: 'session.execution.succeeded', data: { sessionID: 'ses_child' } }, // child 2.x completion mid-task -> silent
          { type: 'session.execution.failed', data: { sessionID: 'ses_child' } }, // child 2.x failure mid-task -> silent
          { type: 'session.idle', data: { sessionID: 'ses_child' } }, // subagent done, main running -> silent
          { type: 'session.idle', data: { sessionID: 'ses_main' } }, // same-session double-fire -> cooldown silent
          { type: 'permission.asked', data: { sessionID: 'ses_p1' } }, // question #6
          { type: 'question.asked', properties: { sessionID: 'ses_p2' } }, // legacy 1.x payload -> question #7
          { type: 'permission.updated', properties: { sessionID: 'ses_p3' } }, // legacy 1.x payload -> question #8
          { type: 'form.created', data: { form: { id: 'f1', sessionID: 'ses_p4' } } }, // 2.x question form -> #9
          { type: 'tool.execute.before', properties: { sessionID: 'ses_p5', tool: 'question' } }, // legacy -> #10
          { type: 'tool.execute.before', properties: { sessionID: 'ses_p6', tool: 'read' } }, // other tool -> silent
          { type: 'session.error', data: { sessionID: 'ses_e1' } }, // error #11
          { type: 'session.error', data: { sessionID: 'ses_child' } }, // child error -> silent
          { type: 'whatever', data: {} },
        ])
      );
      check('baked copy spawns 11x (mid-task noise ignored)', await waitFor(() => spawns.length === 11));
      check('setup returns an abort-style cleanup', typeof stop === 'function');
      check(
        'spawn targets node + CLI with event kind',
        spawns.length === 11 &&
          spawns[0][0] === process.execPath &&
          spawns[0][1][0].endsWith('ai-agent-bell.js') &&
          spawns[0][1].includes('--event') &&
          spawns[0][1].includes('complete') && // 1.x session.idle
          spawns[1][1].includes('complete') && // 1.x session.status idle
          spawns[2][1].includes('complete') && // 2.x session.execution.succeeded
          spawns[3][1].includes('error') && // 2.x session.execution.failed
          spawns[4][1].includes('complete') && // stale claim taken over
          spawns[5][1].includes('question') &&
          spawns[6][1].includes('question') &&
          spawns[7][1].includes('question') &&
          spawns[8][1].includes('question') &&
          spawns[9][1].includes('question') &&
          spawns[10][1].includes('error')
      );
      // Cross-instance claims: one lock per ring (11) + the pre-seeded fresh
      // one that blocked a ring (12); the stale one was taken over in place.
      const lockFiles = fs.readdirSync(lockDir).filter((f) => f.endsWith('.lock'));
      check('cross-instance ring claims written (11 rings + 1 blocked)', lockFiles.length === 12);
      check(
        'fresh claim blocked a ring (file untouched)',
        fs.readFileSync(path.join(lockDir, 'complete-ses_fresh.lock'), 'utf8') === freshClaim
      );
      check(
        'spawn detached, hidden, unref (never the opencode binary)',
        spawns.every((s) => s[2] && s[2].detached && s[2].windowsHide && !String(s[0]).includes('opencode'))
      );
      check('spawn path unref called', spawns.every((s) => s.unrefCalled));
      if (typeof stop === 'function') stop();

      // D2: unbaked copy (hand-copied file) falls back to inline beeps, silent here.
      spawns.length = 0;
      const plain = await import(toMjs(path.join(ROOT, 'adapters', 'opencode-plugin.js'), 'plain.mjs'));
      plain.default.setup(makeCtx([{ type: 'session.idle', data: {} }]));
      check(
        'fallback used when CLI missing (powershell spawn, no CLI)',
        (await waitFor(() => spawns.length === 1)) &&
          spawns[0][0] === 'powershell' &&
          !spawns[0][1].join(' ').includes('ai-agent-bell.js')
      );
      check('fallback beeps complete freq', spawns[0][1].join(' ').includes('1000'));

      // D3: npm-mode entry resolves via detectors registry (stubbed playAlarm, no sound).
      // index.mjs is ESM with relative imports, so it is copied to a .mjs file
      // at the repo root (same dir -> relatives resolve) and removed afterwards.
      // The lib/alarm stub is installed BEFORE import; index.mjs looks the call
      // up at event time, so the stub is honoured.
      const alarmLib = require('../lib/alarm');
      const realPlay = alarmLib.playAlarm;
      alarmLib.playAlarm = async (opts) => {
        execs.push(['playAlarm-stub', opts.event]);
        return { event: opts.event, times: 0, stoppedEarly: false };
      };
      const indexTmp = path.join(ROOT, '.smoke-index-check.mjs');
      try {
        fs.writeFileSync(indexTmp, fs.readFileSync(path.join(ROOT, 'index.mjs'), 'utf8'));
        const npmPlugin = await import(pathToFileURL(indexTmp).href);
        npmPlugin.default.setup(
          makeCtx([
            { type: 'session.created', data: { sessionID: 'c1', parentID: 'm1' } }, // subagent tracked, silent
            { type: 'session.idle', data: { sessionID: 'm1' } }, // complete
            { type: 'session.idle', data: { sessionID: 'c1' } }, // child idle mid-task -> silent
            { type: 'session.status', data: { sessionID: 'm2', status: 'idle' } }, // complete (string status shape)
            { type: 'session.status', data: { sessionID: 'm2', status: 'busy' } }, // mid-task busy -> silent
            { type: 'session.execution.succeeded', data: { sessionID: 'm3' } }, // 2.x completion -> complete
            { type: 'session.execution.succeeded', data: { sessionID: 'm3' } }, // fan-out duplicate -> cooldown silent
            { type: 'session.execution.failed', data: { sessionID: 'm4' } }, // 2.x failure -> error
            { type: 'session.execution.succeeded', data: { sessionID: 'c1' } }, // child 2.x completion -> silent
            { type: 'permission.asked', data: { sessionID: 'q1' } }, // question
            { type: 'form.created', data: { form: { id: 'f1', sessionID: 'q2' } } }, // 2.x question form -> question
            { type: 'tool.execute.before', properties: { sessionID: 'q3', tool: 'question' } }, // legacy question
            { type: 'tool.execute.before', properties: { sessionID: 'q4', tool: 'bash' } }, // other tool -> silent
            { type: 'nope', data: {} },
          ])
        );
        const drained = await waitFor(() => execs.filter((a) => a[0] === 'playAlarm-stub').length === 7);
        const stubCalls = execs.filter((a) => a[0] === 'playAlarm-stub').map((a) => a[1]);
        check(
          'npm plugin maps idle/status/execution+questions, ignores child/busy/unknown',
          drained && JSON.stringify(stubCalls) === '["complete","complete","complete","error","question","question","question"]'
        );
      } finally {
        alarmLib.playAlarm = realPlay;
        try {
          fs.unlinkSync(indexTmp);
        } catch (_) {}
      }
    } finally {
      cp.spawn = origSpawn;
      if (prevTmpEnv.TEMP === undefined) delete process.env.TEMP;
      else process.env.TEMP = prevTmpEnv.TEMP;
      if (prevTmpEnv.TMP === undefined) delete process.env.TMP;
      else process.env.TMP = prevTmpEnv.TMP;
      fs.rmSync(esmTmp, { recursive: true, force: true });
      fs.rmSync(lockTmp, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(fakeProj, { recursive: true, force: true });
  }

  console.log(failures === 0 ? 'SMOKE ALL PASSED' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
