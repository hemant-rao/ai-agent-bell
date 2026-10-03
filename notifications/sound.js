'use strict';

// Sound channel: plays the detector's pattern N times.
//
// Early stop (best experience) — works even when the terminal is minimized
// or another app has focus:
//   - ANY mouse click or ANY common keypress stops the alarm via a dedicated
//     watcher process polling user32.GetAsyncKeyState every 50ms. It also
//     reports keys pressed since the previous poll, so even a 50ms tap is
//     caught. The watcher races the beep loop; whichever finishes first wins
//     and the other is killed.
//   - When the terminal itself has focus, a keypress additionally kills the
//     beep process instantly through a stdin listener (no TTY => skipped, so
//     piped hook input is never disturbed).
//   - Otherwise all N rounds play and it stops by itself.
//
// Nothing here can hide or minimize any window: children are spawned with
// windowsHide (no console of their own) and never touch other windows.

const { spawn } = require('node:child_process');
const terminal = require('./terminal');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run a command; never rejects. Resolves { ok, code }. */
function runCmd(cmd, args, timeoutMs = 15000, onSpawn) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
      if (typeof onSpawn === 'function') onSpawn(child);
    } catch (_) {
      resolve({ ok: false, code: -1 });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {}
      resolve({ ok: false, code: -1, child });
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, child });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, child });
    });
  });
}

/**
 * One audible round for the detector on non-Windows platforms.
 * (Windows runs the whole loop in a single PowerShell process instead —
 * see buildWindowsLoop — so there is only one slow process startup.)
 * @returns Promise<'stop'|'done'> — 'stop' is unused off-Windows, kept for shape.
 */
async function playRound(detector, platform, onSpawn) {
  const freq = Number(detector.freq) || 1000;
  const alt = Number(detector.freqAlt) || freq;

  if (platform === 'win32') {
    // Single-round path is intentionally unsupported here; playSound uses
    // buildWindowsLoop for all rounds in one process. Fall through to a bell
    // so direct callers still hear something.
    terminal.bell(detector.pattern === 'double' ? 2 : 1);
    await sleep(800);
    return 'done';
  }

  if (platform === 'darwin') {
    const r = await runCmd('afplay', [`/System/Library/Sounds/${detector.sounds.mac}`], 12000, onSpawn);
    if (!r.ok) {
      terminal.bell(detector.pattern === 'double' ? 2 : 1);
      await sleep(800);
    }
    return 'done';
  }

  // Linux / others: paplay -> beep -> terminal bell.
  const tries =
    detector.pattern === 'urgent'
      ? [
          ['paplay', [`/usr/share/sounds/freedesktop/stereo/${detector.sounds.linux}`]],
          ['beep', ['-f', String(freq), '-l', '280']],
        ]
      : [['paplay', [`/usr/share/sounds/freedesktop/stereo/${detector.sounds.linux}`]]];
  for (const [cmd, args] of tries) {
    const r = await runCmd(cmd, args, 8000, onSpawn);
    if (r.ok) {
      if (detector.pattern === 'urgent') {
        const r2 = await runCmd('beep', ['-f', String(alt), '-l', '280'], 8000, onSpawn);
        if (!r2.ok) terminal.bell(1);
      }
      return 'done';
    }
  }
  try {
    const r = await runCmd(
      'beep',
      detector.pattern === 'double'
        ? ['-f', String(freq), '-l', '220', '-n', '-f', String(freq), '-l', '220']
        : ['-f', String(freq), '-l', '700'],
      8000,
      onSpawn
    );
    if (!r.ok) throw new Error('no beep');
  } catch (_) {
    terminal.bell(detector.pattern === 'double' ? 2 : 1);
    await sleep(800);
  }
  return 'done';
}

/** Arm "press any key to stop". Returns a disarm function. No-op without a TTY.
 * `stdin` is a parameter (default: process.stdin) so the wiring is unit-testable.
 */
function armKeyStop(state, stdin = process.stdin) {
  if (!state.keyStop || !stdin || !stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return () => {};
  }
  const onData = () => {
    state.stop = true;
    for (const c of state.children || []) {
      try {
        c.kill();
      } catch (_) {}
    }
  };
  try {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  } catch (_) {
    return () => {};
  }
  return () => {
    try {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    } catch (_) {}
  };
}

/**
 * Build ONE PowerShell script that plays all N rounds in a single process
 * (one slow startup instead of one per round). It only beeps — stopping is
 * the watcher's job (see buildWindowsWatcher), so blocking beeps can never
 * hide a click.
 */
