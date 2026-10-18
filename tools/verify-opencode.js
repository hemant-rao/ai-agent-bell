#!/usr/bin/env node
'use strict';

/**
 * Live compatibility check: proves the plugin loads on the CURRENTLY INSTALLED
 * opencode, using the real host instead of a stubbed one.
 *
 * WHY THIS EXISTS
 *   The opencode plugin API is host-versioned. 1.x loaded named-export
 *   factories and delivered event.properties; 2.x requires a default
 *   `{ id, setup }` definition and delivers event.data ("Plugin must export a
 *   default definition..." was exactly that drift). Unit tests stub the host,
 *   so only a real load can catch this class of break. Run this after every
 *   opencode upgrade and before every release; a weekly CI canary runs it
 *   against the latest opencode too.
 *
 * WHAT IT CHECKS (throwaway HOME, silent, no model calls)
 *   1. `bin/ai-agent-bell.js setup --tools opencode` installs the file-copy
 *      plugin into the throwaway HOME's global plugins dir (this is what
 *      almost every user has). A private `opencode serve` instance must boot
 *      with the fake HOME and report it ACTIVE.
 *   2. `npm pack` + a scratch `npm install` + a `plugins` entry in the
 *      throwaway opencode config must load the package the same way (catches
 *      files[]/exports/main resolution breaks). For this the file copy is
 *      removed first: the loader rejects duplicate plugin IDs ("Duplicate
 *      plugin ID: ai-agent-bell"), so one server can only test one source.
 *   3. Node itself resolves the installed package and its default export has
 *      the V2 shape (id + setup + server).
 *   4. opencode.log stays free of "failed to load plugin" / duplicate-ID rows.
 *
 * HOST TRICKS LEARNED THE HARD WAY (opencode 2.0.32, do not re-learn)
 *   - `opencode api` without flags targets the SHARED background service and
 *     will try to start one for the fake HOME on the REAL service's port
 *     (collision). `--standalone` spawns a private `serve --stdio` that
 *     answers /api/plugin EMPTY (registry race, never populated in time).
 *   - `opencode serve --hostname 127.0.0.1 --port <free>` (no --service) runs
 *     a plain private server: no shared-service registration, no fixed port.
 *     It prints `server password <pw>` on stdout; requests need
 *     `Authorization: Basic base64("opencode:<pw>")`.
 *   - The plugin registry fills in ASYNCHRONOUSLY after boot (~a few
 *     seconds): /api/plugin returns `data: []` at first and 90-ish entries
 *     later, so poll until non-empty instead of trusting the first answer.
 *
 * HOW IT STAYS SAFE
 *   - USERPROFILE/HOME point at a temp dir, so the real config and logs are
 *     never touched, and the private server never binds the background
 *     service port — the user's running service cannot be disturbed.
 *   - The plugin never rings here: no session ever completes, and unmapped
 *     lifecycle events are ignored by design.
 *
 * Usage:  npm run verify:opencode
 *         OPENCODE_BIN=path\opencode npm run verify:opencode
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-agent-bell.js');
const OPENCODE = process.env.OPENCODE_BIN || 'opencode';
const IS_WIN = process.platform === 'win32';

let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) {
    failures++;
    if (detail) console.log('     ' + String(detail).split('\n').slice(0, 12).join('\n     '));
  }
}
function note(msg) {
  console.log('[verify-opencode] ' + msg);
}
function quoteIfNeeded(s) {
  return /\s/.test(s) && !/^".*"$/.test(s) ? '"' + s + '"' : s;
}
// Windows cannot CreateProcess a .cmd/.ps1 shim (npm, opencode) directly, so
// those calls go through the shell, with space-safe quoting of every argument
// (paths can contain spaces). process.execPath is a real .exe and runs without
// a shell, so arguments with `||`/`|`/`&` (the node checks below) survive
// intact instead of being mangled by cmd.exe.
function run(cmd, args, opts = {}) {
  const shell = opts.shell !== undefined ? opts.shell : IS_WIN;
  const base = {
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    windowsHide: true,
    ...opts,
  };
  if (!shell) return spawnSync(cmd, args, { ...base, shell: false });
  // Shell mode: pass ONE command string and no args array — Node deprecates
  // args-array + shell:true (DEP0190), and we control quoting anyway.
  return spawnSync([quoteIfNeeded(cmd), ...args.map(quoteIfNeeded)].join(' '), { ...base, shell: true });
}

const HOME_ENV = (home) => ({ ...process.env, USERPROFILE: home, HOME: home });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tail(s, n = 800) {
  s = String(s || '');
  return s.length > n ? '...' + s.slice(-n) : s;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      try {
        process.kill(-pid, 'SIGKILL'); // detached process group
      } catch (_) {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch (_) {
    /* best effort */
  }
}

