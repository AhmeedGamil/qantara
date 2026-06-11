// Verifies wait_job (blocking collection) and job notices (unread-job
// reminders riding on other answers). Run: node mcp-test-wait.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  env: { ...process.env, BRIDGE_EXPOSE: "codex" },
});
const client = new Client({ name: "wait-test", version: "0.0.0" });
await client.connect(transport);
const text = (res) => res.content?.[0]?.text ?? JSON.stringify(res);
const call = async (name, args = {}) => text(await client.callTool({ name, arguments: args }));

console.log("TOOLS:", (await client.listTools()).tools.map((t) => t.name).join(", "));

// --- 1. wait_job blocks and returns the finished result directly.
const startA = await call("ask_codex", { task: "Reply with exactly: WAITED", background: true });
const jobA = startA.match(/"([^"]+)"/)[1];
console.log("STARTED:", jobA);
const waited = await call("wait_job", { job_id: jobA });
console.log("WAIT_JOB:", waited.split("\n")[0]);
if (!waited.includes("WAITED")) throw new Error("wait_job did not return the result");

// --- 2. Job notices: finish a job without reading it, then make any other
// call — the answer should carry an unread-job notice.
const startB = await call("ask_codex", { task: "Reply with exactly: NOTICEME", background: true });
const jobB = startB.match(/"([^"]+)"/)[1];
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const list = await call("check_job"); // list view: shows status, delivers nothing
  if (list.includes(`${jobB} | codex | done`)) break;
}
const unrelated = await call("check_job", { job_id: "no-such-job" });
console.log("UNRELATED ANSWER:", JSON.stringify(unrelated));
if (!unrelated.includes(`notice: background job "${jobB}"`)) {
  throw new Error("expected an unread-job notice on an unrelated answer");
}

// --- 3. After delivering the result, the notice must stop.
const delivered = await call("check_job", { job_id: jobB });
if (!delivered.includes("NOTICEME")) throw new Error("job B result missing");
const after = await call("check_job", { job_id: "no-such-job" });
if (after.includes("notice:")) throw new Error("notice should stop after delivery");
console.log("NOTICE LIFECYCLE OK");

console.log("WAIT+NOTICES TEST PASSED");
await client.close();
process.exit(0);
