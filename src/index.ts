import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateTail,
  withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { getCheckLog } from "./github.js";
import { createInitialState, isStale, persistSettings, refreshState, restoreSettings } from "./state.js";
import type { ExecLike, PrState } from "./types.js";
import { formatChecksSummary, formatInjectedContext, formatPrSummary, formatReviewCommentsSummary, updateStatus } from "./ui.js";

const CHECKS_PARAMS = Type.Object({
  onlyFailing: Type.Optional(Type.Boolean({ description: "Only return failing checks" })),
});

const REVIEW_COMMENTS_PARAMS = Type.Object({
  limit: Type.Optional(Type.Number({ description: "Maximum number of comments to return", minimum: 1, maximum: 20 })),
});

const CHECK_LOG_PARAMS = Type.Object({
  name: Type.Optional(Type.String({ description: "Workflow run name to match" })),
  runId: Type.Optional(Type.Number({ description: "Workflow run ID to inspect" })),
});

function messageTitle(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const value = (details as { title?: unknown }).title;
  return typeof value === "string" ? value : undefined;
}

async function truncateLogOutput(text: string): Promise<{ text: string; fullOutputPath?: string }> {
  const truncation = truncateTail(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return { text: truncation.content };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "pi-pr-ally-"));
  const tempFile = join(tempDir, "check-log.txt");
  await withFileMutationQueue(tempFile, async () => {
    await writeFile(tempFile, text, "utf8");
  });

  let result = truncation.content;
  result += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
  result += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  result += ` Full output saved to: ${tempFile}]`;

  return {
    text: result,
    fullOutputPath: tempFile,
  };
}

