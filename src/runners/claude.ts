import { config, childEnv } from "../config.js";
import { runCommand, ExecError } from "../exec.js";
import {
  type AgentRunner,
  type RunOptions,
  type RunResult,
} from "../registry.js";

/**
 * Maps the bridge's `thinking` levels to Claude's keyword triggers. Claude
 * converts these keywords into a thinking-token budget internally, so we just
 * append the keyword to the task text — no env vars, no version-specific flags.
 */
const THINKING_KEYWORDS: Record<string, string> = {
  off: "",
  think: "think",
  think_hard: "think hard",
  ultrathink: "ultrathink",
};

/** Shape of `claude --output-format json` (only the fields we use). */
interface ClaudeJson {
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  is_error?: boolean;
  subtype?: string;
}

export const claudeRunner: AgentRunner = {
  name: "claude",
  description:
    "Delegate a task to Claude Code (Anthropic). Good for deep reasoning, " +
    "code review, and careful multi-step work. Supports model, effort, and thinking.",
  defaults: { model: config.claude.model, reasoning: undefined },
  supportsReasoning: true,
  supportsThinking: true,

  async run(task: string, opts: RunOptions): Promise<RunResult> {
    const thinkingKeyword =
      opts.thinking && opts.thinking !== "off"
        ? THINKING_KEYWORDS[opts.thinking] ?? ""
        : "";
    const prompt = thinkingKeyword ? `${task}\n\n${thinkingKeyword}` : task;

    const args: string[] = [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      config.claude.permissionMode,
    ];

    const model = opts.model ?? config.claude.model;
    if (model) args.push("--model", model);

    // `reasoning` maps to Claude's --effort (low|medium|high|xhigh|max).
    if (opts.reasoning) args.push("--effort", opts.reasoning);

    if (opts.sessionId) args.push("--resume", opts.sessionId);

    // The prompt is passed via stdin (not argv) so shell metacharacters in the
    // task can never be interpreted by the Windows .cmd shell or inject commands.
    const result = await runCommand("claude", args, {
      cwd: opts.cwd,
      env: childEnv(opts.depth),
      timeoutMs: opts.timeoutMs ?? config.timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
      stdin: prompt,
      signal: opts.signal,
    });

    if (result.code !== 0) {
      const tail = result.stderr.slice(-2000) || result.stdout.slice(-2000);
      throw new ExecError(`claude exited with code ${result.code}: ${tail}`, result);
    }

    let parsed: ClaudeJson;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      throw new ExecError(
        `Could not parse claude JSON output: ${result.stdout.slice(0, 500)}`,
        result,
      );
    }

    if (parsed.is_error) {
      throw new ExecError(`claude reported an error: ${parsed.result ?? parsed.subtype}`);
    }

    return {
      text: parsed.result ?? "",
      sessionId: parsed.session_id,
      cost: parsed.total_cost_usd,
      truncated: result.truncated,
    };
  },
};
