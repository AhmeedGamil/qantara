import { appendFileSync } from "node:fs";

const target = process.env.BRIDGE_DEBUG;

// Startup diagnostic. Hosts may launch the bridge with a stripped environment
// (Codex passes only a whitelist of core OS vars), so logging the received env
// keys up front makes those problems visible without a debugger.
debug(
  `bridge process started | ` +
    `BRIDGE_EXPOSE=${process.env.BRIDGE_EXPOSE ?? "(unset)"} | ` +
    `BRIDGE_DEPTH=${process.env.BRIDGE_DEPTH ?? "(unset)"} | ` +
    `cwd=${process.cwd()} | ` +
    `envKeys=${Object.keys(process.env).sort().join(",")}`,
);

/**
 * Appends a timestamped line to the file named in BRIDGE_DEBUG (if set).
 * Used to diagnose runs where stderr is not visible (e.g. spawned by a host).
 */
export function debug(msg: string): void {
  if (!target) return;
  try {
    appendFileSync(target, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // best-effort logging only
  }
}
