# pi-pr-ally

[![CI](https://github.com/forjd/pi-pr-ally/actions/workflows/ci.yml/badge.svg)](https://github.com/forjd/pi-pr-ally/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

GitHub PR and CI copilot for [pi](https://github.com/badlogic/pi-mono).

`pi-pr-ally` keeps pi aware of the repo you are in, the branch you are on, the pull request tied to that branch, the latest check runs, and recent review comments. That gives you enough context to ask direct questions without pasting links or re-explaining the state of the PR.

> Project status: early-stage, GitHub-only, and currently set up for local installs while the package takes shape.

## Why this exists

When pi is running inside a repo with an open PR, the extension can answer the questions that come up over and over during review and CI cleanup:

- "What PR am I on?"
- "Which checks are failing?"
- "What review comments came in?"
- "Show me the workflow log for that failed run."

## What it does

- Detects the current git repo, branch, and PR
- Shows a compact PR status line in pi
- Adds slash commands for PR, checks, comments, refresh, and mode toggling
- Exposes tools that agents can call for PR context, checks, review comments, and workflow logs
- Injects a short PR summary before agent turns when PR mode is enabled
- Truncates long workflow logs for chat while saving the full output to a temp file

## Requirements

- Node.js 20.6 or newer
- `git`
- GitHub CLI (`gh`)
- GitHub auth configured with `gh auth login`
- `pi` installed locally

## Install

### Install as a local pi package

From the repo root:

```bash
pi install .
```

### Or load the extension directly

Useful while developing:

```bash
pi -e ./src/index.ts
```

## Quick start

```bash
git clone https://github.com/forjd/pi-pr-ally.git
cd pi-pr-ally
npm install
npm run typecheck
pi install .
```

Then start pi inside a GitHub repo with an open PR on the current branch and try:

- `/pr`
- `/checks`
- `/review-comments`
- `/pr-mode status`

You can also just ask pi in plain English:

- "What PR am I on?"
- "Summarize the failing checks."
- "Show me the latest review comments."
- "Fetch the log for the CI workflow."

## Commands

| Command | Description |
| --- | --- |
| `/pr` | Show the current PR summary |
| `/checks` | Show the current PR checks |
| `/review-comments` | Show recent PR review comments |
| `/pr-refresh` | Refresh PR, checks, and review data from GitHub |
| `/pr-mode on|off|status` | Enable, disable, or inspect automatic PR context injection |

## Tools

| Tool | Description |
| --- | --- |
| `pr_context` | Return the current PR summary for the repo in the current working directory |
| `pr_checks` | Return PR checks, with an option to show only failing checks |
| `pr_review_comments` | Return recent PR review comments |
| `pr_check_log` | Fetch workflow logs by `runId` or workflow name |

`pr_check_log` truncates output to pi's default chat limits. When a log is longer, the full text is written to a temporary file and the path is returned in the tool details.

## How it works

`pi-pr-ally` uses `git` to figure out where you are, and `gh` to ask GitHub for PR metadata, check runs, review comments, and workflow logs. It refreshes state when a session starts and again when cached data goes stale.

There is no separate server to run. If `gh` is installed and authenticated, the extension talks to GitHub directly from your local machine.

## Development

```bash
npm install
npm run typecheck
```

CI currently runs `npm run typecheck` on pushes to `main` and on pull requests.

## Troubleshooting

If the extension is not showing PR data, check the basics first:

- Run `gh auth status`
- Make sure pi was started inside a git repo
- Make sure the current branch has an open PR on GitHub
- Run `/pr-refresh` after switching branches or opening a new PR

## Current scope

- GitHub only
- Requires the GitHub CLI
- Works best when the current branch already has an open PR
- Review comment support is based on recent PR comments; unresolved thread tracking is not in place yet

## Roadmap

- Better mapping from failing checks to workflow and job logs
- Unresolved review thread support via GraphQL
- Richer TUI widgets and footer status
- GitLab support
- Packaged releases to GitHub and npm

## Contributing

Issues and pull requests are welcome. Small, focused changes are easiest to review.

If you are working on the extension locally:

```bash
npm install
npm run typecheck
```

## License

MIT. See [LICENSE](./LICENSE).
