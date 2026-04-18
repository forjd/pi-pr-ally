import type { ExecLike } from "./types.js";

function summarizeError(stderr: string, stdout: string): string {
  const combined = `${stderr}\n${stdout}`.trim();
  if (!combined) return "Command failed";
  return combined.replace(/\s+/g, " ").slice(0, 400);
}

export async function execChecked(
  run: ExecLike,
  command: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${summarizeError(result.stderr, result.stdout)}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function execText(
  run: ExecLike,
  command: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal; timeout?: number } = {},
): Promise<string> {
  const result = await execChecked(run, command, args, options);
  return result.stdout.trim();
}

export async function execJson<T>(
  run: ExecLike,
  command: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal; timeout?: number } = {},
): Promise<T> {
  const text = await execText(run, command, args, options);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${command}: ${message}`);
  }
}

export async function commandExists(
  run: ExecLike,
  command: string,
  cwd?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const result = await run(command, ["--version"], { cwd, signal, timeout: 5000 });
  return result.code === 0;
}

export function compactText(text: string, maxLength = 140): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, Math.max(0, maxLength - 1))}…`;
}