export default function prAllyExtension(pi: ExtensionAPI) {
  let state = createInitialState();
  let sessionCwd = process.cwd();

  const run: ExecLike = async (command, args, options = {}) => {
    const result = await pi.exec(command, args, {
      cwd: options.cwd,
      signal: options.signal,
      timeout: options.timeout ?? 15000,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      killed: result.killed,
    };
  };

  async function refreshFor(cwd: string, signal?: AbortSignal, ctx?: ExtensionContext): Promise<PrState> {
    sessionCwd = cwd;
    state = await refreshState(run, cwd, state, signal);
    if (ctx) updateStatus(ctx, state);
    return state;
  }

  async function ensureFresh(ctx: ExtensionContext): Promise<PrState> {
    if (isStale(state)) {
      return refreshFor(ctx.cwd, ctx.signal, ctx);
    }
    updateStatus(ctx, state);
    return state;
  }

  function postPanel(title: string, body: string): void {
    pi.sendMessage({
      customType: "pr-ally",
      content: body,
      display: true,
      details: { title },
    });
  }

  function setMode(enabled: boolean, ctx: ExtensionContext): void {
    state = { ...state, enabled };
    persistSettings(pi, state);
    updateStatus(ctx, state);
  }

  pi.registerMessageRenderer("pr-ally", (message, _options, theme) => {
    const title = messageTitle(message.details) ?? "PR Ally";
    let text = theme.fg("accent", theme.bold(title));
    if (message.content) {
      text += `\n${message.content}`;
    }
    return new Text(text, 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionCwd = ctx.cwd;
    state = restoreSettings(ctx, state);
    await refreshFor(ctx.cwd, undefined, ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    state = restoreSettings(ctx, state);
    updateStatus(ctx, state);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!state.enabled) return undefined;

    const current = await ensureFresh(ctx);
    const content = formatInjectedContext(current);
    if (!content) return undefined;

    return {
      message: {
        customType: "pr-ally-context",
        content,
        display: false,
      },
    };
  });

  pi.registerCommand("pr", {
    description: "Show current PR summary",
    handler: async (_args, ctx) => {
      const current = await ensureFresh(ctx);
      postPanel("PR Summary", formatPrSummary(current));
    },
  });

  pi.registerCommand("checks", {
    description: "Show current PR checks",
    handler: async (_args, ctx) => {
      const current = await ensureFresh(ctx);
      const body = current.pr ? formatChecksSummary(current.checks) : formatPrSummary(current);
      postPanel("PR Checks", body);
    },
  });

  pi.registerCommand("review-comments", {
    description: "Show recent PR review comments",
    handler: async (_args, ctx) => {
      const current = await ensureFresh(ctx);
      const body = current.pr ? formatReviewCommentsSummary(current.reviewComments) : formatPrSummary(current);
      postPanel("Review Comments", body);
    },
  });

  pi.registerCommand("pr-refresh", {
    description: "Refresh PR, checks, and review comments from GitHub",
    handler: async (_args, ctx) => {
      const current = await refreshFor(ctx.cwd, ctx.signal, ctx);
      postPanel("PR Refresh", formatPrSummary(current));
      ctx.ui.notify("PR Ally refreshed", "info");
    },
  });

  pi.registerCommand("pr-mode", {
    description: "Toggle automatic PR context injection: /pr-mode on|off|status",
    handler: async (args, ctx) => {
      const normalized = args.trim().toLowerCase();

      if (!normalized || normalized === "status") {
        const status = state.enabled ? "on" : "off";
        postPanel("PR Mode", `Automatic PR context injection is ${status}.`);
        return;
      }

      if (normalized === "on") {
        setMode(true, ctx);
        ctx.ui.notify("PR Ally mode enabled", "info");
        return;
      }

      if (normalized === "off") {
        setMode(false, ctx);
        ctx.ui.notify("PR Ally mode disabled", "info");
        return;
      }

      ctx.ui.notify("Usage: /pr-mode on|off|status", "warning");
    },
  });

  pi.registerTool({
    name: "pr_context",
    label: "PR Context",
    description: "Get the current GitHub pull request summary for this repository.",
    promptSnippet: "Read current GitHub PR context for the working branch",
    promptGuidelines: [
      "Use this tool when the user asks about the active PR, branch, or high-level review state.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const current = await ensureFresh(ctx);
      return {
        content: [{ type: "text", text: formatPrSummary(current) }],
        details: {
          pr: current.pr,
          repo: current.repo,
          lastRefreshAt: current.lastRefreshAt,
        },
      };
    },
  });

  pi.registerTool({
    name: "pr_checks",
    label: "PR Checks",
    description: "List GitHub checks for the current pull request.",
    promptSnippet: "Inspect GitHub checks for the current PR",
    promptGuidelines: ["Use this tool to inspect current CI status before asking for logs."],
    parameters: CHECKS_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = await ensureFresh(ctx);
      const checks = params.onlyFailing
        ? current.checks.filter((check) => check.conclusion === "failure" || check.conclusion === "timed_out")
        : current.checks;

      return {
        content: [{ type: "text", text: current.pr ? formatChecksSummary(checks) : formatPrSummary(current) }],
        details: {
          checks,
          onlyFailing: params.onlyFailing ?? false,
        },
      };
    },
  });

  pi.registerTool({
    name: "pr_review_comments",
    label: "PR Review Comments",
    description: "List recent GitHub review comments for the current pull request.",
    promptSnippet: "Inspect recent PR review comments from GitHub",
    promptGuidelines: [
      "Use this tool when the user asks what review feedback is still relevant or what comments landed on the PR.",
    ],
    parameters: REVIEW_COMMENTS_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = await ensureFresh(ctx);
      const limit = params.limit ?? 10;

      return {
        content: [
          {
            type: "text",
            text: current.pr ? formatReviewCommentsSummary(current.reviewComments, limit) : formatPrSummary(current),
          },
        ],
        details: {
          comments: current.reviewComments.slice(0, limit),
          limit,
        },
      };
    },
  });

  pi.registerTool({
    name: "pr_check_log",
    label: "PR Check Log",
    description: `Fetch a workflow run log for the current PR. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Fetch and inspect workflow logs for the current PR",
    promptGuidelines: [
      "Use this tool after identifying a failing workflow run or when the user asks for CI logs.",
      "Prefer passing runId when available; otherwise use a workflow name.",
    ],
    parameters: CHECK_LOG_PARAMS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.runId === undefined && !params.name?.trim()) {
        throw new Error("Provide either runId or name.");
      }

      const current = await ensureFresh(ctx);
      if (!current.repo || !current.pr) {
        return {
          content: [{ type: "text", text: formatPrSummary(current) }],
          details: {},
        };
      }

      const result = await getCheckLog(run, sessionCwd, current.repo, current.pr, params, signal ?? ctx.signal);
      const truncated = await truncateLogOutput(result.text);
      const heading = result.run ? `Workflow: ${result.run.name}\n\n` : "";

      return {
        content: [{ type: "text", text: `${heading}${truncated.text}` }],
        details: {
          run: result.run,
          fullOutputPath: truncated.fullOutputPath,
        },
      };
    },
  });
}
