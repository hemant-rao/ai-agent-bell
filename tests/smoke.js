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
  const help = run(['--help']);
  check('--help exits 0 and documents setup', help.status === 0 && help.stdout.includes('setup'));
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
  const cfgShow = run(['config']);
  check('config shows file path', cfgShow.status === 0 && cfgShow.stdout.includes('config.json'));

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
  check('opencode permission -> question', detectors.forToolEvent('opencode', 'permission.asked')?.id === 'question');
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

  // Packaging: every runtime require must ship on npm.
  const pkgFiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).files;
  check('files[] ships detectors/', pkgFiles.includes('detectors/'));
  check('files[] ships notifications/', pkgFiles.includes('notifications/'));
  check('files[] ships lib/', pkgFiles.includes('lib/'));
  check('files[] ships bin/', pkgFiles.includes('bin/'));
  check('files[] ships adapters/', pkgFiles.includes('adapters/'));

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

    // Pre-existing user configs must be preserved.
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, '.claude', 'settings.json'),
      '{"keep": true, "Stop": [{"hooks": [{"type": "command", "command": "lint"}]}]}'
    );
    fs.mkdirSync(path.join(fakeHome, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.codex', 'config.toml'), 'model = "x"\n');

    const r1 = run(['setup', '--times', '7'], { USERPROFILE: fakeHome });
    check('setup exits 0', r1.status === 0);
    const afterSave = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.config', 'ai-agent-bell', 'config.json'), 'utf8')
    );
    check('setup --times persists 7', afterSave.times === 7);
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
    check('no leftover placeholder', !pluginCopy.includes('__CLI_ABS_PATH__'));
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
    check('migration exits 0', mig.status === 0 && mig.stdout.includes('migrated'));
    check('migration drops old notify line', !migrated.includes('notify ='));
    check('migration adds hooks.Stop', migrated.includes('[[hooks.Stop]]'));
    check('migration keeps PermissionRequest', migrated.includes('[[hooks.PermissionRequest]]'));
    check('migration fully rebranded', !migrated.includes('ai-task-alarm') && !migrated.includes('ai-alarm'));
    const mig2 = run(['setup', '--tools', 'codex'], { USERPROFILE: fakeHome });
    check('post-migration run is already-present', mig2.stdout.includes('already present'));

    // Opencode: pre-release plugin copy is removed so nothing rings twice.
    const legacyPlugin = path.join(fakeHome, '.config', 'opencode', 'plugins', 'ai-task-alarm.js');
    fs.writeFileSync(legacyPlugin, '// legacy copy');
    const leg = run(['setup', '--tools', 'opencode'], { USERPROFILE: fakeHome });
    check('legacy plugin removed', !fs.existsSync(legacyPlugin) && leg.stdout.includes('legacy'));
    check(
      'current plugin intact',
      fs.existsSync(path.join(fakeHome, '.config', 'opencode', 'plugins', 'ai-agent-bell.js'))
    );

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
    check('rebrand exits 0 and reports', rb.status === 0 && rb.stdout.includes('rebranded'));
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
    const spawns = [];
    const execs = [];
    const origSpawn = cp.spawn;
    const origExec = cp.execFileSync;
    cp.spawn = (...a) => {
      spawns.push(a);
      return { unref() { spawns[spawns.length - 1].unrefCalled = true; } };
    };
    cp.execFileSync = (...a) => {
      execs.push(a);
      return Buffer.from('');
    };
    try {
      // D1: setup-baked copy spawns the real CLI detached (never executed here).
      const baked = require(path.join(fakeHome, '.config', 'opencode', 'plugins', 'ai-agent-bell.js'));
      const hooks = await baked.TaskAlarm({});
      await hooks.event({ event: { type: 'session.idle' } });
      await hooks.event({ event: { type: 'permission.asked' } });
      await hooks.event({ event: { type: 'session.error' } });
      await hooks.event({ event: { type: 'whatever' } });
      check('baked copy spawns 3x (unknown ignored)', spawns.length === 3);
      check(
        'spawn targets CLI with event kind',
        spawns[0][1][0].endsWith('ai-agent-bell.js') &&
          spawns[0][1].includes('--event') &&
          spawns[0][1].includes('complete') &&
          spawns[2][1].includes('error')
      );
      check('spawn detached + unref', spawns.every((s) => s[2] && s[2].detached && s[0] === process.execPath));
      check('spawn path unref called', spawns.every((s) => s.unrefCalled));

      // D2: unbaked copy (hand-copied file) falls back to inline beeps, silent here.
      spawns.length = 0;
      execs.length = 0;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aitest-adapter-'));
      const srcAdapter = fs.readFileSync(path.join(ROOT, 'adapters', 'opencode-plugin.js'), 'utf8');
      const plainDest = path.join(tmpDir, 'plain-copy.js');
      fs.writeFileSync(plainDest, srcAdapter); // placeholder intact -> cliAvailable false
      const plain = require(plainDest);
      const hooks2 = await plain.TaskAlarm({});
      await hooks2.event({ event: { type: 'session.idle' } });
      check('fallback used when CLI missing (no spawn)', spawns.length === 0 && execs.length === 1);
      check('fallback beeps complete freq', execs[0][0] === 'powershell' && execs[0][1].join(' ').includes('1000'));
      fs.rmSync(tmpDir, { recursive: true, force: true });

      // D3: npm-mode plugin resolves via detectors registry (stubbed spawn path).
      // index.js plays in-process, so here we only verify mapping without sound:
      // swap playAlarm out by requiring index with a stubbed lib/alarm.
      const alarmPath = require.resolve('../lib/alarm');
      const realAlarm = require(alarmPath);
      require.cache[alarmPath].exports = {
        playAlarm: async (opts) => {
          execs.push(['playAlarm-stub', opts.event]);
          return { event: opts.event, times: 0, stoppedEarly: false };
        },
      };
      delete require.cache[require.resolve('../index.js')];
      const npmPlugin = require('../index.js');
      const hooks3 = await npmPlugin.TaskAlarm({});
      await hooks3.event({ event: { type: 'session.idle' } });
      await hooks3.event({ event: { type: 'permission.asked' } });
      await hooks3.event({ event: { type: 'nope' } });
      const stubCalls = execs.filter((a) => a[0] === 'playAlarm-stub').map((a) => a[1]);
      check('npm plugin maps idle+permission, ignores unknown', JSON.stringify(stubCalls) === '["complete","question"]');
      require.cache[alarmPath].exports = realAlarm;
    } finally {
      cp.spawn = origSpawn;
      cp.execFileSync = origExec;
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
