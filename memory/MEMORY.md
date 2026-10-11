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
- Gotcha (seen 2026-10-11): a FOREIGN hand-made plugin
  `~/.config/opencode/plugins/task-alarm.js` (Bun.spawn + `powershell
  -WindowStyle Hidden`, hardcoded 10 rounds) minimized the user's CMD on every
  alarm and double-rang beside our bell while ignoring the config file. Our
  engine never minimizes (all children `windowsHide`, no window calls — probed).
  Fix was rename-to-`.bak` (never delete foreign files); `setupOpencode()`
  now warns (never deletes) about other `*.js` files containing
  `-WindowStyle`. Disabled by renaming, restart of the AI tool required
  (plugins load at startup).
- `package.json files[]` MUST list every runtime dir (`bin lib detectors
  notifications adapters index.js`). Guarded by a smoke check (the v1
  `files[]` bug shipped nothing and would have broken all requires).
- `npm test` = CJS `node --check` + ESM `node --input-type=module --check < file`
  (stdin redirect works in cmd and sh) + `tests/smoke.js` (currently ~110 behavior
  checks). Whole suite is silent by design (CI-safe). ESM files (index.js,
  adapters/opencode-plugin.js) are additionally imported by the smoke test
  through `.mjs` copies (their `.js` names must stay: opencode loads that path).
- Gotcha (seen 2026-10-11, the "no alarm after task complete" incident):
  THREE bugs conspired, all in the opencode path (Claude/Codex hooks use
  `npx`, unaffected):
  1. The installed plugin was CJS (`module.exports = { TaskAlarm }`). opencode
     calls EVERY export as a factory and drops the whole file on any
     non-function export — log: `failed to load plugin ... "Plugin export is
     not a function"`. The foreign DIY `task-alarm.js` (ESM) loaded fine next
     to it, which is why its bell was heard while ours never ran. FIX: both
     plugin entries (adapters/opencode-plugin.js, index.js) are ESM with
     exactly ONE export (`export async function TaskAlarm`, no other exports).
     Probed live: CJS `module.exports = fn` ALSO fails; ESM loads.
  2. The plugin spawned `process.execPath` — inside opencode that is the
     opencode binary, which just prints its own help and exits 1 (silent:
     detached + stdio ignored). FIX: setup bakes setup's own node binary
     (`__NODE_BIN_PATH__`, falls back to PATH `node`); spawn errors fall back
     to inline beeps via an 'error' handler (spawn failures are async events,
     try/catch alone misses them).
  3. `question.asked` (the common "agent paused for an answer" event) was
     unmapped, so questions rang nothing. FIX: mapped to `question` in the
     adapter table and detectors/input-required.js (index.js follows the
     registry automatically).
  Verified live on opencode 1.18.35: headless run showed the real plugin
  spawning `node ... ai-agent-bell.js --event complete|question|error`
  (Win32_Process), attached CLI run exited 0 in 4.7s, zero post-fix load
  errors in opencode.log.
- The installed `~/.config/opencode/plugins/ai-agent-bell.js` is a COPY —
  updating the npm package never refreshes it. Users must re-run
  `ai-agent-bell setup` after every update (README troubleshooting says so).
- Debugging note: `npx <local-path>` (e.g. `npx F:\Project\ai-agent-bell`)
  installs the LOCAL repo into the npm `_npx` cache as a `file:` dependency
  (seen 2026-10-11 masquerading as 1.0.2). A mystery version in `_npx` cache
  dirs may be such a local install, not a registry release — check the hash
  dir's root `package.json` (`_npx.packages`) before concluding anything.

## Key behaviors (hard-won, do not regress)

1. **Repeat count** lives in ONE file: `~/.config/ai-agent-bell/config.json`
   (`{ "times": N }`, 1..30). Hooks call the CLI with no count; runtime
   resolves flag → file → default 5. `setup --times N` / `config --times N`
   writes it. `--duration` is a deprecated alias of `--times`. Friendly CLI:
   a bare number means `--times N` (`ai-agent-bell 5`, `setup 5`, `config 5`,
   `test 3`); filler words (alarm, bell, repeat(s), time(s), ring(s)) are
   ignored so plain attempts like `ai-agent-bell alarm repeats 3` just work.
   `test` with no count rings the SAVED count (so a change is verifiable);
   explicit `--times N` / bare number on `test` gives a custom quick check.
2. **Early stop, global**: Windows watcher process polls
   `user32.GetAsyncKeyState` every 50ms (mouse L/R/M + Back/Tab/Enter/Esc/
   Space + 0-9 + A-Z + F1-F12), exits 7 on activity — works even when the
   terminal is minimized. Races the single-process beep loop; loser is
   killed. Focused terminals additionally get an instant stdin raw-mode key
   listener (TTY only — piped hook input never disturbed).
3. **No window changes, ever**: children spawn with `windowsHide` and NO
   `-WindowStyle Hidden` (probes proved spawn flags can't hide/minimize the
   parent console; the flag was removed everywhere as defence-in-depth). Live
   probes (2026-10-11) confirmed: foreground window unchanged through a full
   alarm, no new visible window appears. BurntToast is NOT installed on the
   author's machine, so the toast path is a silent no-op there.
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
- `1.0.2` (npm + tag `v1.0.2`, GitHub `main` in sync) — default repeats
  10 → 5 (config + opencode fallback + no-node snippets + docs); `test` rings
  the saved count unless `--times N` / bare number given (previously
  hardcoded 2); friendly CLI (bare number = `--times N`, filler words
  ignored); `--version` reads package.json; `setup` warns about foreign
  `-WindowStyle` plugins (never deletes).
- `1.0.3` (npm + tag `v1.0.3`, GitHub `main` in sync) — fixes total opencode
  silence ("no alarm after task complete", 2026-10-11): ESM single-export
  plugin entries (CJS copies were dropped with "Plugin export is not a
  function"); spawn baked node binary instead of `process.execPath`
  (opencode binary, silent fail) with PATH + beep fallbacks; `question.asked`
  mapped to the question alarm. Verified live on opencode 1.18.35
  (Win32_Process showed real `node ... --event complete|question|error`
  spawns, attached CLI exited 0, zero post-fix load errors).
- Publish flow: `npm version patch|minor|major` → `npm publish --access public`
  → `npm i -g ai-agent-bell` + `ai-agent-bell test` as a stranger (registry
  needs ~1 min to serve the new version) → `git push origin main` +
  `git push origin vX.Y.Z` (tags do NOT ride along with plain `git push`).
- Publish AUTH (learned 2026-10-11, do not re-learn): token lives in
  `~/.npmrc` as `//registry.npmjs.org/:_authToken=...`. Expired token → 401
  on `whoami`; read-only granular token → 403 on publish; granular token
  without 2FA-bypass → 403 "2FA or bypass required" (account enforces 2FA for
  publishing). What works: a **classic Automation token** (bypasses 2FA by
  design). Ask the user to generate it (npmjs.com → Access Tokens).
- Publish WARNING (benign, verified): npm 11 says `bin[...] was invalid and
  removed` and normalizes `repository.url` on every publish. Ignore it — the
  stranger `npm i -g` check proves the `ai-agent-bell` shims ARE created.
  Do NOT "fix" `bin` paths because of this warning.
- Next: announce/share; handle user issues as they arrive.

## Conventions for future work

- Keep the layout flat; user-facing surface is the CLI + the one config file.
- Every behavior change needs a silent smoke check (no real sound in tests).
- Docs stay layman-simple; internals stay English-only.
- Commit messages: short imperative subject, no AI-attribution trailers.
