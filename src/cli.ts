#!/usr/bin/env node
/**
 * qantara CLI entry point.
 *   qantara              → run the MCP server on stdio (what hosts invoke)
 *   qantara setup        → detect installed agent CLIs and register the bridge
 *                          into each host's config (--dry-run to preview)
 */
const cmd = process.argv[2];

if (cmd === "setup") {
  const { runSetup } = await import("./setup.js");
  await runSetup(process.argv.slice(3));
} else if (cmd === "--help" || cmd === "-h" || cmd === "help") {
  process.stdout.write(
    "qantara — an MCP bridge that lets coding agents delegate to each other\n\n" +
      "Usage:\n" +
      "  qantara            Run the MCP server on stdio (hosts invoke this)\n" +
      "  qantara setup      Register the bridge into Claude Code / Codex / Gemini\n" +
      "  qantara setup --dry-run   Show what setup would change, without writing\n",
  );
} else {
  await import("./server.js");
}
