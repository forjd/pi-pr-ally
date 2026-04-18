import { execText } from "./exec.js";
import type { ExecLike, RepoSlug } from "./types.js";

export async function getRepoRoot(run: ExecLike, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    return await execText(run, "git", ["rev-parse", "--show-toplevel"], { cwd, signal, timeout: 5000 });
  } catch {
    return undefined;
  }
}

export async function getCurrentBranch(
  run: ExecLike,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const branch = await execText(run, "git", ["branch", "--show-current"], { cwd, signal, timeout: 5000 });
    return branch || undefined;
  } catch {
    return undefined;
  }
}

export async function getOriginUrl(run: ExecLike, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    return await execText(run, "git", ["remote", "get-url", "origin"], { cwd, signal, timeout: 5000 });
  } catch {
    return undefined;
  }
}

export function parseGitHubRemote(remoteUrl: string): RepoSlug | undefined {
  const trimmed = remoteUrl.trim();
  const match = trimmed.match(
    /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i,
  );
  if (!match) return undefined;

  const owner = match[1];
  const repo = match[2];
  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}`,
  };
}

export async function getRemoteRepoSlug(
  run: ExecLike,
  cwd: string,
  signal?: AbortSignal,
): Promise<RepoSlug | undefined> {
  const remote = await getOriginUrl(run, cwd, signal);
  if (!remote) return undefined;
  return parseGitHubRemote(remote);
}
