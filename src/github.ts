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

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function looksLikeNoPrError(message: string): boolean {
  return /no pull requests? found|could not find.*pull request/i.test(message);
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
  signal?: AbortSignal,
): Promise<CheckSummary[]> {
  if (!pr.headSha) return [];

  const response = await execJson<GhCheckRunsResponse>(
    run,
    "gh",
    ["api", `repos/${repo.owner}/${repo.repo}/commits/${pr.headSha}/check-runs`],
    { cwd, signal, timeout: 20000 },
  );

  return (response.check_runs ?? []).map((check) => ({
    id: check.id,
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    detailsUrl: check.html_url ?? check.details_url,
    appName: check.app?.name,
    startedAt: check.started_at,
    completedAt: check.completed_at,
  }));
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
  options: { name?: string; runId?: number },
  signal?: AbortSignal,
): Promise<{ text: string; run?: WorkflowRunSummary }> {
  if (options.runId !== undefined) {
    const text = await execText(run, "gh", ["run", "view", String(options.runId), "--log"], {
      cwd,
      signal,
      timeout: 60000,
    });
    return { text };
  }

  const query = options.name?.trim().toLowerCase();
  if (!query) {
    throw new Error("Provide either runId or name when requesting a check log.");
  }

  const workflowRuns = await getWorkflowRuns(run, cwd, repo, pr, signal);
  const match =
    workflowRuns.find((item) => item.name.toLowerCase() === query) ??
    workflowRuns.find((item) => item.name.toLowerCase().includes(query));

  if (!match) {
    const available = workflowRuns.map((item) => item.name).slice(0, 8);
    const suffix = available.length > 0 ? ` Available runs: ${available.join(", ")}` : "";
    throw new Error(`No workflow run found for \"${options.name}\".${suffix}`);
  }

  const text = await execText(run, "gh", ["run", "view", String(match.id), "--log"], {
    cwd,
    signal,
    timeout: 60000,
  });

  return { text, run: match };
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
