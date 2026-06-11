// Verifies the background job system: start a job, poll check_job to completion,
// and exercise cancel_job on a second job. Run: node mcp-test-jobs.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  env: { ...process.env, BRIDGE_EXPOSE: "codex" },
});
const client = new Client({ name: "jobs-test", version: "0.0.0" });
await client.connect(transport);

const text = (res) => res.content?.[0]?.text ?? JSON.stringify(res);
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("TOOLS:", tools.join(", "));
if (!tools.includes("check_job") || !tools.includes("cancel_job")) {
  throw new Error("job tools missing");
}

// 1. Start a background job and poll until it finishes.
const start = await client.callTool({
  name: "ask_codex",
  arguments: { task: "Reply with exactly: JOBDONE", background: true },
});
console.log("START:", text(start));
const jobId = text(start).match(/"([^"]+)"/)[1];

let status;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  status = text(await client.callTool({ name: "check_job", arguments: { job_id: jobId } }));
  console.log(`POLL ${i}:`, status.split("\n")[0]);
  if (!status.includes("still running")) break;
}
if (!status.includes("JOBDONE")) throw new Error("job did not return expected result");

// 2. Start another job and cancel it immediately.
const start2 = await client.callTool({
  name: "ask_codex",
  arguments: { task: "Count to one million slowly.", background: true },
});
const jobId2 = text(start2).match(/"([^"]+)"/)[1];
console.log("CANCEL:", text(await client.callTool({ name: "cancel_job", arguments: { job_id: jobId2 } })));
const after = text(await client.callTool({ name: "check_job", arguments: { job_id: jobId2 } }));
console.log("AFTER CANCEL:", after);
if (!after.includes("cancelled")) throw new Error("cancel did not stick");

// 3. List all jobs.
console.log("LIST:\n" + text(await client.callTool({ name: "check_job", arguments: {} })));

console.log("JOBS TEST PASSED");
await client.close();
process.exit(0);
