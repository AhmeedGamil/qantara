import { type RunResult } from "./registry.js";

/**
 * In-memory store for background delegations. A job wraps one runner.run()
 * whose promise is not awaited by the tool call that started it; the caller
 * polls `check_job` instead of blocking. Scoped to this bridge process — jobs
 * do not survive a host restart (matches the session-scoped design of
 * sessions.ts).
 */
export interface Job {
  id: string;
  agent: string;
  /** First line of the task, for listings. */
  taskSummary: string;
  status: "running" | "done" | "failed" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  result?: RunResult;
  error?: string;
  /** True once the full result/error has been returned to the caller. */
  delivered?: boolean;
  /** Settles when the job finishes (success or failure); used by wait_job. */
  completion?: Promise<void>;
  abort: AbortController;
}

const jobs = new Map<string, Job>();
let counter = 0;

export function createJob(agent: string, task: string): Job {
  counter += 1;
  const job: Job = {
    id: `${agent}-${counter}`,
    agent,
    taskSummary: task.split("\n")[0].slice(0, 120),
    status: "running",
    startedAt: Date.now(),
    abort: new AbortController(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()];
}
