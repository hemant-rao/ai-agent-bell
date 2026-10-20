# AI Agent Bell 🔔

[![npm version](https://img.shields.io/npm/v/ai-agent-bell.svg)](https://www.npmjs.com/package/ai-agent-bell)
[![npm total downloads](https://img.shields.io/npm/dt/ai-agent-bell.svg)](https://www.npmjs.com/package/ai-agent-bell)
[![license: MIT](https://img.shields.io/npm/l/ai-agent-bell.svg)](./LICENSE)
[![node >= 18](https://img.shields.io/node/v/ai-agent-bell.svg)](https://nodejs.org)
[![zero dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen.svg)](./package.json)

**A loud bell that rings when your AI coding helper finishes work, fails, or needs you — so you can stop staring at the screen.**

Give your AI a long task. Go make tea. The bell calls you back. That is the whole idea.

Works with **OpenCode**, **Claude Code**, **Codex CLI**, and any terminal tool. Global-only install: zero project impact, never ships in your build, zero dependencies.

**Safety & trust:** runs locally with zero dependencies — no network calls, no usage tracking, no install scripts, and it never reads or writes your project. See [Permissions & security](#permissions--security) and [SECURITY.md](./SECURITY.md).

---

## Contents

- [Is this for you?](#is-this-for-you)
- [Setup in 3 steps](#setup-in-3-steps)
- [What you hear](#what-you-hear)
- [Commands cheat-sheet](#commands-cheat-sheet)
- [Ring count (how many times?)](#ring-count-how-many-times)
- [How it connects to each tool](#how-it-connects-to-each-tool)
- [Stopping the bell](#stopping-the-bell)
- [Will it break my project? No.](#will-it-break-my-project-no)
- [Permissions & security](#permissions--security)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [For developers](#for-developers)
- [Changelog](#changelog)
- [Author & License](#author--license)

---

## Is this for you?

Yes, if **all three** are true:

1. You write code with an AI tool in a terminal (black command window): **OpenCode**, **Claude Code**, or **Codex CLI**.
2. Your computer has **Node.js 18+** (check with `node --version`).
3. You are tired of checking the screen again and again.

No coding needed. Three commands and you are done.

> **Windows-first, terminal-only.** Sound plays where the AI runs. Remote/SSH users: see [FAQ](#faq).

---

## Setup in 3 steps

**Step 1 — Install the bell** (one time, on your computer):

```bash
npm i -g ai-agent-bell
```

**Step 2 — Connect it to your AI tool** (one time, home folder only):

```bash
ai-agent-bell setup
```

Pick only some tools if you want:

```bash
ai-agent-bell setup --tools opencode,claude,codex
```

This only touches settings files in your **home folder**. It never touches your projects.

When setup finishes in a terminal, you will see a green **AI AGENT BELL** banner with `SUCCESS` and a short safety note. Piped output stays plain (no color codes).

**Step 3 — Restart your AI tool and test:**

Close OpenCode / Claude Code / Codex completely, open it again, then run:

```bash
ai-agent-bell test
```

You should hear your saved count (5 by default). Done! Now give your AI a long task and walk away.

> **After every update, run `ai-agent-bell setup` again** — `setup` copies the plugin file fresh (old copies never update themselves). Then restart the AI tool.

---

## What you hear

Four different bells for four moments — you can tell what happened without looking:

| What happened | What you hear | Event name |
|---|---|---|
| AI finished answering | Steady, friendly chime | `complete` |
| AI is asking you something / needs permission | Urgent two-tone siren — go answer it | `question` |
| AI run failed (for example, an API error) | Low double-beep | `error` |
| Manual warning | Slow, spaced beeps | `warning` |

Try each one:

```bash
ai-agent-bell --event complete
ai-agent-bell --event question
ai-agent-bell --event error
ai-agent-bell --event warning
```

Small print, honestly told:

- In Claude Code, "finished" means one answer finished, not necessarily the whole task. That is still exactly when you want to look.
- In OpenCode, mid-task noise stays silent by design: subagent (Task-tool child) completions, `busy` status transitions, and non-question tool runs never ring. Duplicate deliveries of the same completion (2.x hands every event to several plugin instances; 1.x double-fired `session.idle` + `session.status`) ring once.

---

## Commands cheat-sheet

| What you want | Command |
|---|---|
| Ring now (saved count) | `ai-agent-bell` |
| Prove it works / hear saved count | `ai-agent-bell test` |
| Show current ring count | `ai-agent-bell config` |
| Ring 8 times from now on | `ai-agent-bell config --times 8` |
| Same, short form | `ai-agent-bell config 8` |
| Wire all tools + save count in one go | `ai-agent-bell setup --times 8` |
| One single alarm with a different count (saved value unchanged) | `ai-agent-bell --event question --times 3` |
| Turn off global click/key stop | `ai-agent-bell config --key-stop off` |
| Same, one alarm only | `ai-agent-bell --no-key-stop` |
| Quieter console (sound still plays) | `ai-agent-bell --quiet` |
| Show help / version | `ai-agent-bell --help` · `ai-agent-bell --version` |

Rules that make life easy:

- A **bare number always means `--times N`**: `ai-agent-bell 5`, `ai-agent-bell setup 8`, `ai-agent-bell config 5`, `ai-agent-bell test 3` all just work.
- Allowed range: **1 to 30**. Default: **5**.
- Filler words are ignored, so plain attempts just work: `ai-agent-bell alarm repeats 3`.
- `--duration N` is a deprecated alias of `--times N` (kept for old hooks).
- Bad usage exits with code `2` and tells you what went wrong.
- Short alias `ai-alarm` runs the same command (keeps old hooks working).

---

## Ring count (how many times?)

Default is **5 times**. Change it any time with one command (no setup again, no restart):

```bash
ai-agent-bell config --times 5    # ring 5 times from now on (allowed: 1 to 30)
ai-agent-bell config              # show the current value
ai-agent-bell config 5            # same as --times 5 (a bare number always means --times)
```

That command saves the number in one small file:

```
~/.config/ai-agent-bell/config.json   →   { "times": 5, "keyStop": true }
```

`keyStop` controls the Windows global click/key watcher (default `true`). Set it to `false` — or run `ai-agent-bell config --key-stop off` — if you do not want that watcher. It does not change the ring count.

You can also open that file and edit the number by hand — same result. Every hook reads that same file at ring time, so the change applies to all tools instantly.

To hear your saved count and prove a change worked:

```bash
ai-agent-bell test    # rings your saved count, no setup again, no restart needed
```

For one single alarm with a different count (without changing the saved value):

```bash
ai-agent-bell --event question --times 3
```

---

## How it connects to each tool

`ai-agent-bell setup` touches **home-directory configs only**. Your project folders are never touched.

| Tool | What setup writes | What it means |
|---|---|---|
| **OpenCode** | `~/.config/opencode/plugins/ai-agent-bell.js` (fresh copy, baked CLI + node paths; 2.x default-definition shape, still compatible with 1.18.29+) | `session.execution.succeeded` → complete · `session.execution.failed` → error (2.x — 1.18.x used `session.idle` / idle-only `session.status` → complete · `session.error` → error) · `permission.asked` / `form.created` → question (2.x) · `permission.updated` / `question.asked` / question-tool → question (1.x) |
| **Claude Code** | global `~/.claude/settings.json` hooks (merged, yours preserved) | `Stop` → complete · `StopFailure` → error · `Notification` → question (matcher restricted to actionable types only: `permission_prompt\|idle_prompt\|elicitation_dialog\|elicitation_url_dialog\|agent_needs_input`) |
| **Codex CLI** | global `~/.codex/config.toml` block (appended once) | `[[hooks.Stop]]` → complete · `[[hooks.PermissionRequest]]` → question. Never a top-level `notify` key (that would risk a duplicate-TOML-key parse error). |

Notes worth knowing:

- **OpenCode plugin is a copy.** Updating the npm package never refreshes it — re-run `ai-agent-bell setup` after every update, then restart OpenCode (plugins load at startup).
- **No double ringing.** Setup removes its own pre-release copy (`ai-task-alarm.js`) and rebrands old hook commands (`ai-task-alarm` / `ai-alarm` → `ai-agent-bell`) in place. It warns about foreign DIY files using `-WindowStyle Hidden` (that flag minimizes your terminal) but never deletes files it did not create.
- **Never in a project.** Manual wiring (instead of `setup`): copy `adapters/claude-settings-snippet.json` into global `~/.claude/settings.json`, append `adapters/codex-config-snippet.toml` to global `~/.codex/config.toml`, or add `"plugins": ["ai-agent-bell"]` to global opencode config (V2; older 1.x used the `"plugin"` key). Never put these inside a project folder.

---

## Stopping the bell

- **Click any mouse button** (Windows) — even when the terminal is minimized or another app is open.
- **Press any common key** (letters, digits, Space, Enter, Esc, F-keys) — also works when the terminal is minimized.
- Or do nothing — it rings your chosen number of times and stops by itself.

The global watcher is on by default, so existing behaviour is unchanged. Prefer not to have it? Run `ai-agent-bell config --key-stop off` (persists for every hook) or `ai-agent-bell --no-key-stop` (one alarm only). With it off, the alarm plays all N rounds and stops by itself.

Nothing here ever minimizes or hides your windows — the bell only ever makes sound. All child processes spawn hidden; no window calls, ever.

---

## Will it break my project? No.

- It only changes settings files in **your home folder** (`~/.config/...`, `~/.claude/...`, `~/.codex/...`). Your project folders are never touched.
- It only **makes sound**. It cannot change code, break tests, or end up in your app.
- Zero dependencies. Node 18+.
- Remove it any time:

```bash
npm rm -g ai-agent-bell
```

(Then delete its 2–3 lines from the settings files listed above, if you want every trace gone.)

---

## Permissions & security

The bell is a **local** tool. Published runtime files make no network calls, send no usage data, run no install scripts, and have zero dependencies.

| Capability | Why it exists | Where |
|---|---|---|
| **Shell access** | Play the alarm; show a best-effort desktop toast | `notifications/sound.js` runs `powershell -NoProfile -NonInteractive -Command ...` on Windows, `afplay` on macOS, and `paplay` / `beep` on Linux. `notifications/desktop.js` uses PowerShell / `osascript` / `notify-send` for the optional toast. The OpenCode plugin spawns the CLI with the same Node binary that installed it. |
| **Filesystem access** | `setup` writes global home-directory config; the alarm reads its repeat count | `~/.config/opencode/plugins/ai-agent-bell.js`, `~/.claude/settings.json`, `~/.codex/config.toml`, `~/.config/ai-agent-bell/config.json`, plus temp lock files under `os.tmpdir()/ai-agent-bell-locks`. Your project folders are never read or written. |
| **Global key/click watcher (Windows)** | Stop the alarm from anywhere, even when the terminal is minimized | `notifications/sound.js` polls `user32.GetAsyncKeyState` every 50 ms for a fixed list of mouse buttons and keys. It checks pressed/not pressed only — no key content, no history, no storage, no network. |
| **Network** | Not used | No runtime file makes a network request. |
| **Install scripts** | Not used | `package.json` has no `preinstall`, `install`, or `postinstall` script. |

### Turn the global watcher off

```bash
ai-agent-bell config --key-stop off   # persist for every hook
ai-agent-bell --no-key-stop           # one alarm only
```

`keyStop` sits next to `times` in `~/.config/ai-agent-bell/config.json`. Default is `true`, so nothing changes for existing users.

### Verify a release

Releases staged by `.github/workflows/publish.yml` carry npm provenance. Check any version with:

```bash
npm view ai-agent-bell@<version> dist.attestations
```

Security reports: see [SECURITY.md](./SECURITY.md). Please do not open a public issue for a vulnerability.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| No sound at all | Did you restart the AI tool after `setup`? Run `ai-agent-bell test` — if the test rings, the bell works and the tool just needs a restart. |
| Updated the package but still silent | Run `ai-agent-bell setup` again — `setup` copies the plugin file fresh (old copies never update themselves). Then restart the AI tool. |
| Bell rings twice, or the window minimizes | Another alarm plugin is also active (for example, a hand-made `task-alarm.js`). Run `ai-agent-bell setup` — it removes its own old copies and warns about foreign files using `-WindowStyle Hidden` (that flag minimizes your terminal). Disable or delete the named file, then restart the AI tool. |
| Bell rings on every little message | In Claude Code, some notifications are informational. The hook only fires for messages where **you must act** (approvals, questions). If it still feels chatty, lower the count: `ai-agent-bell config --times 3`. In OpenCode, mid-task events (subagent completions, busy transitions) are already silenced — if you still hear them, re-run `setup` to pick up the latest guards. |
| I changed the count but nothing changed | Run `ai-agent-bell test` — it rings your saved count straight from the file. Every hook reads that same file, so no `setup` again and no restart needed. |
| Settings file got corrupted | Setup backs it up (`settings.json.bak-<timestamp>`) and recreates it instead of overwriting. Your old content is in the backup. |
| I work on a remote machine (SSH) | Sound plays **where the AI runs** — on the remote machine, not your laptop. For remote work, use a phone/push notifier instead. |
| My machine has no Node.js | See `adapters/no-node-fallback.md` — plain system commands that ring without this package. |

Still stuck? Open an issue on GitHub with: your tool (OpenCode/Claude/Codex + version), `ai-agent-bell --version` output, and what `ai-agent-bell test` does.

---

## FAQ

**Does it send my code anywhere?**
No. It runs locally, makes sound, nothing else. No network calls, no usage tracking.

**Why does it need shell and file access?**
The shell is used only to play the alarm and a best-effort desktop toast. `setup` writes only global files in your home folder. Nothing reads or writes your project. See [Permissions & security](#permissions--security).

**Does it work on macOS / Linux?**
Core alarm works wherever Node 18+ runs. The global click/key-stop watcher is Windows-optimized; on other systems the alarm plays its N rounds and stops by itself.

**Can I use it in CI?**
The test suite is silent by design (`npm test` never plays sound). The alarm itself is meant for interactive terminals, not CI logs.

**Can I trigger it from my own scripts?**
Yes — it is just a CLI:

```bash
npx -y ai-agent-bell --event complete
npx -y ai-agent-bell --event question --times 3
npx -y ai-agent-bell --event error
```

**Why 5 rings by default?**
Loud enough to hear from the next room, short enough to not annoy. Change with `ai-agent-bell config --times N`.

---

## For developers

How it is built (you never need to open this to *use* the bell):

```
bin/ai-agent-bell.js     the command (setup / config / test / alarm)
detectors/               what happened (completion, input-needed, error, warning + registry)
notifications/           how it tells you (sound, desktop toast, terminal bell)
lib/                     repeat-count file + orchestration
adapters/                copy-paste pieces for each AI tool
tests/                   silent test suite
tools/                   live checks: opencode compatibility (verify:opencode) + ring acceptance (ring-check)
index.mjs                opencode npm-plugin entry (ESM default export)
```

Run the checks (first two are silent and CI-safe; `ring-check` plays REAL sound):

```bash
npm test                  # CLI, detectors, adapters, packaging
npm run verify:opencode   # live: the real opencode must load the plugin
npm run ring-check        # live: real sessions, the bell must RING (Windows; plays REAL sound)
```

`verify:opencode` is a live compatibility check: it installs the plugin into a
throwaway HOME and asks the real opencode server whether both the `setup` copy
and the packaged npm plugin load — no model calls, no sound, your real config
untouched. Run it after every opencode upgrade and before every release.
opencode changed the plugin API shape between 1.x and 2.x (that is what broke
the bell once), and only a real host load catches that class of break.
GitHub Actions runs the silent suite on every push (CI) and re-runs
`verify:opencode` against the *latest* opencode every week (canary), so a host
API change goes red before users ever see it. `prepublishOnly` runs the suite
on every publish, and releases go through npm **staged publishing** — the
tarball is staged, a maintainer approves it with 2FA on npmjs.com, and only
then does it go live — so a broken tarball can never reach users. The
`Publish to npm` workflow runs on GitHub Actions and stages with
`npm stage publish --provenance`, so the staged tarball carries a signed npm
provenance attestation (verify with
`npm view ai-agent-bell@<version> dist.attestations`).

`ring-check` is the release gate for the bell itself. It runs real headless
sessions on your installed opencode — several completions, a forced failure,
a question — and watches the process table for the alarm the plugin spawns,
asserting **exactly one per run** (and a Task-tool subagent whose completion
must stay silent). It is Windows-only and plays REAL alarms, so it is not in
CI; run `npm run ring-check` before every release and again after every
install. Twice a release passed "the plugin loads" while the bell stayed
silent — loading is not ringing, and this is the check that proves ringing.

Manual wiring (instead of `setup`): copy `adapters/claude-settings-snippet.json` into global `~/.claude/settings.json`, append `adapters/codex-config-snippet.toml` to global `~/.codex/config.toml`, or add `"plugins": ["ai-agent-bell"]` to global opencode config (V2; older 1.x used the `"plugin"` key). Never put these inside a project folder.

No-Node fallback: `adapters/no-node-fallback.md`.

---

## Changelog

- **Unreleased** — Security/trust pass with **no default behaviour change**: README "Permissions & security" + `SECURITY.md`; optional `keyStop` config (`--no-key-stop`, `config --key-stop off`, default remains on); PowerShell calls now use `-NonInteractive` and the desktop toast passes values as environment variables instead of interpolating them into a command; manual GitHub Actions workflow stages releases with npm provenance; `setup` ends with a green **AI AGENT BELL** success/trust banner (plain text when piped). Tests cover the new config/flag paths and the banner.
- **1.0.6** — OpenCode 2.x ringing fix (1.0.5 was silent on 2.x): finished turns ring from `session.execution.succeeded` and failures from `session.execution.failed` (2.x no longer emits `session.idle`/`session.status`). The host runs several plugin instances per server, so dupe suppression now claims through an exclusive lock file (temp dir) — one bell per completion instead of four overlapping alarms. Subagent (Task-tool child) completions, busy transitions and `form.cancelled` stay silent. Verified live on opencode 2.0.32: complete/question/error each ring exactly once; child sessions ring nothing. Release gate added the same day so the bell can never silently regress again: `npm run ring-check` (live acceptance — real sessions, process-verified single alarms, subagent-silence proof; multiple full passes on the clean build).
- **1.0.5** — OpenCode 2.x support: the plugin now default-exports a V2 definition (`{ id, setup }`) and subscribes to the 2.x event stream (`ctx.event.subscribe`, payloads on `event.data`, `form.created` → question; `permission.asked` kept), fixing "Plugin must export a default definition with an id and an effect or setup function." The old V1 shape (named export returning an `event` hook) no longer loads on 2.x. Still works on opencode 1.18.29+ through the added `server()` entrypoint. npm plugin entry renamed to `index.mjs`. Verified live on opencode 2.0.32. Packaging hardening so this can never silently recur: `exports` map, `prepublishOnly` test gate, tarball-content check in the smoke suite, `npm run verify:opencode` live host check, and GitHub Actions CI + weekly opencode canary.
- **1.0.4** — No more mid-task false alarms (OpenCode): subagent (Task-tool child) completions stay silent, `session.status` rings on `idle` only (busy/retry silent), `tool.execute.before` rings for the `question` tool only, same-session double-fire (`session.idle` + `session.status`) rings once via cooldown, plus `permission.updated` support. Same guards in both the file-copy plugin and the npm plugin entry.
- **1.0.3** — Fixed total OpenCode silence: ESM single-export plugin entries, baked node binary spawn (never the host binary), `question.asked` mapped. Verified live on opencode 1.18.35.
- **1.0.2** — Default repeats 10 → 5; `test` rings the saved count; friendly CLI (bare number = `--times N`, filler words ignored); `--version` reads package.json; `setup` warns about foreign `-WindowStyle` plugins.
- **1.0.1** — Global click/key stop even when minimized; `-WindowStyle Hidden` removed.
- **1.0.0** — First public release.

---

## Author & License

Made by **Hemant Rao**

- npm: https://www.npmjs.com/~mrhrao
- GitHub: https://github.com/hemant-rao/

Found a problem or want a feature? [Open an issue](https://github.com/hemant-rao/ai-agent-bell/issues).

MIT — see [LICENSE](./LICENSE).
