// Verifies the bridge can drive Claude (ask_claude). Run: node mcp-test-claude.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  env: { ...process.env, BRIDGE_EXPOSE: "claude" },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);
console.log("TOOLS:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const res = await client.callTool({
  name: "ask_claude",
  arguments: { task: "Reply with exactly: ROUNDTRIP" },
});
console.log("RESULT:", res.content?.[0]?.text ?? JSON.stringify(res));
await client.close();
process.exit(0);