function buildWindowsLoop(detector, n) {
  const freq = Number(detector.freq) || 1000;
  const alt = Number(detector.freqAlt) || freq;
  const round =
    detector.pattern === 'urgent'
      ? `[console]::beep(${freq},280); [console]::beep(${alt},280); Start-Sleep -Milliseconds 150`
      : detector.pattern === 'double'
        ? `[console]::beep(${freq},220); Start-Sleep -Milliseconds 150; [console]::beep(${freq},220); Start-Sleep -Milliseconds 350`
        : detector.pattern === 'slow'
          ? `[console]::beep(${freq},700); Start-Sleep -Milliseconds 600`
          : `[console]::beep(${freq},700); Start-Sleep -Milliseconds 200`;
  return `for ($i=0; $i -lt ${n}; $i++) { ${round} }`;
}

/**
 * Build a tiny watcher that exits with code 7 the moment the user clicks
 * ANY mouse button or presses ANY common key — ANYWHERE, even when the
 * terminal is minimized or another app has focus. Zero dependencies:
 * user32.GetAsyncKeyState also reports keys pressed since the previous poll,
 * so even a 50ms tap between two 50ms polls is caught.
 */
function buildWindowsWatcher() {
  // 1,2,4 mouse L/R/M · 8 Back · 9 Tab · 13 Enter · 27 Esc · 32 Space ·
  // 48-57 digits · 65-90 A-Z · 112-123 F1-F12
  const keys = [1, 2, 4, 8, 9, 13, 27, 32];
  for (let k = 48; k <= 57; k++) keys.push(k);
  for (let k = 65; k <= 90; k++) keys.push(k);
  for (let k = 112; k <= 123; k++) keys.push(k);
  return [
    'Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern int GetAsyncKeyState(int vKey);\' -Name AiBellWatch -Namespace AiBell',
    `$keys = @(${keys.join(',')})`,
    // Prime once so clicks/keys from BEFORE the alarm don't stop it instantly.
    'foreach ($k in $keys) { [AiBell.AiBellWatch]::GetAsyncKeyState($k) | Out-Null }',
    'while ($true) { foreach ($k in $keys) { if ([AiBell.AiBellWatch]::GetAsyncKeyState($k) -ne 0) { exit 7 } }; Start-Sleep -Milliseconds 50 }',
  ].join('; ');
}

/**
 * Play the detector's sound `times` times.
 * @param {object} detector from detectors/
 * @param {number} times how many rounds (already validated by lib/config)
 * @param {{ keyStop?: boolean }} opts — keyStop false inside TUIs/plugins
 * @returns Promise<{ played: number, stoppedEarly: boolean }>
 */
async function playSound(detector, times, opts = {}) {
  const n = Math.min(60, Math.max(1, Math.floor(Number(times) || 1)));
  const platform = process.platform;
  const state = { stop: false, children: [], keyStop: opts.keyStop !== false };
  const disarm = armKeyStop(state);
  const track = (c) => {
    if (c) state.children.push(c);
  };
  const killAll = () => {
    for (const c of state.children) {
      try {
        c.kill();
      } catch (_) {}
    }
    state.children = [];
  };
  try {
    if (platform === 'win32') {
      // Beeps and watching run in PARALLEL: a blocking beep can never hide
      // a click, and both die the moment either finishes.
      const budget = n * 3000 + 20000;
      const beepP = runCmd(
        'powershell',
        ['-NoProfile', '-Command', buildWindowsLoop(detector, n)],
        budget,
        track
      ).then((r) => ({ side: 'beep', r }));
      const watchP = runCmd(
        'powershell',
        ['-NoProfile', '-Command', buildWindowsWatcher()],
        budget,
        track
      ).then((r) => ({ side: 'watch', r }));
      const first = await Promise.race([beepP, watchP]);
      killAll();
      await Promise.allSettled([beepP, watchP]);
      const stopped = (first.side === 'watch' && first.r.code === 7) || state.stop;
      return { played: stopped ? 0 : n, stoppedEarly: stopped };
    }
    let played = 0;
    for (let i = 0; i < n; i++) {
      if (state.stop) break;
      // One round; the live child is tracked so a keypress kills it mid-beep.
      const outcome = await playRound(detector, platform, track);
      if (outcome === 'stop' || state.stop) {
        state.stop = state.stop || outcome === 'stop';
        break;
      }
      played++;
      if (i === n - 1) break;
      await sleep(detector.gapMs || 200);
    }
    return { played, stoppedEarly: state.stop };
  } finally {
    killAll();
    disarm();
  }
}

module.exports = { playSound, playRound, buildWindowsLoop, buildWindowsWatcher, armKeyStop };
