#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { config } from "./config.js";
import {
  type AgentRunner,
  exposedRunners,
  register,
} from "./registry.js";
import { getLastSession, setLastSession } from "./sessions.js";
import { createJob, getJob, listJobs, type Job } from "./jobs.js";
import { ExecError } from "./exec.js";
import { debug } from "./debug.js";
import { codexRunner } from "./runners/codex.js";
import { claudeRunner } from "./runners/claude.js";
import { geminiRunner } from "./runners/gemini.js";

// --- Register all available agents. Adding a new backend = one more line. ---
register(codexRunner);
register(claudeRunner);
register(geminiRunner);

function buildInputShape(runner: AgentRunner) {
  const shape: Record<string, z.ZodTypeAny> = {
    task: z
      .string()
      .min(1)
      .describe("The full task or question to delegate to this agent."),
    cwd: z
      .string()
      .optional()
      .describe("Absolute working directory the agent should operate in."),
    continue_session: z
      .boolean()
      .optional()
      .describe(
        "If true, resume the most recent session with this agent instead of " +
          "starting fresh. With parallel sessions, prefer session_id — this " +
          "shorthand resumes whichever session finished last.",
      ),
    session_id: z
      .string()
      .optional()
      .describe(
        "Resume this exact session (the id from a previous result's footer). " +
          "Takes precedence over continue_session. Use when running parallel " +
          "sessions with the same agent.",
      ),
    model: z
      .string()
      .optional()
      .describe("Override the model id for this call (omit to use the default)."),
    background: z
      .boolean()
      .optional()
      .describe(
        "Run as a background job: returns a job id immediately instead of " +
          "blocking. Poll it with check_job; the agent keeps working meanwhile. " +
          "Use for tasks likely to take more than a few minutes.",
      ),
  };
  if (runner.supportsReasoning) {
    shape.reasoning = z
      .enum(["low", "medium", "high"])
      .optional()
      .describe("Reasoning/effort level.");
  }
  if (runner.supportsThinking) {
    shape.thinking = z
      .enum(["off", "think", "think_hard", "ultrathink"])
      .optional()
      .describe("Extended-thinking level (off = none, ultrathink = maximum).");
  }
  return shape;
}

/**
 * Headless CLIs instruct their model that nobody is present, so an ambiguous
 * task gets a silent best guess. This preamble corrects that assumption: the
 * caller is an agent that CAN answer follow-ups via session resume. Prepended
 * only on fresh sessions (a resumed session already saw it).
 */
const CLARIFY_PREAMBLE =
  "[agent-bridge] You were delegated this task by another AI agent, which can " +
  "answer follow-up questions. If the task is ambiguous or missing information " +
  "you need, do NOT guess: reply with your specific questions instead of doing " +
  "the work, and the caller will resume this session with answers.";

function formatResult(
  agentName: string,
  text: string,
  sessionId?: string,
  cost?: number,
  truncated?: boolean,
): string {
  const footer: string[] = [];
  if (sessionId) footer.push(`session: ${sessionId}`);
  if (typeof cost === "number") footer.push(`cost: $${cost.toFixed(4)}`);
  if (truncated) footer.push("output truncated");
  const meta = footer.length ? `\n\n---\n[${agentName}] ${footer.join(" | ")}` : "";
  return `${text}${meta}`;
}

function textResult(text: string, isError = false) {
  return { ...(isError ? { isError: true } : {}), content: [{ type: "text" as const, text }] };
}

function elapsedSec(job: Job): number {
  return Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
}

