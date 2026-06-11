// Verifies explicit session resume: teach a session a word, resume it by
// session_id, and check the agent remembers. Run: node mcp-test-session.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  env: { ...process.env, BRIDGE_EXPOSE: "codex" },
});
const client = new Client({ name: "session-test", version: "0.0.0" });
await client.connect(transport);
const text = (res) => res.content?.[0]?.text ?? JSON.stringify(res);

const first = text(
  await client.callTool({
    name: "ask_codex",
    arguments: { task: "Remember the secret word: PINEAPPLE. Reply only: OK" },
  }),
);
console.log("FIRST:", first);
const sessionId = first.match(/session: (\S+)/)[1];
console.log("SESSION:", sessionId);

const second = text(
  await client.callTool({
    name: "ask_codex",
    arguments: {
      task: "What was the secret word? Reply with only that word.",
      session_id: sessionId,
    },
  }),
);
console.log("SECOND:", second);
if (!second.includes("PINEAPPLE")) throw new Error("session_id resume failed");
console.log("SESSION TEST PASSED");
await client.close();
process.exit(0);
