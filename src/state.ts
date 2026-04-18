import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getCurrentBranch, getRemoteRepoSlug, getRepoRoot } from "./git.js";
import {
  getCheckRuns,
  getCurrentPr,
  getRepoSlugFromGh,
  getReviewComments,
  getWorkflowRuns,
  hasGhCli,
  validateGhAccess,
} from "./github.js";
import type { ExecLike, PrState, SettingsState } from "./types.js";

export const SETTINGS_ENTRY_TYPE = "pr-ally-settings";
export const DEFAULT_STALE_MS = 2 * 60_000;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createInitialState(): PrState {
  return {
    enabled: true,
    ghAvailable: false,
    checks: [],
    reviewComments: [],
  };
}

export function restoreSettings(ctx: ExtensionContext, current: PrState): PrState {
  let enabled = current.enabled;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === SETTINGS_ENTRY_TYPE) {
      const data = entry.data as SettingsState | undefined;
      if (typeof data?.enabled === "boolean") {
        enabled = data.enabled;
      }
    }
  }

  return {
    ...current,
    enabled,
  };
}

export function persistSettings(pi: ExtensionAPI, state: PrState): void {
  pi.appendEntry<SettingsState>(SETTINGS_ENTRY_TYPE, {
    enabled: state.enabled,
  });
}

export function isStale(state: PrState, maxAgeMs = DEFAULT_STALE_MS): boolean {
  if (!state.lastRefreshAt) return true;
  return Date.now() - state.lastRefreshAt > maxAgeMs;
}

export async function refreshState(
  run: ExecLike,
  cwd: string,
  current: PrState,
  signal?: AbortSignal,
): Promise<PrState> {
  const repoRoot = await getRepoRoot(run, cwd, signal);
  if (!repoRoot) {
    return {
      ...current,
      ghAvailable: false,
      repoRoot: undefined,
      branch: undefined,
      repo: undefined,
      pr: undefined,
      checks: [],
      reviewComments: [],
      lastRefreshAt: Date.now(),
      lastError: undefined,
    };
  }

  const branch = await getCurrentBranch(run, repoRoot, signal);
  const ghAvailable = await hasGhCli(run, repoRoot, signal);
  const repo = (await getRepoSlugFromGh(run, repoRoot, signal)) ?? (await getRemoteRepoSlug(run, repoRoot, signal));

  if (!ghAvailable) {
    return {
      ...current,
      ghAvailable: false,
      repoRoot,
      branch,
      repo,
      pr: undefined,
      checks: [],
      reviewComments: [],
      lastRefreshAt: Date.now(),
      lastError: "gh CLI not found",
    };
  }

  try {
    await validateGhAccess(run, repoRoot, signal);
  } catch (error) {
    return {
      ...current,
      ghAvailable: true,
      repoRoot,
      branch,
      repo,
      pr: undefined,
      checks: [],
      reviewComments: [],
      lastRefreshAt: Date.now(),
      lastError: errorText(error),
    };
  }

  try {
    const pr = await getCurrentPr(run, repoRoot, signal);
    if (!pr) {
      return {
        ...current,
        ghAvailable: true,
        repoRoot,
        branch,
        repo,
        pr: undefined,
        checks: [],
        reviewComments: [],
        lastRefreshAt: Date.now(),
        lastError: undefined,
      };
    }

    const [workflowRuns, reviewComments] = repo
      ? await Promise.all([
          getWorkflowRuns(run, repoRoot, repo, pr, signal),
          getReviewComments(run, repoRoot, repo, pr, signal, 20),
        ])
      : [[], []];
    const checks = repo ? await getCheckRuns(run, repoRoot, repo, pr, workflowRuns, signal) : [];

    return {
      ...current,
      ghAvailable: true,
      repoRoot,
      branch,
      repo,
      pr,
      checks,
      reviewComments,
      lastRefreshAt: Date.now(),
      lastError: undefined,
    };
  } catch (error) {
    return {
      ...current,
      ghAvailable: true,
      repoRoot,
      branch,
      repo,
      pr: undefined,
      checks: [],
      reviewComments: [],
      lastRefreshAt: Date.now(),
      lastError: errorText(error),
    };
  }
}