async function main() {
  const server = new McpServer({
    name: "agent-bridge",
    version: "0.1.0",
  });

  const runners = exposedRunners([...config.expose]);

  for (const runner of runners) {
    server.tool(
      `ask_${runner.name}`,
      runner.description,
      buildInputShape(runner),
      async (args: any) => {
        debug(`tool ask_${runner.name} invoked: ${JSON.stringify(args).slice(0, 300)}`);
        // --- Depth / fan-out guard: refuse if we're already too deep. ---
        if (config.depth >= config.maxDepth) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text:
                  `Refused: agent-bridge recursion depth ${config.depth} has reached ` +
                  `the limit (BRIDGE_MAX_DEPTH=${config.maxDepth}). ` +
                  `This prevents runaway agent-to-agent loops.`,
              },
            ],
          };
        }

        // Explicit session id wins; continue_session is the sequential shorthand.
        const sessionId =
          args.session_id ??
          (args.continue_session ? getLastSession(runner.name) : undefined);

        // A resumed session already saw the preamble on its first turn.
        const task =
          config.clarify && !sessionId
            ? `${CLARIFY_PREAMBLE}\n\n${args.task}`
            : args.task;

        const runOpts = {
          cwd: args.cwd,
          sessionId,
          model: args.model,
          reasoning: args.reasoning,
          thinking: args.thinking,
          depth: config.depth,
        };

        if (args.background) {
          const job = createJob(runner.name, args.task);
          runner
            .run(task, {
              ...runOpts,
              timeoutMs: config.jobTimeoutMs,
              signal: job.abort.signal,
            })
            .then((res) => {
              if (job.status !== "running") return; // cancelled meanwhile
              job.status = "done";
              job.finishedAt = Date.now();
              job.result = res;
              setLastSession(runner.name, res.sessionId);
            })
            .catch((err) => {
              if (job.status !== "running") return;
              job.status = "failed";
              job.finishedAt = Date.now();
              job.error = err instanceof Error ? err.message : String(err);
            });
          debug(`job ${job.id} started`);
          return textResult(
            `Started background job "${job.id}" (${runner.name}). It runs while you ` +
              `continue working. Poll it with check_job (job_id: "${job.id}"); ` +
              `cancel with cancel_job. Jobs do not survive a host restart.`,
          );
        }

        try {
          const res = await runner.run(task, runOpts);
          setLastSession(runner.name, res.sessionId);
          return textResult(
            formatResult(runner.name, res.text, res.sessionId, res.cost, res.truncated),
          );
        } catch (err) {
          const msg =
            err instanceof ExecError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          return textResult(`ask_${runner.name} failed: ${msg}`, true);
        }
      },
    );
  }

  if (runners.length > 0) {
    server.tool(
      "check_job",
      "Check background delegation jobs started with ask_*'s background option. " +
        "With job_id: returns status, and the agent's full result once finished. " +
        "Without job_id: lists all jobs of this session.",
      {
        job_id: z
          .string()
          .optional()
          .describe("The job id returned when the job was started. Omit to list all jobs."),
      },
      async (args: any) => {
        if (!args.job_id) {
          const all = listJobs();
          if (all.length === 0) return textResult("No background jobs in this session.");
          const lines = all.map(
            (j) =>
              `${j.id} | ${j.agent} | ${j.status} | ${elapsedSec(j)}s | ${j.taskSummary}`,
          );
          return textResult(lines.join("\n"));
        }
        const job = getJob(args.job_id);
        if (!job) {
          return textResult(
            `No job "${args.job_id}". Call check_job without job_id to list jobs.`,
            true,
          );
        }
        switch (job.status) {
          case "running":
            return textResult(
              `Job "${job.id}" (${job.agent}) is still running (${elapsedSec(job)}s elapsed). ` +
                `Check again later.`,
            );
          case "done":
            return textResult(
              `Job "${job.id}" (${job.agent}) finished in ${elapsedSec(job)}s:\n\n` +
                formatResult(
                  job.agent,
                  job.result!.text,
                  job.result!.sessionId,
                  job.result!.cost,
                  job.result!.truncated,
                ),
            );
          case "failed":
            return textResult(
              `Job "${job.id}" (${job.agent}) failed after ${elapsedSec(job)}s: ${job.error}`,
              true,
            );
          case "cancelled":
            return textResult(`Job "${job.id}" (${job.agent}) was cancelled.`);
        }
      },
    );

    server.tool(
      "cancel_job",
      "Cancel a running background delegation job (kills the delegated agent).",
      {
        job_id: z.string().describe("The job id to cancel."),
      },
      async (args: any) => {
        const job = getJob(args.job_id);
        if (!job) return textResult(`No job "${args.job_id}".`, true);
        if (job.status !== "running") {
          return textResult(`Job "${job.id}" is already ${job.status}.`);
        }
        job.status = "cancelled";
        job.finishedAt = Date.now();
        job.abort.abort();
        debug(`job ${job.id} cancelled`);
        return textResult(`Job "${job.id}" cancelled.`);
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Announce readiness on stderr (stdout is reserved for the MCP protocol).
  const names = runners.map((r) => `ask_${r.name}`).join(", ");
  process.stderr.write(
    `agent-bridge ready (depth ${config.depth}/${config.maxDepth}); tools: ${names || "none"}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`agent-bridge fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
