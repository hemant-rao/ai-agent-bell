'use strict';

// Terminal channel: terminal bell (flashes the tab) + one status line.

function bell(count = 1) {
  try {
    process.stdout.write('\x07'.repeat(count));
  } catch (_) {
    /* stdout may be closed in detached plugins */
  }
}

function announce(label, times) {
  console.log(`[ai-agent-bell] ${label} — alarm x${times} (click, press any key, or wait)`);
}

module.exports = { bell, announce };
