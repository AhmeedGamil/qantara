/**
 * The single abstraction the whole bridge is built on. Every backend agent
 * (Codex, Claude, and later Gemini / Antigravity / Aider / ...) is just an
 * adapter implementing this interface. Adding a new agent = one new adapter
 * file + one registry entry, with no changes to the MCP server or core.
 */

export type ReasoningLevel = "low" | "medium" | "high";

/** Claude-specific extended-thinking levels (keywords resolve to token budgets). */
export type ThinkingLevel = "off" | "think" | "think_hard" | "ultrathink";

export interface RunOptions {
  /** Working directory the agent should operate in. */
  cwd?: string;
  /** Resume this provider-specific session id, if supported. */
  sessionId?: string;
  /** Override the model id for this call (e.g. a specific GPT/Claude version). */
  model?: string;
  /** Override reasoning/effort; adapters map or ignore per backend support. */
  reasoning?: ReasoningLevel;
  /** Extended-thinking level; honored by adapters that support it (e.g. Claude). */
  thinking?: ThinkingLevel;
  /** Current recursion depth (for the fan-out guard); passed to children. */
  depth: number;
  /** Override the per-call timeout (background jobs use a longer one). */
  timeoutMs?: number;
  /** Abort signal; aborting kills the spawned agent (used by cancel_job). */
  signal?: AbortSignal;
}

export interface RunResult {
  /** The agent's final answer text. */
  text: string;
  /** Provider session id for follow-up `continue_session` calls, if any. */
  sessionId?: string;
  /** Cost in USD if the backend reports it. */
  cost?: number;
  /** True if output was truncated by the output cap. */
  truncated?: boolean;
}

export interface AgentRunner {
  /** Stable identifier; the MCP tool is generated as `ask_<name>`. */
  readonly name: string;
  /** Human-facing one-liner used in the MCP tool description. */
  readonly description: string;
  /** Defaults applied when a call omits model/reasoning. */
  readonly defaults: { model?: string; reasoning?: ReasoningLevel };
  /** Whether this backend honors the `reasoning` param at all. */
  readonly supportsReasoning: boolean;
  /** Whether this backend honors the `thinking` param (e.g. Claude). */
  readonly supportsThinking: boolean;
  run(task: string, opts: RunOptions): Promise<RunResult>;
}

const registry = new Map<string, AgentRunner>();

export function register(runner: AgentRunner): void {
  registry.set(runner.name, runner);
}

export function getRunner(name: string): AgentRunner | undefined {
  return registry.get(name);
}

/**
 * Returns the runners that should be exposed as tools, filtered by the
 * `expose` allow-list (empty/`all` => every registered runner).
 */
export function exposedRunners(expose: string[]): AgentRunner[] {
  const all = [...registry.values()];
  if (expose.length === 0 || expose.includes("all")) return all;
  return all.filter((r) => expose.includes(r.name));
}
