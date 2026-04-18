import { commandExists, compactText, execChecked, execJson, execText } from "./exec.js";
import type {
  CheckSummary,
  ExecLike,
  PrSummary,
  RepoSlug,
  ReviewCommentSummary,
  WorkflowRunSummary,
} from "./types.js";

interface GhRepoViewResponse {
  nameWithOwner: string;
  url?: string;
}

interface GhPrViewResponse {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  headRefOid?: string;
  isDraft: boolean;
  state: string;
  reviewDecision?: string;
}

interface GhCheckRunsResponse {
  check_runs?: Array<{
    id?: number;
    name: string;
    status: string;
    conclusion?: string | null;
    details_url?: string;
    html_url?: string;
    started_at?: string;
    completed_at?: string;
    app?: { name?: string };
  }>;
}

interface GhWorkflowRunsResponse {
  workflow_runs?: Array<{
    id: number;
    name: string;
    status: string;
    conclusion?: string | null;
    html_url?: string;
    created_at?: string;
  }>;
}

interface GhReviewCommentResponse {
  id: number;
  path?: string;
  line?: number;
  body: string;
  created_at?: string;
  html_url?: string;
  user?: {
    login?: string;
  };
}

interface CheckLogRequest {
  checkName?: string;
  jobId?: number;
  name?: string;
  runId?: number;
}

interface CheckLogResult {
  text: string;
  check?: CheckSummary;
  workflowRunId?: number;
  workflowRunName?: string;
  jobId?: number;
  jobName?: string;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function looksLikeNoPrError(message: string): boolean {
  return /no pull requests? found|could not find.*pull request/i.test(message);
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function isFailingCheck(check: CheckSummary): boolean {
  return check.conclusion === "failure" || check.conclusion === "timed_out" || check.conclusion === "cancelled";
}

function hasLogTarget(check: CheckSummary): boolean {
  return check.jobId !== undefined || check.workflowRunId !== undefined;
}

function matchNameScore(candidate: string, query: string): number | undefined {
  const normalizedCandidate = normalizeForMatch(candidate);
  if (normalizedCandidate === query) return 0;
  if (normalizedCandidate.startsWith(query)) return 1;
  if (normalizedCandidate.includes(query)) return 2;
  return undefined;
}

function findCheckByName(checks: CheckSummary[], rawQuery: string): CheckSummary | undefined {
  const query = normalizeForMatch(rawQuery);
  if (!query) return undefined;

  return checks
    .map((check) => ({
      check,
      score: matchNameScore(check.name, query),
      timestamp: check.completedAt ? Date.parse(check.completedAt) : check.startedAt ? Date.parse(check.startedAt) : 0,
    }))
    .filter((item): item is { check: CheckSummary; score: number; timestamp: number } => item.score !== undefined)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      if (hasLogTarget(left.check) !== hasLogTarget(right.check)) return hasLogTarget(left.check) ? -1 : 1;
      if (isFailingCheck(left.check) !== isFailingCheck(right.check)) return isFailingCheck(left.check) ? -1 : 1;
      return right.timestamp - left.timestamp;
    })
    .at(0)?.check;
}

function formatAvailableNames(values: string[]): string {
  return [...new Set(values.filter(Boolean))].slice(0, 8).join(", ");
}

