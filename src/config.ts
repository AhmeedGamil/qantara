/**
 * Central, env-driven configuration. All knobs are environment variables so the
 * same binary can be registered into different hosts with different scoping
 * (e.g. expose only `codex` inside Claude Code, only `claude` inside Codex).
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function list(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  /** Hard timeout per blocking agent invocation. */
  timeoutMs: num("BRIDGE_TIMEOUT_MS", 600_000),
  /** Hard timeout per background job (longer: jobs don't block the caller). */
  jobTimeoutMs: num("BRIDGE_JOB_TIMEOUT_MS", 3_600_000),
  /** Max bytes of captured output, to protect the calling model's context. */
  maxOutputBytes: num("BRIDGE_MAX_OUTPUT_BYTES", 1_000_000),

  /** Which agents to expose as tools (empty => all registered). */
  expose: list("BRIDGE_EXPOSE"),

  /**
   * Tell delegated agents that a supervising agent can answer follow-up
   * questions (via session resume), so they ask instead of guessing when a
   * task is ambiguous. Disable with BRIDGE_CLARIFY=0.
   */
  clarify: process.env.BRIDGE_CLARIFY !== "0",

  /** Recursion / fan-out guard. */
  maxDepth: num("BRIDGE_MAX_DEPTH", 3),
  /** Current depth, threaded in from a parent bridge invocation (0 at the top). */
  depth: num("BRIDGE_DEPTH", 0),

  /** Codex execution settings. */
  codex: {
    sandbox: process.env.BRIDGE_SANDBOX ?? "workspace-write",
    model: process.env.BRIDGE_CODEX_MODEL, // undefined => CLI default
    reasoning: process.env.BRIDGE_CODEX_REASONING, // undefined => CLI default
  },

  /** Claude execution settings. */
  claude: {
    permissionMode: process.env.BRIDGE_CLAUDE_PERMISSION ?? "acceptEdits",
    model: process.env.BRIDGE_CLAUDE_MODEL, // undefined => CLI default
  },

  /** Gemini execution settings. */
  gemini: {
    // default | auto_edit | yolo | plan — auto_edit mirrors Claude's acceptEdits.
    approvalMode: process.env.BRIDGE_GEMINI_APPROVAL ?? "auto_edit",
    model: process.env.BRIDGE_GEMINI_MODEL, // undefined => CLI default
  },
} as const;

/** Env to pass to a spawned child agent so depth increments and propagates. */
export function childEnv(currentDepth: number): Record<string, string> {
  return { BRIDGE_DEPTH: String(currentDepth + 1) };
}
