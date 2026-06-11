// Verifies the bridge can drive Gemini (ask_gemini). Run: node mcp-test-gemini.mjs
// Without a Gemini login this should fail CLEANLY with an auth message.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  env: { ...process.env, BRIDGE_EXPOSE: "gemini" },
});
const client = new Client({ name: "gemini-test", version: "0.0.0" });
await client.connect(transport);
console.log("TOOLS:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const res = await client.callTool({
  name: "ask_gemini",
  arguments: { task: "Reply with exactly: GEMINIOK" },
});
console.log("RESULT:", res.content?.[0]?.text ?? JSON.stringify(res));
await client.close();
process.exit(0);