function parseActionsLogTarget(url?: string): { workflowRunId?: number; jobId?: number } {
  if (!url) return {};

  const jobMatch =
    url.match(/\/actions\/runs\/(\d+)\/job\/(\d+)(?:[/?#]|$)/i) ??
    url.match(/\/runs\/(\d+)\/job\/(\d+)(?:[/?#]|$)/i);
  if (jobMatch) {
    return {
      workflowRunId: Number(jobMatch[1]),
      jobId: Number(jobMatch[2]),
    };
  }

  const runMatch = url.match(/\/actions\/runs\/(\d+)(?:[/?#]|$)/i) ?? url.match(/\/runs\/(\d+)(?:[/?#]|$)/i);
  if (runMatch) {
    return {
      workflowRunId: Number(runMatch[1]),
    };
  }

  return {};
}

async function getWorkflowLogByRunId(
  run: ExecLike,
  cwd: string,
  runId: number,
  signal?: AbortSignal,
): Promise<string> {
  return execText(run, "gh", ["run", "view", String(runId), "--log"], {
    cwd,
    signal,
    timeout: 60000,
  });
}

async function getWorkflowLogByJobId(
  run: ExecLike,
  cwd: string,
  jobId: number,
  signal?: AbortSignal,
): Promise<string> {
  return execText(run, "gh", ["run", "view", "--job", String(jobId), "--log"], {
    cwd,
    signal,
    timeout: 60000,
  });
}

async function getLogForCheck(
  run: ExecLike,
  cwd: string,
  check: CheckSummary,
  signal?: AbortSignal,
): Promise<CheckLogResult> {
  if (check.jobId !== undefined) {
    const text = await getWorkflowLogByJobId(run, cwd, check.jobId, signal);
    return {
      text,
      check,
      workflowRunId: check.workflowRunId,
      workflowRunName: check.workflowRunName,
      jobId: check.jobId,
      jobName: check.name,
    };
  }

  if (check.workflowRunId !== undefined) {
    const text = await getWorkflowLogByRunId(run, cwd, check.workflowRunId, signal);
    return {
      text,
      check,
      workflowRunId: check.workflowRunId,
      workflowRunName: check.workflowRunName,
    };
  }

  const suffix = check.detailsUrl ? ` Open the check details instead: ${check.detailsUrl}` : "";
  throw new Error(`Check "${check.name}" is not linked to a GitHub Actions log.${suffix}`);
}

export async function hasGhCli(run: ExecLike, cwd: string, signal?: AbortSignal): Promise<boolean> {
  return commandExists(run, "gh", cwd, signal);
}

export async function getRepoSlugFromGh(
  run: ExecLike,
  cwd: string,
  signal?: AbortSignal,
): Promise<RepoSlug | undefined> {
  try {
    const data = await execJson<GhRepoViewResponse>(run, "gh", ["repo", "view", "--json", "nameWithOwner,url"], {
      cwd,
      signal,
      timeout: 15000,
    });
    const [owner, repo] = data.nameWithOwner.split("/");
    if (!owner || !repo) return undefined;
    return {
      owner,
      repo,
      fullName: data.nameWithOwner,
      url: data.url,
    };
  } catch {
    return undefined;
  }
}

export async function getCurrentPr(
  run: ExecLike,
  cwd: string,
  signal?: AbortSignal,
): Promise<PrSummary | undefined> {
  const result = await run(
    "gh",
    ["pr", "view", "--json", "number,title,url,baseRefName,headRefName,headRefOid,isDraft,state,reviewDecision"],
    { cwd, signal, timeout: 20000 },
  );

  if (result.code !== 0) {
    const message = `${result.stderr}\n${result.stdout}`;
    if (looksLikeNoPrError(message)) return undefined;
    throw new Error(compactText(message, 220));
  }

  const data = JSON.parse(result.stdout) as GhPrViewResponse;
  return {
    number: data.number,
    title: data.title,
    url: data.url,
    baseRefName: data.baseRefName,
    headRefName: data.headRefName,
    headSha: data.headRefOid,
    isDraft: data.isDraft,
    state: data.state,
    reviewDecision: data.reviewDecision,
  };
}

export async function getCheckRuns(
  run: ExecLike,
  cwd: string,
  repo: RepoSlug,
  pr: PrSummary,
  workflowRuns: WorkflowRunSummary[] = [],
  signal?: AbortSignal,
): Promise<CheckSummary[]> {
  if (!pr.headSha) return [];

  const response = await execJson<GhCheckRunsResponse>(
    run,
    "gh",
    ["api", `repos/${repo.owner}/${repo.repo}/commits/${pr.headSha}/check-runs`],
    { cwd, signal, timeout: 20000 },
  );

  const workflowRunsById = new Map(workflowRuns.map((runItem) => [runItem.id, runItem]));

  return (response.check_runs ?? []).map((check) => {
    const detailsUrl = check.html_url ?? check.details_url;
    const target = parseActionsLogTarget(detailsUrl);
    const workflowRun = target.workflowRunId ? workflowRunsById.get(target.workflowRunId) : undefined;
    const isGitHubActions = check.app?.name === "GitHub Actions";

    return {
      id: check.id,
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      detailsUrl,
      workflowRunId: target.workflowRunId,
      workflowRunName: workflowRun?.name,
      jobId: target.jobId ?? (isGitHubActions ? check.id : undefined),
      appName: check.app?.name,
      startedAt: check.started_at,
      completedAt: check.completed_at,
    };
  });
}

export async function getWorkflowRuns(
  run: ExecLike,
  cwd: string,
  repo: RepoSlug,
  pr: PrSummary,
  signal?: AbortSignal,
): Promise<WorkflowRunSummary[]> {
  if (!pr.headSha) return [];

  const params = new URLSearchParams({
    head_sha: pr.headSha,
    per_page: "20",
  });

  const response = await execJson<GhWorkflowRunsResponse>(
    run,
    "gh",
    ["api", `repos/${repo.owner}/${repo.repo}/actions/runs?${params.toString()}`],
    { cwd, signal, timeout: 20000 },
  );

  return (response.workflow_runs ?? []).map((runItem) => ({
    id: runItem.id,
    name: runItem.name,
    status: runItem.status,
    conclusion: runItem.conclusion,
    url: runItem.html_url,
    createdAt: runItem.created_at,
  }));
}

export async function getCheckLog(
  run: ExecLike,
  cwd: string,
  repo: RepoSlug,
  pr: PrSummary,
  checks: CheckSummary[],
  options: CheckLogRequest,
  signal?: AbortSignal,
): Promise<CheckLogResult> {
  if (options.jobId !== undefined) {
    const text = await getWorkflowLogByJobId(run, cwd, options.jobId, signal);
    const matchedCheck = checks.find((check) => check.jobId === options.jobId);
    return {
      text,
      check: matchedCheck,
      workflowRunId: matchedCheck?.workflowRunId,
      workflowRunName: matchedCheck?.workflowRunName,
      jobId: options.jobId,
      jobName: matchedCheck?.name,
    };
  }

  if (options.runId !== undefined) {
    const text = await getWorkflowLogByRunId(run, cwd, options.runId, signal);
    return {
      text,
      workflowRunId: options.runId,
    };
  }

  const checkQuery = options.checkName?.trim();
  if (checkQuery) {
    const matchedCheck = findCheckByName(checks, checkQuery);
    if (!matchedCheck) {
      const availableChecks = formatAvailableNames(checks.filter(hasLogTarget).map((check) => check.name));
      const suffix = availableChecks ? ` Available checks: ${availableChecks}` : "";
      throw new Error(`No check found for "${options.checkName}".${suffix}`);
    }

    return getLogForCheck(run, cwd, matchedCheck, signal);
  }

  const query = options.name?.trim();
  if (!query) {
    throw new Error("Provide one of jobId, checkName, runId, or name.");
  }

  const normalizedQuery = normalizeForMatch(query);
  const workflowRuns = await getWorkflowRuns(run, cwd, repo, pr, signal);
  const matchedRun =
    workflowRuns.find((item) => normalizeForMatch(item.name) === normalizedQuery) ??
    workflowRuns.find((item) => normalizeForMatch(item.name).includes(normalizedQuery));

  if (matchedRun) {
    const text = await getWorkflowLogByRunId(run, cwd, matchedRun.id, signal);
    return {
      text,
      workflowRunId: matchedRun.id,
      workflowRunName: matchedRun.name,
    };
  }

  const matchedCheck = findCheckByName(checks, query);
  if (matchedCheck) {
    return getLogForCheck(run, cwd, matchedCheck, signal);
  }

  const availableRuns = formatAvailableNames(workflowRuns.map((item) => item.name));
  const availableChecks = formatAvailableNames(checks.filter(hasLogTarget).map((check) => check.name));
  const suffixParts = [
    availableRuns ? `Available runs: ${availableRuns}` : undefined,
    availableChecks ? `Available checks: ${availableChecks}` : undefined,
  ].filter(Boolean);
  const suffix = suffixParts.length > 0 ? ` ${suffixParts.join(" ")}` : "";

  throw new Error(`No workflow run or check log found for "${options.name}".${suffix}`);
}

export async function getReviewComments(
  run: ExecLike,
  cwd: string,
  repo: RepoSlug,
  pr: PrSummary,
  signal?: AbortSignal,
  limit = 20,
): Promise<ReviewCommentSummary[]> {
  const params = new URLSearchParams({
    per_page: String(limit),
  });

  const comments = await execJson<GhReviewCommentResponse[]>(
    run,
    "gh",
    ["api", `repos/${repo.owner}/${repo.repo}/pulls/${pr.number}/comments?${params.toString()}`],
    { cwd, signal, timeout: 20000 },
  );

  return comments
    .map((comment) => ({
      id: comment.id,
      path: comment.path,
      line: comment.line,
      author: comment.user?.login,
      body: compactText(comment.body, 220),
      createdAt: comment.created_at,
      url: comment.html_url,
    }))
    .sort((a, b) => {
      const left = a.createdAt ? Date.parse(a.createdAt) : 0;
      const right = b.createdAt ? Date.parse(b.createdAt) : 0;
      return right - left;
    });
}

export async function validateGhAccess(run: ExecLike, cwd: string, signal?: AbortSignal): Promise<void> {
  try {
    await execChecked(run, "gh", ["auth", "status"], { cwd, signal, timeout: 10000 });
  } catch (error) {
    throw new Error(`GitHub CLI is not ready: ${errorText(error)}`);
  }
}
