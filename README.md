# AI Agent Bell 🔔

**A loud bell that rings when your AI coding helper finishes work, fails, or needs you — so you can stop staring at the screen.**

You give your AI a long task. You go make tea. The bell rings when it is done. That is the whole idea.

## Is this for you?

Yes, if **all three** are true:

1. You write code with an AI tool in a terminal (black command window): **OpenCode**, **Claude Code**, or **Codex CLI**.
2. Your computer has **Node.js** (the thing that runs JavaScript — check with `node --version`).
3. You are tired of checking the screen again and again.

No coding needed. Three commands and you are done.

## Setup in 3 steps

**Step 1 — Install the bell** (one time, on your computer):

```bash
npm i -g ai-agent-bell
```

**Step 2 — Connect it to your AI tool** (one time):

```bash
ai-agent-bell setup
```

This only touches settings files in your home folder. It never touches your projects.

**Step 3 — Restart your AI tool and test:**

Close OpenCode / Claude Code / Codex completely, open it again, then run:

```bash
ai-agent-bell test
```

You should hear a short bell. Done! Now give your AI a long task and walk away — the bell will call you back.

## How many times should it ring?

Default is **10 times**. Change it any time with one command (no setup again):

```bash
ai-agent-bell config --times 5    # ring 5 times from now on (allowed: 1 to 30)
ai-agent-bell config              # show the current value
```

That command saves the number in one small file (`~/.config/ai-agent-bell/config.json`). You can also open that file and edit the number by hand — same result.

For one single alarm with a different count (without changing the saved value):

```bash
ai-agent-bell --event question --times 3
```

## Four different bells for four moments

You can tell what happened without looking:

| What happened | What you hear |
|---|---|
| AI finished answering | Steady, friendly chime |
| AI is asking you something / needs permission | Urgent two-tone siren — go answer it |
| AI run failed (for example, an API error) | Low double-beep |
| Manual warning (`ai-agent-bell --event warning`) | Slow, spaced beeps |

Small print, honestly told: in Claude Code, "finished" means one answer finished, not necessarily the whole task. That is still exactly when you want to look.

## Made it stop? Easy.

- **Click any mouse button** (Windows) — the bell stops at once.
- **Press any key** in the terminal.
- Or do nothing — it rings your chosen number of times and stops by itself.

## Will it break my project? No.

- It only changes settings files in **your home folder** (`~/.config/...`, `~/.claude/...`, `~/.codex/...`). Your project folders are never touched.
- It only **makes sound**. It cannot change code, break tests, or end up in your app.
- Remove it any time:

```bash
npm rm -g ai-agent-bell
```

(Then delete its 2–3 lines from the settings files listed above, if you want every trace gone.)

## If something is wrong

| Problem | Fix |
|---|---|
| No sound at all | Did you restart the AI tool after `setup`? Run `ai-agent-bell test` — if the test rings, the bell works and the tool just needs a restart. |
| Bell rings twice | Two copies are installed (for example, an old test copy). Run `ai-agent-bell setup` again — it removes its own old copies automatically. |
| Bell rings on every little message | In Claude Code, some notifications are informational. The hook only fires for messages where **you must act** (approvals, questions). If it still feels chatty, lower the count: `ai-agent-bell config --times 3`. |
| I work on a remote machine (SSH) | Sound plays **where the AI runs** — on the remote machine, not your laptop. For remote work, use a phone/push notifier instead. |
| My machine has no Node.js | See `adapters/no-node-fallback.md` — plain system commands that ring without this package. |

## For developers

Manual wiring (instead of `setup`): copy `adapters/claude-settings-snippet.json` into global `~/.claude/settings.json`, append `adapters/codex-config-snippet.toml` to global `~/.codex/config.toml`, or add `"plugin": ["ai-agent-bell"]` to `opencode.json`. Never put these inside a project folder.

How it is built (you never need to open this to *use* the bell):

```
bin/ai-agent-bell.js     the command (setup / config / alarm)
detectors/               what happened (completion, input-needed, error, warning)
notifications/           how it tells you (sound, desktop toast, terminal bell)
lib/                     repeat-count file + orchestration
adapters/                copy-paste pieces for each AI tool
tests/                   silent test suite
```

Run the checks:

```bash
npm test
```

## Author

Made by **Hemant Rao**

- npm: https://www.npmjs.com/~mrhrao
- GitHub: https://github.com/hemant-rao/

Found a problem or want a feature? Open an issue on GitHub.

## License

MIT — see [LICENSE](./LICENSE).
