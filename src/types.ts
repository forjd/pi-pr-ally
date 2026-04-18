export interface RepoSlug {
  owner: string;
  repo: string;
  fullName: string;
  url?: string;
}

export interface PrSummary {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  headSha?: string;
  isDraft: boolean;
  state: string;
  reviewDecision?: string;
}

export interface CheckSummary {
  id?: number;
  name: string;
  status: string;
  conclusion?: string | null;
  detailsUrl?: string;
  workflowName?: string;
  appName?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowRunSummary {
  id: number;
  name: string;
  status: string;
  conclusion?: string | null;
  url?: string;
  createdAt?: string;
}

export interface ReviewCommentSummary {
  id: number;
  path?: string;
  line?: number;
  author?: string;
  body: string;
  createdAt?: string;
  url?: string;
}

export interface PrState {
  enabled: boolean;
  ghAvailable: boolean;
  repoRoot?: string;
  branch?: string;
  repo?: RepoSlug;
  pr?: PrSummary;
  checks: CheckSummary[];
  reviewComments: ReviewCommentSummary[];
  lastRefreshAt?: number;
  lastError?: string;
}

export interface SettingsState {
  enabled: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
}

export type ExecLike = (
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    signal?: AbortSignal;
    timeout?: number;
  },
) => Promise<CommandResult>;
