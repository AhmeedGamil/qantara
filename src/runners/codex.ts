import { config, childEnv } from "../config.js";
import { runCommand, ExecError } from "../exec.js";
import {
  type AgentRunner,
  type RunOptions,
  type RunResult,
} from "../registry.js";

/**
 * Parses Codex's `--json` JSONL stream. Relevant event shapes (confirmed
 * against codex-cli 0.139.0):
 *   {"type":"thread.started","thread_id":"<uuid>"}
 *   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{...}}
 */
interface CodexParse {
  text: string;
  sessionId?: string;
}

function parseCodexJsonl(stdout: string): CodexParse {
  let sessionId: string | undefined;
  let text = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: any;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue; // ignore non-JSON noise
    }
    if (evt.type === "thread.started" && evt.thread_id) {
      sessionId = evt.thread_id;
    } else if (
      evt.type === "item.completed" &&
      evt.item?.type === "agent_message" &&
      typeof evt.item.text === "string"
    ) {
      // Last agent_message wins (the final answer of the turn).
      text = evt.item.text;
    }
  }
  return { text, sessionId };
}

export const codexRunner: AgentRunner = {
  name: "codex",
  description:
    "Delegate a task to OpenAI Codex (GPT). Good for fast implementation, " +
    "broad language coverage, and a second-opinion review. Supports model and reasoning.",
  defaults: { model: config.codex.model, reasoning: undefined },
  supportsReasoning: true,
  supportsThinking: false,

  async run(task: string, opts: RunOptions): Promise<RunResult> {
    const resuming = Boolean(opts.sessionId);

    // `codex exec` for a fresh run; `codex exec resume <id>` to continue one.
    const args: string[] = ["exec"];
    if (resuming) args.push("resume", opts.sessionId!);

    args.push("--json", "--skip-git-repo-check");

    // `resume` does not accept -s/--sandbox; it inherits the session's config.
    if (!resuming) args.push("-s", config.codex.sandbox);

    const model = opts.model ?? config.codex.model;
    if (model) args.push("-m", model);

    // Reasoning maps to the model_reasoning_effort config override. A bare value
    // fails TOML parsing and is used as a literal string, so no quotes needed.
    const reasoning = opts.reasoning ?? config.codex.reasoning;
    if (reasoning) args.push("-c", `model_reasoning_effort=${reasoning}`);

    // Read the prompt from stdin (passed below) rather than argv.
    args.push("-");

    const result = await runCommand("codex", args, {
      cwd: opts.cwd,
      env: childEnv(opts.depth),
      timeoutMs: opts.timeoutMs ?? config.timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
      stdin: task,
      signal: opts.signal,
    });

    if (result.code !== 0) {
      const tail = result.stderr.slice(-2000) || result.stdout.slice(-2000);
      throw new ExecError(`codex exited with code ${result.code}: ${tail}`, result);
    }

    const { text, sessionId } = parseCodexJsonl(result.stdout);
    if (!text && result.truncated) {
      throw new ExecError("codex output was truncated before a final message", result);
    }

    return {
      text,
      sessionId,
      // Codex (subscription auth) does not report a USD cost in its JSON stream.
      cost: undefined,
      truncated: result.truncated,
    };
  },
};
