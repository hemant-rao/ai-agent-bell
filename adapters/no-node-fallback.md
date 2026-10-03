# No-Node fallback (pure OS commands, no npm package needed)

If a machine has **no Node.js** (so `ai-agent-bell` can't run), paste the OS-native
one-liner directly into the hook command. Same alarm idea (repeat the loop as
many times as you like), same rule:
**global tool config only — never into a project folder.**

## Windows (PowerShell) — alarm, 10 rounds

```powershell
powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 10; $i++) { [console]::beep(1000, 800); Start-Sleep -Milliseconds 200 }"
```

- Question/approval needed → replace `1000` with `1400`
- Warning/failure → replace `1000` with `600`
- More/fewer rounds → replace `10` (loop count; roughly 1-2 seconds per round)

Use in hooks as the `command` value:

- Claude Code `~/.claude/settings.json` → `Stop` / `Notification` hooks
- Codex `~/.codex/config.toml` → `notify` / `PermissionRequest` hooks
- OpenCode → save as `~/.config/opencode/plugins/alarm-plain.js` with an
  `event` hook that spawns the command above on `session.idle` /
  `permission.asked` (see `opencode-plugin.js` for the event names)

## macOS — alarm, 10 rounds

```bash
for i in $(seq 1 10); do afplay /System/Library/Sounds/Glass.aiff; done
```

(`Ping.aiff` for questions, `Basso.aiff` for failures.)

## Linux — alarm, 10 rounds

```bash
for i in $(seq 1 10); do paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || aplay /usr/share/sounds/sound-icons/prompt.wav 2>/dev/null || sleep 1; printf '\a'; done
```

## Note: remote machines

Hooks run **where the agent runs**. On SSH/remote dev, the sound plays on
the remote machine, not your laptop. For remote work, prefer a notifier that
pushes to your device (e.g. a webhook/Telegram notifier) instead of sound.
