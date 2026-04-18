# pi-pr-ally

GitHub PR + CI copilot for [pi](https://github.com/badlogic/pi-mono).

`pi-pr-ally` keeps pi aware of the current branch, PR, checks, and review comments so you can ask things like:

- “What PR am I on?”
- “What checks are failing?”
- “Show me recent review comments.”
- “Fetch the failing job log.”

## Current scaffold

This repo starts with a GitHub-first extension that:

- detects the current repo, branch, and PR via `git` + `gh`
- shows a compact PR status line in pi
- adds `/pr`, `/checks`, `/review-comments`, `/pr-refresh`, and `/pr-mode`
- exposes `pr_context`, `pr_checks`, `pr_review_comments`, and `pr_check_log` tools
- injects concise PR context before agent turns when enabled

## Requirements

- Node 20+
- `git`
- `gh` CLI
- GitHub auth configured with `gh auth login`
- pi installed locally

## Install for development

```bash
cd ~/Projects/pi-pr-ally
npm install
npm run typecheck
```

## Load in pi

### Quick test

```bash
pi -e ~/Projects/pi-pr-ally/src/index.ts
```

### As a local pi package

```bash
pi install ~/Projects/pi-pr-ally
```

## Commands

- `/pr` — show current PR summary
- `/checks` — show PR checks summary
- `/review-comments` — show recent review comments
- `/pr-refresh` — refresh GitHub state
- `/pr-mode on|off|status` — toggle automatic PR context injection

## Publish later

The package name is set to `pi-pr-ally` and the repo is structured as a pi package via the `pi.extensions` manifest in `package.json`.

## Roadmap

- better mapping from failing checks to workflow/job logs
- unresolved review thread support via GraphQL
- richer TUI widgets/footer
- GitLab support
- packaged release to GitHub + npm