// Boots a private opencode server for the throwaway HOME and returns its
// /api/plugin list once the async registry has filled in.
async function servePluginList(env, cwd, label) {
  const port = await freePort();
  const serveArgs = ['serve', '--hostname', '127.0.0.1', '--port', String(port)];
  const child = IS_WIN
    ? spawn([quoteIfNeeded(OPENCODE), ...serveArgs].join(' '), {
        env,
        cwd,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn(OPENCODE, serveArgs, {
        env,
        cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  let out = '';
  let err = '';
  let exited = false;
  child.stdout.on('data', (d) => {
    out += d;
  });
  child.stderr.on('data', (d) => {
    err += d;
  });
  child.on('exit', () => {
    exited = true;
  });
  try {
    let pw = '';
    for (let i = 0; i < 60 && !pw; i++) {
      await sleep(500);
      const m = out.match(/server password (\S+)/);
      if (m) pw = m[1];
      if (exited && !pw) break;
    }
    if (!pw) {
      return { ok: false, detail: label + ': server never printed a password (exited=' + exited + ')\n' + tail(out + err) };
    }
    const auth = 'Basic ' + Buffer.from('opencode:' + pw).toString('base64');
    const url = 'http://127.0.0.1:' + port + '/api/plugin';
    for (let i = 0; i < 90; i++) {
      try {
        const res = await fetch(url, { headers: { authorization: auth } });
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.data) && json.data.length > 0) {
            return { ok: true, list: json };
          }
        }
      } catch (_) {
        /* server still booting */
      }
      if (exited) break;
      await sleep(500);
    }
    return { ok: false, detail: label + ': plugin registry never filled in (exited=' + exited + ')\n' + tail(out + err) };
  } finally {
    killTree(child.pid);
  }
}

const RESOLVE_SCRIPT =
  "import('ai-agent-bell').then((m)=>{const d=m.default;" +
  "if(!d||d.id!=='ai-agent-bell'||typeof d.setup!=='function'||typeof d.server!=='function')process.exit(3);" +
  "console.log('ok')}).catch((e)=>{console.error(e&&e.message);process.exit(4)})";

function bellEntries(result) {
  return result.ok ? result.list.data.filter((p) => p && p.id === 'ai-agent-bell') : [];
}
function isActive(p) {
  return !!(p.state && p.state.status === 'active');
}
function isSetupCopy(p, pluginFile) {
  const t = p.source && p.source.path;
  return !!t && path.resolve(String(t)).toLowerCase() === path.resolve(pluginFile).toLowerCase();
}
function isPackaged(p) {
  const t = (p.source && p.source.path) || '';
  return /node_modules[\\/]ai-agent-bell[\\/]/.test(String(t));
}

async function main() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aab-verify-home-'));
  const tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'aab-verify-work-'));
  const env = HOME_ENV(tmpHome);
  const consumer = path.join(tmpWork, 'consumer');
  const pluginFile = path.join(tmpHome, '.config', 'opencode', 'plugins', 'ai-agent-bell.js');
  try {
    note('throwaway HOME: ' + tmpHome);
    const version = run(OPENCODE, ['--version'], { env, timeout: 30000 });
    note('opencode: ' + (version.stdout || version.stderr || version.error || '?').trim());

    // 1. File-copy plugin, exactly as `setup` installs it for real users.
    const setup = run(process.execPath, [CLI, 'setup', '--tools', 'opencode'], {
      env,
      timeout: 60000,
      shell: false,
    });
    check('setup --tools opencode exits 0', setup.status === 0, tail(setup.stderr));
    check('setup wrote the global plugin copy', fs.existsSync(pluginFile));
    if (fs.existsSync(pluginFile)) {
      const src = fs.readFileSync(pluginFile, 'utf8');
      check('plugin copy is V2-shaped (default definition)', src.includes('export default {') && src.includes('setup(ctx)'));
    }

    // 2. Build the published package exactly as users get it from npm.
    fs.mkdirSync(consumer, { recursive: true });
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'verify-consumer', private: true }));
    const pack = run('npm', ['pack', ROOT, '--json'], { cwd: tmpWork, timeout: 120000 });
    let tarball = '';
    try {
      const parsed = JSON.parse(String(pack.stdout).slice(String(pack.stdout).indexOf('[')));
      tarball = path.join(tmpWork, parsed[0].filename);
    } catch (_) {
      /* handled below */
    }
    check('npm pack produces a tarball', !!tarball && fs.existsSync(tarball), tail(pack.stderr));
    let installed = '';
    if (tarball) {
      const install = run('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: consumer, timeout: 120000 });
      installed = path.join(consumer, 'node_modules', 'ai-agent-bell');
      check('npm install of the tarball exits 0', install.status === 0, tail(install.stderr));
      check('tarball installs as node_modules/ai-agent-bell', fs.existsSync(path.join(installed, 'package.json')));
      const resolve = run(process.execPath, ['--input-type=module', '-e', RESOLVE_SCRIPT], {
        cwd: consumer,
        timeout: 30000,
        shell: false,
      });
      check(
        'Node resolves the package to a V2 default definition',
        resolve.status === 0 && String(resolve.stdout).includes('ok'),
        tail(resolve.stderr) || tail(resolve.stdout)
      );
    }

    // 3. Real host load, phase A: only the setup file-copy is installed.
    const cycleA = await servePluginList(env, tmpHome, 'setup copy');
    check('private server boots and fills its registry (setup copy)', cycleA.ok, cycleA.detail);
    const entriesA = bellEntries(cycleA);
    check(
      'setup copy loads as ACTIVE on the real server',
      entriesA.some((p) => isActive(p) && isSetupCopy(p, pluginFile)),
      entriesA.length ? JSON.stringify(entriesA) : 'no ai-agent-bell entry'
    );

    // 4. Real host load, phase B: package only (duplicate IDs are rejected,
    //    so the file copy must be gone before the package can load).
    if (installed) {
      fs.rmSync(pluginFile, { force: true });
      const configDir = path.join(tmpHome, '.config', 'opencode');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'opencode.json'),
        JSON.stringify({ $schema: 'https://opencode.ai/config.json', plugins: [installed] }, null, 2)
      );
      const cycleB = await servePluginList(env, tmpHome, 'installed package');
      check('private server boots and fills its registry (installed package)', cycleB.ok, cycleB.detail);
      const entriesB = bellEntries(cycleB);
      check(
        'installed package loads as ACTIVE on the real server',
        entriesB.some((p) => isActive(p) && isPackaged(p)),
        entriesB.length ? JSON.stringify(entriesB) : 'no ai-agent-bell entry'
      );
    }

    // 5. The log is the ground truth for load failures, whatever the list says.
    const logFile = path.join(tmpHome, '.local', 'share', 'opencode', 'log', 'opencode.log');
    if (fs.existsSync(logFile)) {
      const log = fs.readFileSync(logFile, 'utf8');
      const failed = log
        .split('\n')
        .filter(
          (l) =>
            l.includes('ai-agent-bell') &&
            (l.includes('failed to load plugin') || l.includes('Duplicate plugin ID'))
        );
      check('no plugin load failures in opencode.log', failed.length === 0, failed.join('\n'));
    } else {
      note('note: opencode.log not found under the throwaway HOME; skipped log scan');
    }
  } finally {
    if (failures === 0) {
      // Windows keeps handles on the log/db files open for a moment after the
      // private server is killed: wait, retry, and never fail the run over a
      // stubborn temp dir (the OS cleans it up eventually).
      await sleep(1500);
      for (const dir of [tmpHome, tmpWork]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        } catch (_) {
          try {
            await sleep(2500);
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
          } catch (_) {
            note('could not remove temp dir (OS will clean up later): ' + dir);
          }
        }
      }
    } else {
      note('kept for debugging: ' + tmpHome + ' | ' + tmpWork);
    }
  }
  console.log(failures === 0 ? 'VERIFY ALL PASSED' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
