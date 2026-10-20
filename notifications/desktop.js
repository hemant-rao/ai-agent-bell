'use strict';

// Desktop channel: best-effort native toast next to the sound.
// Never throws and never blocks the alarm: every path is guarded.

const { execFileSync } = require('node:child_process');

function toast(title, message) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // BurntToast is optional; silently skipped when not installed.
      // Values travel as env vars, never interpolated into PowerShell code.
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'if (Get-Module -ListAvailable -Name BurntToast) { New-BurntToastNotification -Text $env:AI_AGENT_BELL_TITLE, $env:AI_AGENT_BELL_MESSAGE }',
        ],
        {
          stdio: 'ignore',
          timeout: 5000,
          windowsHide: true,
          env: {
            ...process.env,
            AI_AGENT_BELL_TITLE: String(title),
            AI_AGENT_BELL_MESSAGE: String(message),
          },
        }
      );
    } else if (platform === 'darwin') {
      execFileSync('osascript', ['-e', `display notification "${message}" with title "${title}"`], {
        stdio: 'ignore',
        timeout: 5000,
      });
    } else {
      execFileSync('notify-send', [title, message], { stdio: 'ignore', timeout: 5000 });
    }
  } catch (_) {
    /* toast is a bonus; the sound is the contract */
  }
}

module.exports = { toast };
