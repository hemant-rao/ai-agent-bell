# AI Agent Bell — memory (source of truth for future sessions)

> This folder is this repo's own memory. It replaces the scratch notes from
> when the package lived outside any repo. Keep it current after every change:
> architecture decisions, gotchas, release state.

## What it is

npm package **`ai-agent-bell`** (display name **AI Agent Bell**). A loud,
user-counted bell that rings when an AI coding agent finishes, fails, or
needs input — so the user stops staring at the screen. Global-only install,
zero project impact, CMD/terminal only, zero dependencies, Node 18+.

- npm: https://www.npmjs.com/package/ai-agent-bell
- GitHub: https://github.com/hemant-rao/ai-agent-bell (branch `main`)
- Author: Hemant Rao (npm `~mrhrao`, GitHub `hemant-rao`)
- License: MIT. All docs/comments/strings are **English-only** (verified by
  scan: zero Devanagari/Cyrillic; console mojibake of emoji/emdash is a
  font-rendering artifact, files are clean UTF-8).

## Architecture (flat on purpose)

```
bin/ai-agent-bell.js     CLI: alarm / test / config / setup (strict arg parser, exit 2 on misuse)
detectors/               WHAT happened: completion, input-required, error, warning + index.js registry
                         (single source of truth: CLI, plugins and setup all resolve through it)
notifications/           HOW it tells you: sound.js (engine), desktop.js (toast), terminal.js (bell+line)
lib/                     config.js (repeat-count file) + alarm.js (orchestrator)
adapters/                copy-paste pieces per tool (opencode-plugin.js, claude/codex snippets, no-node-fallback.md)
tests/smoke.js           silent suite (never plays sound; stubs children; fake HOME)
index.js                 opencode npm-plugin entry (fire-and-forget, quiet, keyStop:false)
```

- Legacy bin alias `ai-alarm` → same file (keeps pre-release hooks working).
- `package.json files[]` MUST list every runtime dir (`bin lib detectors
  notifications adapters index.js`). Guarded by a smoke check (the v1
  `files[]` bug shipped nothing and would have broken all requires).
- `npm test` = 13× `node --check` + `tests/smoke.js` (currently ~89 behavior
  checks). Whole suite is silent by design (CI-safe).

## Key behaviors (hard-won, do not regress)

1. **Repeat count** lives in ONE file: `~/.config/ai-agent-bell/config.json`
   (`{ "times": N }`, 1..30). Hooks call the CLI with no count; runtime
   resolves flag → file → default 10. `setup --times N` / `config --times N`
   writes it. `--duration` is a deprecated alias of `--times`.
2. **Early stop, global**: Windows watcher process polls
   `user32.GetAsyncKeyState` every 50ms (mouse L/R/M + Back/Tab/Enter/Esc/
   Space + 0-9 + A-Z + F1-F12), exits 7 on activity — works even when the
   terminal is minimized. Races the single-process beep loop; loser is
   killed. Focused terminals additionally get an instant stdin raw-mode key
   listener (TTY only — piped hook input never disturbed).
3. **No window changes, ever**: children spawn with `windowsHide` and NO
   `-WindowStyle Hidden` (probes proved spawn flags can't hide/minimize the
   parent console; the flag was removed everywhere as defence-in-depth).
4. **Per-tool wiring** (setup touches HOME only, never projects):
   - OpenCode → `~/.config/opencode/plugins/ai-agent-bell.js` (self-contained
     dispatcher: baked CLI path → detached CLI; inline beep fallback).
     Legacy `ai-task-alarm.js` copy is auto-removed to avoid double ringing.
   - Claude → global `~/.claude/settings.json`: `Stop`→complete,
     `StopFailure`→error, `Notification`→question with matcher restricted to
     `permission_prompt|idle_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input`.
     Semantics: Stop = response/turn finished (NOT whole task).
   - Codex → global `~/.codex/config.toml`: `[[hooks.Stop]]`→complete,
     `[[hooks.PermissionRequest]]`→question. NEVER a top-level `notify` key
     (duplicate-TOML-key risk). Migrates our own old `notify` line.
   - Pre-release brand migration (`ai-task-alarm`/`ai-alarm` → `ai-agent-bell`)
     is built into setup for all three tools (markers, commands, matchers).
5. **Setup never destroys user data**: corrupt claude JSON → `.bak` + recreate;
   non-array hook keys skipped with a note; everything idempotent (re-runs add
   nothing); unknown `--tools`/args → exit 2 with message.

## Release state

- `1.0.0` — first public release (npm + tag `v1.0.0`).
- `1.0.1` — global click/key stop even when minimized; `-WindowStyle Hidden`
  removed (npm + tag `v1.0.1`, GitHub `main` in sync).
- Publish flow: `npm version patch|minor|major` → `npm publish --access public`
  (auth via granular token in npmrc; OTP not used) → `npm i -g ai-agent-bell`
  + `ai-agent-bell test` as a stranger → `git push origin main` +
  `git push origin vX.Y.Z` (tags do NOT ride along with plain `git push`).
- Next: announce/share; handle user issues as they arrive.

## Conventions for future work

- Keep the layout flat; user-facing surface is the CLI + the one config file.
- Every behavior change needs a silent smoke check (no real sound in tests).
- Docs stay layman-simple; internals stay English-only.
- Commit messages: short imperative subject, no AI-attribution trailers.
