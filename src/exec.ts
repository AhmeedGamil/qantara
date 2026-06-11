import { spawn } from "node:child_process";
import { debug } from "./debug.js";

export interface ExecOptions {
  cwd?: string;
  /** Extra environment variables merged over process.env. */
  env?: Record<string, string>;
  /** Hard timeout in milliseconds; the child is killed when exceeded. */
  timeoutMs: number;
  /** Max bytes of stdout/stderr to retain (protects the caller's context). */
  maxOutputBytes: number;
  /** Optional string written to the child's stdin, then closed. */
  stdin?: string;
  /** Optional abort signal; aborting kills the child (used by cancel_job). */
  signal?: AbortSignal;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True if the process was killed because it exceeded timeoutMs. */
  timedOut: boolean;
  /** True if stdout was truncated at maxOutputBytes. */
  truncated: boolean;
}

export class ExecError extends Error {
  constructor(message: string, readonly result?: ExecResult) {
    super(message);
    this.name = "ExecError";
  }
}

/**
 * Spawn a command with an args array (never a shell string) so arbitrary task
 * text cannot be interpreted by the shell. Enforces a timeout and an output cap.
 *
 * On Windows, `.cmd` shims (npm-installed CLIs) are not directly executable by
 * spawn without a shell, so we resolve the actual command up front via PATHEXT.
 */
export function runCommand(
  command: string,
  args: string[],
  opts: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    // On Windows, .cmd/.bat shims require shell:true to be invoked. We keep the
    // args array form so values are still passed as discrete argv entries.
    const isWindows = process.platform === "win32";

    debug(
      `spawn command=${command} args=${JSON.stringify(args)} cwd=${opts.cwd ?? "(inherit)"} ` +
        `shell=${isWindows} PATH_present=${Boolean(process.env.PATH || process.env.Path)}`,
    );

    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: isWindows, // needed for npm .cmd shims on Windows
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const cap = opts.maxOutputBytes;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    const onAbort = () => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < cap) {
        stdout += chunk.toString("utf8");
        if (stdout.length >= cap) {
          stdout = stdout.slice(0, cap);
          truncated = true;
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < cap) {
        stderr += chunk.toString("utf8");
        if (stderr.length >= cap) stderr = stderr.slice(0, cap);
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      debug(`child error for ${command}: ${(err as Error).message}`);
      // ENOENT => binary missing; surface a clear, actionable message.
      const hint =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? ` (is "${command}" installed and on PATH?)`
          : "";
      reject(new ExecError(`Failed to launch "${command}"${hint}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      debug(
        `child close ${command} code=${code} stdoutLen=${stdout.length} ` +
          `stderrTail=${JSON.stringify(stderr.slice(-300))}`,
      );
      opts.signal?.removeEventListener("abort", onAbort);
      const result: ExecResult = { code, stdout, stderr, timedOut, truncated };
      if (cancelled) {
        reject(new ExecError(`"${command}" was cancelled`, result));
        return;
      }
      if (timedOut) {
        reject(
          new ExecError(
            `"${command}" timed out after ${opts.timeoutMs}ms`,
            result,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}
