# Security policy

AI Agent Bell is local-only by design: zero dependencies, no network calls, no usage tracking, no install scripts, and no project files touched.

## Supported versions

| Version | Supported |
|---|---|
| 1.x | Yes |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting:

<https://github.com/hemant-rao/ai-agent-bell/security/advisories/new>

Include:

- affected version (`ai-agent-bell --version`)
- operating system and Node.js version
- what you expected vs what happened
- reproduction steps or a proof of concept
- impact assessment, if you have one

Reports are acknowledged on a best-effort basis. A fix and disclosure timeline will be agreed with the reporter.

## What this package does

AI Agent Bell is a global CLI/plugin that makes an audible alarm when an AI coding agent finishes, fails, or needs input.

It deliberately:

- runs the system shell to play the alarm and show a best-effort desktop toast
- writes or merges global settings in your home directory during `setup`
- reads and writes a small config file for the repeat count and the global key/click stop setting
- optionally polls global key state on Windows so the alarm can be stopped from anywhere

## What this package does not do

- no network requests from published runtime files
- no usage tracking, analytics, or code/prompt upload
- no install scripts (`preinstall`, `install`, `postinstall`)
- no runtime dependencies
- no reading or writing of your project folders

See [README → Permissions & security](README.md#permissions--security) for the exact commands and file paths.

## Release integrity

Releases are staged by `.github/workflows/publish.yml` on GitHub Actions with npm provenance (`npm stage publish --provenance`). A maintainer still approves the staged tarball with 2FA on npmjs.com before it goes live.

Verify the attestation for any published version:

```bash
npm view ai-agent-bell@<version> dist.attestations
```

## Third-party scores

Scores such as Socket's "Supply Chain Security" are capability/risk signals, not vulnerability reports. This package's shell and filesystem access are intentional; the permissions above describe exactly what it does.
