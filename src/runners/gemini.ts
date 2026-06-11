import { config, childEnv } from "../config.js";
import { runCommand, ExecError } from "../exec.js";
import {
  type AgentRunner,
  type RunOptions,
  type RunResult,
} from "../registry.js";

/**
 * Shape of `gemini --output-format json` (only the fields we use).
 * Verified against gemini-cli 0.46.0 (packages/core/src/output/types.ts).
 */
interface GeminiJson {
  session_id?: string;
  response?: string;
  error?: { type?: string; message?: string; code?: string | number };
}

export const geminiRunner: AgentRunner = {
  name: "gemini",
  description:
    "Delegate a task to Google Gemini (gemini-cli). Good for large-context " +
    "analysis and a third-opinion review. Supports model and session resume.",
  defaults: { model: config.gemini.model, reasoning: undefined },
  // gemini-cli has no CLI reasoning/effort flag (thinking is settings.json-only).
  supportsReasoning: false,
  supportsThinking: false,

  async run(task: string, opts: RunOptions): Promise<RunResult> {
    const args: string[] = [
      "--output-format",
      "json",
      "--approval-mode",
      config.gemini.approvalMode,
      // Without this, gemini silently downgrades the approval mode in folders
      // not marked trusted, and delegated edit tasks fail confusingly. Trust
      // policy for delegations is owned by BRIDGE_GEMINI_APPROVAL instead.
      "--skip-trust",
    ];

    const model = opts.model ?? config.gemini.model;
    if (model) args.push("-m", model);

    // Headless resume by session UUID. Note: gemini sessions are project-scoped
    // (keyed by cwd), so resume only works from the same working directory.
    if (opts.sessionId) args.push("--resume", opts.sessionId);

    // The prompt goes via stdin (piped stdin => headless mode, and stdin alone
    // is used as the whole prompt), so shell metacharacters in the task can
    // never be interpreted by the Windows .cmd shell or inject commands.
    const result = await runCommand("gemini", args, {
      cwd: opts.cwd,
      env: childEnv(opts.depth),
      timeoutMs: opts.timeoutMs ?? config.timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
      stdin: task,
      signal: opts.signal,
    });

    // Fatal errors also produce a JSON object in -o json mode, but on stderr
    // (responses go to stdout) — try both streams for a clean message before
    // falling back to raw tails.
    let parsed: GeminiJson | undefined;
    for (const stream of [result.stdout, result.stderr]) {
      try {
        parsed = JSON.parse(stream.trim());
        break;
      } catch {
        parsed = undefined;
      }
    }

    if (result.code !== 0) {
      const msg =
        parsed?.error?.message ??
        (result.stderr.slice(-2000) || result.stdout.slice(-2000));
      throw new ExecError(`gemini exited with code ${result.code}: ${msg}`, result);
    }
    if (!parsed) {
      throw new ExecError(
        `Could not parse gemini JSON output: ${result.stdout.slice(0, 500)}`,
        result,
      );
    }
    if (parsed.error) {
      throw new ExecError(
        `gemini reported an error: ${parsed.error.message ?? parsed.error.type}`,
      );
    }

    return {
      text: parsed.response ?? "",
      sessionId: parsed.session_id,
      // gemini-cli reports token stats but no USD cost.
      cost: undefined,
      truncated: result.truncated,
    };
  },
};
