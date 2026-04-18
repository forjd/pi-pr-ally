import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { compactText } from "./exec.js";
import type { CheckSummary, PrState, ReviewCommentSummary } from "./types.js";

function formatTimestamp(value?: string | number): string {
  if (!value) return "unknown";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}

function isFailingCheck(check: CheckSummary): boolean {
  return check.conclusion === "failure" || check.conclusion === "timed_out" || check.conclusion === "cancelled";
}

function hasCheckLogTarget(check: CheckSummary): boolean {
  return check.jobId !== undefined || check.workflowRunId !== undefined;
}

function checkSortRank(check: CheckSummary): number {
  if (isFailingCheck(check)) return 0;
  if (check.status !== "completed") return 1;
  if (check.conclusion === "success") return 2;
  return 3;
}

function formatCheckLogCommand(check: CheckSummary): string {
  return `/check-log ${JSON.stringify(check.name)}`;
}

function summarizeChecks(checks: CheckSummary[]): { failing: number; passing: number; pending: number; other: number } {
  let failing = 0;
  let passing = 0;
  let pending = 0;
  let other = 0;

  for (const check of checks) {
    if (check.status !== "completed") {
      pending += 1;
      continue;
    }

    if (check.conclusion === "success") {
      passing += 1;
      continue;
    }

    if (isFailingCheck(check)) {
      failing += 1;
      continue;
    }

    other += 1;
  }

  return { failing, passing, pending, other };
}

function formatComment(comment: ReviewCommentSummary): string {
  const location = [comment.path, comment.line ? `line ${comment.line}` : undefined].filter(Boolean).join(": ");
  const where = location ? `${location} — ` : "";
  const who = comment.author ? `${comment.author}: ` : "";
  return `- ${where}${who}${compactText(comment.body, 160)}`;
}

export function updateStatus(ctx: ExtensionContext, state: PrState): void {
  const theme = ctx.ui.theme;

  if (!state.enabled) {
    ctx.ui.setStatus("pr-ally", theme.fg("dim", "PR Ally off"));
    return;
  }

  if (!state.repoRoot) {
    ctx.ui.setStatus("pr-ally", theme.fg("dim", "PR Ally · no git repo"));
    return;
  }

  if (!state.ghAvailable) {
    ctx.ui.setStatus("pr-ally", theme.fg("warning", "PR Ally · gh missing"));
    return;
  }

  if (state.lastError && !state.pr) {
    ctx.ui.setStatus("pr-ally", theme.fg("warning", `PR Ally · ${compactText(state.lastError, 48)}`));
    return;
  }

  if (!state.pr) {
    const branch = state.branch ? ` (${state.branch})` : "";
    ctx.ui.setStatus("pr-ally", theme.fg("dim", `PR Ally · no PR${branch}`));
    return;
  }

  const counts = summarizeChecks(state.checks);
  const prText = theme.fg("accent", `PR #${state.pr.number}`);
  const failingText =
    counts.failing > 0 ? theme.fg("error", `${counts.failing} failing`) : theme.fg("success", "green");
  const commentsText =
    state.reviewComments.length > 0
      ? theme.fg("warning", `${state.reviewComments.length} comments`)
      : theme.fg("dim", "no comments");

  ctx.ui.setStatus(
    "pr-ally",
    `${prText}${theme.fg("dim", " · ")}${failingText}${theme.fg("dim", " · ")}${commentsText}`,
  );
}

export function formatPrSummary(state: PrState): string {
  if (!state.repoRoot) return "Not in a git repository.";
  if (!state.ghAvailable) return "GitHub CLI (gh) is not available in this environment.";
  if (state.lastError && !state.pr) return `Could not load PR context: ${state.lastError}`;
  if (!state.pr) return `No open PR detected for ${state.branch ?? "the current branch"}.`;

  const counts = summarizeChecks(state.checks);
  const lines = [
    `PR #${state.pr.number} — ${state.pr.title}`,
    `Repo: ${state.repo?.fullName ?? "unknown"}`,
    `Branch: ${state.branch ?? state.pr.headRefName}`,
    `Base → Head: ${state.pr.baseRefName} → ${state.pr.headRefName}`,
    `State: ${state.pr.state}${state.pr.isDraft ? " (draft)" : ""}`,
    `Checks: ${counts.failing} failing, ${counts.passing} passing, ${counts.pending} pending, ${counts.other} other`,
    `Review comments: ${state.reviewComments.length}`,
    `URL: ${state.pr.url}`,
    `Last refresh: ${formatTimestamp(state.lastRefreshAt)}`,
  ];

  return lines.join("\n");
}

export function formatChecksSummary(checks: CheckSummary[], onlyFailing = false): string {
  const sorted = [...checks].sort((left, right) => {
    const rank = checkSortRank(left) - checkSortRank(right);
    if (rank !== 0) return rank;

    const leftTimestamp = left.completedAt ? Date.parse(left.completedAt) : left.startedAt ? Date.parse(left.startedAt) : 0;
    const rightTimestamp = right.completedAt ? Date.parse(right.completedAt) : right.startedAt ? Date.parse(right.startedAt) : 0;
    return rightTimestamp - leftTimestamp;
  });

  const filtered = onlyFailing ? sorted.filter((check) => isFailingCheck(check)) : sorted;

  if (filtered.length === 0) {
    return onlyFailing ? "No failing checks found." : "No checks found for the current PR.";
  }

  const lines = filtered.map((check) => {
    const outcome = check.status === "completed" ? check.conclusion ?? "completed" : check.status;
    const hints: string[] = [];

    if (check.workflowRunName && check.workflowRunName !== check.name) {
      hints.push(`workflow: ${check.workflowRunName}`);
    }

    if (hasCheckLogTarget(check)) {
      hints.push(`log: ${formatCheckLogCommand(check)}`);
    }

    const suffix = [hints.join(" · "), check.detailsUrl].filter(Boolean).join(" — ");
    return suffix ? `- ${check.name} [${outcome}] — ${suffix}` : `- ${check.name} [${outcome}]`;
  });

  if (filtered.some((check) => hasCheckLogTarget(check))) {
    lines.push("", 'Tip: run /check-log "<check name>" to fetch a GitHub Actions log for a check.');
  }

  return lines.join("\n");
}

export function formatReviewCommentsSummary(comments: ReviewCommentSummary[], limit = 10): string {
  if (comments.length === 0) return "No recent review comments found.";

  return comments
    .slice(0, limit)
    .map((comment) => formatComment(comment))
    .join("\n");
}

export function formatInjectedContext(state: PrState): string | undefined {
  if (!state.enabled || !state.pr) return undefined;

  const failingChecks = state.checks.filter((check) => isFailingCheck(check)).slice(0, 5).map((check) => check.name);

  const recentComments = state.reviewComments.slice(0, 3).map((comment) => formatComment(comment));

  const lines = [
    "PR Context:",
    `- Repo: ${state.repo?.fullName ?? "unknown"}`,
    `- Branch: ${state.branch ?? state.pr.headRefName}`,
    `- PR: #${state.pr.number} ${state.pr.title}`,
  ];

  if (failingChecks.length > 0) {
    lines.push(`- Failing checks: ${failingChecks.join(", ")}`);
  }

  if (recentComments.length > 0) {
    lines.push("- Recent review comments:");
    for (const comment of recentComments) {
      lines.push(`  ${comment}`);
    }
  }

  if (state.lastRefreshAt) {
    lines.push(`- Refreshed: ${formatTimestamp(state.lastRefreshAt)}`);
  }

  return lines.join("\n");
}
