#!/usr/bin/env node
/**
 * qantara CLI entry point.
 *   qantara              → run the MCP server on stdio (what hosts invoke)
 *   qantara setup        → detect installed agent CLIs and register the bridge
 *                          into each host's config (--dry-run to preview)
 *   qantara --version    → print the package version
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cmd = process.argv[2];

if (cmd === "--version" || cmd === "-v" || cmd === "version") {
  const pkg = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
      "utf8",
    ),
  );
  process.stdout.write(`qantara ${pkg.version}\n`);
} else if (cmd === "setup") {
  const { runSetup } = await import("./setup.js");
  await runSetup(process.argv.slice(3));
} else if (cmd === "--help" || cmd === "-h" || cmd === "help") {
  process.stdout.write(
    "qantara — an MCP bridge that lets coding agents delegate to each other\n\n" +
      "Usage:\n" +
      "  qantara            Run the MCP server on stdio (hosts invoke this)\n" +
      "  qantara setup      Register the bridge into Claude Code / Codex / Gemini\n" +
      "  qantara setup --dry-run   Show what setup would change, without writing\n" +
      "  qantara --version  Print the package version\n",
  );
} else {
  await import("./server.js");
}
