'use strict';

// Sound channel: plays the detector's pattern N times (~1s per round).
//
// Early stop (best experience):
//   - Windows: ANY mouse click stops the alarm (polled every round, zero deps).
//   - Terminal: pressing ANY key stops it (only when stdin is a real terminal,
//     so piped hook input is never disturbed).
//   - Otherwise it plays all N rounds and stops by itself.
//
// Every player runs as a killable child process; nothing here can hang the
// caller longer than one round after a stop request.

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

/** Arm "press any key to stop". Returns a disarm function. No-op without a TTY. */
function armKeyStop(state) {
  const stdin = process.stdin;
  if (!state.keyStop || !stdin || !stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return () => {};
  }
  const onData = () => {
    state.stop = true;
    try {
      if (state.child) state.child.kill();
    } catch (_) {}
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
 * Build ONE PowerShell script that plays all N rounds. A single process
 * means a single slow startup, and the mouse is polled between (and inside)
 * every round, so a click stops the alarm within ~half a second.
 * Exit code 7 = user clicked; 0 = all rounds played.
 */
function buildWindowsLoop(detector, n) {
  const freq = Number(detector.freq) || 1000;
  const alt = Number(detector.freqAlt) || freq;
  const check = "if ($watch -and [int][System.Windows.Forms.Control]::MouseButtons -ne 0) { exit 7 }";
  const round =
    detector.pattern === 'urgent'
      ? `[console]::beep(${freq},280); ${check}; [console]::beep(${alt},280); Start-Sleep -Milliseconds 150`
      : detector.pattern === 'double'
        ? `[console]::beep(${freq},220); Start-Sleep -Milliseconds 150; ${check}; [console]::beep(${freq},220); Start-Sleep -Milliseconds 350`
        : detector.pattern === 'slow'
          ? `[console]::beep(${freq},350); ${check}; [console]::beep(${freq},350); Start-Sleep -Milliseconds 600`
          : `[console]::beep(${freq},350); ${check}; [console]::beep(${freq},350); Start-Sleep -Milliseconds 200`;
  return [
    '$watch = $false',
    'try { Add-Type -AssemblyName System.Windows.Forms; $watch = $true } catch {}',
    `for ($i=0; $i -lt ${n}; $i++) { ${check}; ${round} }`,
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
  const state = { stop: false, child: null, keyStop: opts.keyStop !== false };
  const disarm = armKeyStop(state);
  try {
    if (platform === 'win32') {
      const r = await runCmd(
        'powershell',
        ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', buildWindowsLoop(detector, n)],
        n * 3000 + 15000,
        (c) => {
          state.child = c;
        }
      );
      state.child = null;
      const clicked = r.code === 7 || state.stop;
      return { played: clicked ? 0 : n, stoppedEarly: clicked };
    }
    let played = 0;
    for (let i = 0; i < n; i++) {
      if (state.stop) break;
      // One round; the live child is tracked so a keypress kills it mid-beep.
      const outcome = await playRound(detector, platform, (c) => {
        state.child = c;
      });
      state.child = null;
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
    disarm();
  }
}

module.exports = { playSound, playRound, buildWindowsLoop };
