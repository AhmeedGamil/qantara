// Verifies the MCP server: connects, lists tools, calls one. Run: node mcp-test.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath, // node
  args: ["dist/server.js"],
  env: { ...process.env, BRIDGE_EXPOSE: "all" },
});

const client = new Client({ name: "smoke-client", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "));
for (const t of tools) {
  console.log(`  ${t.name}: params = ${Object.keys(t.inputSchema.properties ?? {}).join(", ")}`);
}

console.log("\nCalling ask_codex...");
const res = await client.callTool({
  name: "ask_codex",
  arguments: { task: "Reply with exactly: MCPOK" },
});
console.log("RESULT:", JSON.stringify(res.content?.[0]?.text ?? res, null, 2));

await client.close();
process.exit(0);
