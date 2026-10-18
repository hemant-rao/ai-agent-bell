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
tools/verify-opencode.js live host check: real opencode must load the plugin (throwaway HOME)
.github/workflows/       ci.yml (silent suite on push) + opencode-canary.yml (weekly, latest opencode)
index.mjs                opencode npm-plugin entry (fire-and-forget, quiet, keyStop:false)
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
  notifications adapters index.mjs`). Guarded by a smoke check (the v1
  `files[]` bug shipped nothing and would have broken all requires).
- `npm test` = CJS `node --check` + `node --check index.mjs` (ESM by
  extension) + `node --input-type=module --check < adapters/opencode-plugin.js`
  (stdin redirect works in cmd and sh) + `tests/smoke.js` (currently ~115
  behavior checks). Whole suite is silent by design (CI-safe). The adapter is
  additionally imported by the smoke test through a `.mjs` copy (its `.js`
  name must stay: setup copies that exact filename into opencode's plugin dir).
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
- Gotcha (seen 2026-10-18, opencode 2.x): opencode 2.0.32 loads plugin files
  in a NEW shape. The server reads the module's DEFAULT export and requires a
  definition with `id` plus `effect` or `setup` — the V1 named export
  (`export async function TaskAlarm`) now drops the file with "Plugin must
  export a default definition with an id and an effect or setup function."
  (TUI: "[Server plugin error]"). FIX: both entries default-export
  `{ id: 'ai-agent-bell', setup(ctx) {...} }` subscribing via
  `ctx.event.subscribe({ signal })`; the extra `server()` method keeps
  opencode 1.18.29+ working (its object entrypoint), and `setup` returns a
  cleanup that aborts the subscription. V2 event payloads sit on `event.data`
  (1.x used `event.properties`) — propsOf/`forToolEvent` accept both.
  `question.asked` is gone in 2.x: questions are `form.created` (payload
  `{ form: { id, sessionID } }`, mapped to question); `permission.asked`
  stays; `session.status idle` + `session.idle` semantics unchanged. The
  subscribe loop resubscribes every 2s after a hiccup so the bell can never
  die silently. npm entry renamed index.js → index.mjs (ESM under a
  `"type": "commonjs"` package must not masquerade as CJS again). Verified
  live on opencode 2.0.32: `/api/plugin` lists `ai-agent-bell`
  state=active, no post-fix load errors in opencode.log (fixed plugin was
  re-installed with the repo's own `setup --tools opencode`, which baked the
  REPO CLI path; after the 1.0.5 release the installed `setup` re-baked it to
  the npm path and `opencode reload` hot-loaded it — no service restart).
- Release safety (added 2026-10-18, so a host-API break like the one above can
  never ship silently again): `npm run verify:opencode`
  (tools/verify-opencode.js) is a LIVE check — throwaway HOME (USERPROFILE +
  HOME override) plus a private `opencode serve --hostname 127.0.0.1 --port
  <free>` per phase (NOT the shared background service: `opencode api` alone
  tries to start a service on the user's real port and collides, and
  `api --standalone` answers /api/plugin from an EMPTY registry). serve prints
  `server password <pw>`; requests use `Authorization: Basic
  base64("opencode:<pw>")`; the plugin registry fills in ASYNCHRONOUSLY (poll
  until non-empty, ~5-8 s). Two phases, because the loader rejects duplicate
  plugin IDs: (A) setup file-copy active, (B) file copy removed + packed
  plugin loaded via the `plugins` config entry — both must report state=active
  and opencode.log must show no "failed to load plugin"/duplicate-ID rows;
  exit 1 otherwise. It runs `npm pack` + a scratch `npm install` + a Node
  import shape check, so it also catches files[]/exports/main resolution
  breaks; it never plays sound and never touches the real HOME (private
  servers are tree-killed in cleanup; Windows needs a 1.5s wait before rm).
  `prepublishOnly` runs `npm test` on every publish. `tests/smoke.js`
  validates the packed tarball (`npm pack --dry-run --json`).
  `.github/workflows/ci.yml` runs the suite on every push/PR (node 18-24,
  ubuntu + windows); `opencode-canary.yml` runs verify:opencode weekly against
  the LATEST opencode — plugin-API drift turns the canary red before users
  hit it. `package.json` gained an `exports` map (kept `main` for old
  resolvers).
- The installed `~/.config/opencode/plugins/ai-agent-bell.js` is a COPY —
  updating the npm package never refreshes it. Users must re-run
  `ai-agent-bell setup` after every update (README troubleshooting says so).
- `opencode reload` hot-reloads config AND plugins from disk (opencode.log
  rows: "plugin reconciliation", "loading plugin") — after a setup re-bake
  just `opencode reload`; no service restart needed. `opencode plugin list`
  shows loaded plugins and their source paths.
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
     dispatcher: baked CLI path → detached CLI; inline beep fallback). 2.x
     loads the default `{id, setup}` definition and subscribes via
     `ctx.event.subscribe`; 1.18.29+ uses the `server()` entrypoint.
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

- `1.0.5` (2026-10-18) — opencode 2.x support (see gotcha above): V2 default
  definition + event-subscribe port, `form.created` → question, `.data`
  payloads, `index.js` → `index.mjs`. Packaging guardrails added same day:
  `exports` map (main kept for old resolvers), `prepublishOnly: npm test`,
  tarball-content check in smoke (`npm pack --dry-run --json`: runtime files
  present, tests/tools/memory/.github excluded), `npm run verify:opencode`
  live host check (tools/verify-opencode.js), GitHub Actions `ci.yml` + weekly
  `opencode-canary.yml`. RELEASED 2026-10-18 via npm staged publishing (user
  approved with 2FA on npmjs.com; flow below). Machine state after release:
  global npm install 1.0.5, tag `v1.0.5` pushed, installed opencode plugin
  copy re-baked to the npm CLI path (`setup`) and hot-loaded (`opencode
  reload`); `opencode plugin list` lists ai-agent-bell.
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
- Publish flow (STAGED publishing — required for this account/token since
  2026-10-18): `npm run verify:opencode` first if opencode changed since the
  last release; bump the version; `git push origin main`; `npm stage publish
  .` (still runs `prepublishOnly` tests; no 2FA, works with the stage-only
  token) → the USER approves it: npmjs.com → user menu → Staged Packages →
  Approve (+2FA). The stage-only token CANNOT approve (`npm stage approve
  <id>` → 404, do not retry). `npm stage list` shows validating → staged.
  After approval: check `npm view ai-agent-bell version` → `git tag vX.Y.Z` +
  `git push origin vX.Y.Z` (tags never ride along with plain `git push`) →
  `npm i -g ai-agent-bell` → `ai-agent-bell setup` (re-bake) → `opencode
  reload` (hot-load; `opencode plugin list` verifies). Stranger check:
  `ai-agent-bell test`.
- Publish AUTH (rewritten 2026-10-18): token lives in `~/.npmrc` as
  `//registry.npmjs.org/:_authToken=...`. The 2026-10-11 classic bypass-2FA
  token EXPIRED (`whoami` 401; publish 404). The 2026-10-18 replacement GAT
  is STAGE-ONLY: direct `npm publish` → E_STAGE_REQUIRED ("This token can
  only publish to a staging area"), `npm stage publish` works, approve → 404.
  npm policy (2026): bypass GATs lose direct publish (target Jan 2027);
  staged approval ALWAYS needs interactive 2FA (proof-of-presence). Ask the
  user for tokens (npmjs.com → Access Tokens). Automation upgrade path:
  trusted publishing (OIDC) via GitHub Actions.
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
