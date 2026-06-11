// Ad-hoc smoke test for the runners. Run: node smoke.mjs
import { codexRunner } from "./dist/runners/codex.js";
import { claudeRunner } from "./dist/runners/claude.js";

const task = "Reply with exactly the single word: BRIDGEOK";

async function test(runner) {
  const t0 = Date.now();
  try {
    const res = await runner.run(task, { depth: 0 });
    console.log(
      `[${runner.name}] OK in ${Date.now() - t0}ms | text=${JSON.stringify(
        res.text.slice(0, 80),
      )} | session=${res.sessionId ?? "none"} | cost=${res.cost ?? "n/a"}`,
    );
  } catch (e) {
    console.log(`[${runner.name}] FAIL: ${e.message}`);
  }
}

await test(claudeRunner);
await test(codexRunner);
