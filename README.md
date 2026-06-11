<p align="center">
  <img src="https://raw.githubusercontent.com/ahmeedgamil/qantara/main/assets/qantara_logo.png" alt="Qantara" width="300">
  <br>
  <em>An arched bridge between your coding agents.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/qantara"><img alt="npm version" src="https://img.shields.io/npm/v/qantara"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <img alt="Node.js >= 18" src="https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white">
  <img alt="MCP server" src="https://img.shields.io/badge/MCP-server-8A2BE2">
  <img alt="Bridges Claude, Codex, Gemini" src="https://img.shields.io/badge/bridges-Claude%20%C2%B7%20Codex%20%C2%B7%20Gemini-FF6B35">
</p>

---

An MCP server that lets coding agents **delegate tasks to each other**. Claude Code can
hand a task to Codex or Gemini, Codex can hand a task to Claude, and the design extends
to any other agent (Aider, …) by adding a small adapter.

It works by shelling out to each tool's **headless CLI** (`claude -p`, `codex exec`,
`gemini -p`), so it **reuses your existing CLI logins** — no extra API keys, no separate
per-token billing.

```
Claude Code ──(MCP tool: ask_codex)──► qantara ──► codex exec --json ──► Codex
Codex       ──(MCP tool: ask_claude)─► qantara ──► claude -p --json ──► Claude Code
Gemini      ──(MCP tool: ask_codex)──► qantara ──► ...
```

## Setup (one command)

```powershell
npm i -g qantara     # or run from a clone: npm install && npm run build
qantara setup        # detects claude/codex/gemini, registers the bridge in each
```

`setup` detects which agent CLIs are installed, registers qantara into each host
(exposing the *other* agents as tools), pre-approves the tools so nothing prompts,
and forwards your proxy env to Codex if you have one. It backs up every file it
touches (`*.qantara.bak`), is idempotent, and `qantara setup --dry-run` shows the
plan without writing. Restart your hosts afterwards — MCP servers load at session
start. The sections below describe what it writes, for manual setup or auditing.

## The control model

There is no central controller — control follows whoever you talk to:

```
You (the human)
 └── Host agent — whichever one you opened (Claude Code OR Codex)
      └── qantara (dumb pipe, controls nothing)
           └── Delegated agent (contractor: gets a brief, works, reports, exits)
                └── can delegate again, down to a depth limit
```

- **You** own all policy: which agents exist, what they may do, every limit. Policy is
  written in config files *before* anything runs; there is no API for an agent to change
  it at runtime.
- **The host agent** is the brain for the session: it decides when to delegate, writes the
  brief, and judges the result. The roles are symmetric — open Claude Code and Claude
  commands Codex; open Codex and Codex commands Claude.
- **The bridge makes no decisions** about the work. It translates one MCP tool call into
  one CLI invocation and enforces mechanical guards (depth, timeout, output cap). All
  intelligence and all safety policy live in the agents and in your config.
- **The delegated agent** is autonomous *within* its task, but its powers (sandbox,
  permission mode) were fixed by your config before it started — not by the caller.

Delegation is a *letter, not a phone call*: the delegated agent gets only the task text,
none of the caller's conversation. Write briefs accordingly (file paths, constraints,
acceptance criteria). By default the bridge tells delegated agents to **reply with
questions instead of guessing** when a task is ambiguous; answer them with a
`continue_session: true` follow-up call.

## Prerequisites

- Node.js 18+
- The agent CLIs you want to bridge, installed and logged in:
  - `npm i -g @anthropic-ai/claude-code` (`claude`)
  - `npm i -g @openai/codex` (`codex`)
  - `npm i -g @google/gemini-cli` (`gemini`) — log in by running `gemini` once
    interactively (Google account), or set `GEMINI_API_KEY`

## Build

```powershell
npm install
npm run build
```

## Manual registration (what `setup` writes)

### Into Claude Code (gives Claude `ask_codex` / `ask_gemini`)

```powershell
claude mcp add -s user qantara -e BRIDGE_EXPOSE=codex,gemini -- node "<path-to>/qantara/dist/server.js"
```

To skip the per-session permission prompt, allowlist the server in
`~/.claude/settings.json` (one entry covers all its tools):

```json
{
  "permissions": {
    "allow": ["mcp__qantara"]
  }
}
```

### Into Codex (gives Codex `ask_claude` / `ask_gemini`)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.qantara]
command = "node"
args = ['<path-to>/qantara/dist/server.js']
enabled = true
startup_timeout_sec = 120
tool_timeout_sec = 600
# Required for headless `codex exec`: without this, Codex auto-cancels the
# MCP tool call ("user cancelled MCP tool call") because there is no human
# to approve it. Also removes the prompt in interactive Codex.
# Available since Codex 0.122.0.
default_tools_approval_mode = "approve"

[mcp_servers.qantara.env]
BRIDGE_EXPOSE = "claude"
# Codex spawns MCP servers with a stripped environment (a fixed whitelist of
# core OS vars). If your `claude` login needs a proxy (HTTP_PROXY/HTTPS_PROXY),
# you MUST re-declare it here or the spawned claude gets
# "API Error: 403 Request not allowed".
# HTTP_PROXY = "http://user:pass@host:port"
# HTTPS_PROXY = "http://user:pass@host:port"
# NO_PROXY = "localhost,127.0.0.1,::1"
```

> The general rule: **the caller's side pre-approves the tool call** (Claude's
> `permissions.allow`, Codex's `default_tools_approval_mode`); **the delegated agent never
> prompts** — its behavior is governed by the `BRIDGE_*` policy below. If you expose both
> agents in one host (`BRIDGE_EXPOSE = "all"`), allowlist both `ask_*` tool names.

## Tools

### `ask_<agent>` — delegate a task

| Param              | Type                                            | Notes                                            |
| ------------------ | ----------------------------------------------- | ------------------------------------------------ |
| `task`             | string (required)                               | The work to delegate. Include all context — the agent sees nothing else. |
| `cwd`              | string                                          | Working directory for the agent (set it to your project to work on the same files). |
| `continue_session` | boolean                                         | Resume the last session with this agent (sequential shorthand). |
| `session_id`       | string                                          | Resume an exact session (id from a result's footer). Takes precedence over `continue_session`; use with parallel sessions. |
| `background`       | boolean                                         | Don't block: returns a job id immediately. Poll with `check_job`. For long tasks. |
| `model`            | string                                          | Override the model (e.g. `gpt-5.5`, `opus`).     |
| `reasoning`        | `low` \| `medium` \| `high`                     | Maps to Codex `model_reasoning_effort` / Claude `--effort`. |
| `thinking`         | `off` \| `think` \| `think_hard` \| `ultrathink` | **Claude only** — extended thinking.             |

Blocking calls time out after `BRIDGE_TIMEOUT_MS` (10 min default). For anything that
might run longer, use `background: true` — background jobs get `BRIDGE_JOB_TIMEOUT_MS`
(1 h default) and the caller keeps working while they run.

### `wait_job` / `check_job` / `cancel_job` — manage background jobs

- `wait_job`: **the reliable way to collect a job** — blocks until the job
  finishes, then returns its full result. Use it when there's no other work
  left, instead of a polling loop that can be forgotten. Blocks up to
  `BRIDGE_WAIT_CAP_MS` (~8 min) per call, then reports still-running — just
  call it again.
- `check_job` with a `job_id`: non-blocking status, and the full result once
  finished.
- `check_job` without arguments: list all jobs of the session.
- `cancel_job`: kill a running job.

**Job notices:** the bridge cannot push messages (MCP servers only answer),
so when a job finishes and its result hasn't been read yet, a reminder rides
along on the next answer the bridge gives — whatever the call was:

```
[qantara] notice: background job "codex-2" (codex) finished 45s ago and is
unread — call check_job with job_id "codex-2".
```

Notices stop once the result has been delivered.

Jobs live in the bridge process's memory: they last for your host session and
are gone after a restart.

## Working on the same project

Pass your project path as `cwd` and both agents edit the same real files. Within one
delegation there is no write conflict — the caller is paused (or, for background jobs,
should avoid editing the same areas). Two habits make this reliable:

1. **Re-read changed files after a delegation returns.** The caller's in-context copy is
   stale the moment the child edits the file.
2. **One writer per area at a time.** There is no locking and no git isolation — the
   working tree and the git index are shared. (Worktree isolation is on the roadmap.)

## Configuration (environment variables)

Set these in the host's MCP registration (see above). They are read once at startup —
**callers cannot change policy at runtime.**

| Variable                  | Default           | Purpose                                              |
| ------------------------- | ----------------- | ---------------------------------------------------- |
| `BRIDGE_EXPOSE`           | `all`             | Comma list of agents to expose (`codex`, `claude`, `gemini`). |
| `BRIDGE_MAX_DEPTH`        | `3`               | Max agent→agent recursion depth (loop guard).        |
| `BRIDGE_TIMEOUT_MS`       | `600000`          | Timeout per blocking call (10 min).                  |
| `BRIDGE_JOB_TIMEOUT_MS`   | `3600000`         | Timeout per background job (1 h).                    |
| `BRIDGE_WAIT_CAP_MS`      | `480000`          | Max block per `wait_job` call (8 min).               |
| `BRIDGE_MAX_OUTPUT_BYTES` | `1000000`         | Output cap (protects the caller's context).          |
| `BRIDGE_CLARIFY`          | `1`               | Tell delegated agents to ask instead of guess. `0` to disable. |
| `BRIDGE_SANDBOX`          | `workspace-write` | Codex sandbox (`read-only`/`workspace-write`/`danger-full-access`). |
| `BRIDGE_CLAUDE_PERMISSION`| `acceptEdits`     | Claude permission mode (`bypassPermissions` for full autonomy). |
| `BRIDGE_GEMINI_APPROVAL`  | `auto_edit`       | Gemini approval mode (`default`/`auto_edit`/`yolo`/`plan`). |
| `BRIDGE_GEMINI_MODEL`     | (CLI default)     | Default Gemini model.                                |
| `BRIDGE_CODEX_MODEL`      | (CLI default)     | Default Codex model.                                 |
| `BRIDGE_CODEX_REASONING`  | (CLI default)     | Default Codex reasoning effort.                      |
| `BRIDGE_CLAUDE_MODEL`     | (CLI default)     | Default Claude model.                                |
| `BRIDGE_DEBUG`            | (off)             | Path of a file to append diagnostic logs to.         |

## Security notes

- **The caller's sandbox does not propagate.** Hosts run MCP servers *outside* their own
  sandbox, so a tightly sandboxed Codex session can still delegate to a Claude that runs
  with normal user privileges (and vice versa). A delegated agent's limits come entirely
  from the `BRIDGE_*` policy you configured — never from the caller's restrictions. Choose
  `BRIDGE_SANDBOX` / `BRIDGE_CLAUDE_PERMISSION` as if the delegated agent were launched
  directly by you, because effectively it is.
- **Codex delegate:** headless Codex never prompts — actions outside its sandbox simply
  fail. Note that `workspace-write` blocks network for shell commands by default (e.g.
  `npm install` inside a task may fail).
- **Claude delegate:** `acceptEdits` auto-approves file edits but refuses Bash commands
  outside your allowlist (headless mode cannot prompt). `bypassPermissions` removes all
  gates — use deliberately.
- **Gemini delegate:** `auto_edit` auto-approves edits; shell commands are denied (no
  prompt is possible headless). `yolo` approves everything. The bridge passes
  `--skip-trust` so gemini's folder-trust feature doesn't silently downgrade the
  approval mode — your `BRIDGE_GEMINI_APPROVAL` is the single source of policy.
- **Loop guard:** `BRIDGE_DEPTH` is threaded into each spawned child and incremented; at
  `BRIDGE_MAX_DEPTH` further `ask_*` calls are refused, so A→B→A→B recursion cannot burn
  your subscriptions. There is no per-session call-count or cost budget yet — the host
  agent (and your subscription limits) govern how many delegations happen.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Codex replies "user cancelled MCP tool call" | Headless Codex auto-cancels MCP approval prompts. Set `default_tools_approval_mode = "approve"` on the server entry in `~/.codex/config.toml`. |
| Delegated `claude` fails: `API Error: 403 Request not allowed` | Your Anthropic traffic needs a proxy, and Codex stripped `HTTP_PROXY`/`HTTPS_PROXY` from the bridge's env. Re-declare them in `[mcp_servers.qantara.env]`. |
| `codex exec` hangs on "Reading additional input from stdin..." | When scripting Codex, close stdin (`$null | codex exec …` in PowerShell, `codex exec … < /dev/null` in sh). |
| `continue_session` doesn't resume across separate `codex exec` runs | Session ids live in the bridge process's memory; each headless run spawns a fresh bridge. Works as expected in interactive hosts. |
| A blocking call dies at 10 minutes | Use `background: true` (1 h budget), or raise `BRIDGE_TIMEOUT_MS`. |
| `ask_gemini` fails with exit code 41 / "set an Auth method" | The gemini CLI isn't logged in. Run `gemini` once interactively, or set `GEMINI_API_KEY` in the bridge's env block. |
| Gemini `continue_session` doesn't find the session | Gemini sessions are project-scoped (keyed by cwd) — resume only works with the same `cwd` as the original call. |

## Adding another agent

1. Create `src/runners/<name>.ts` implementing the `AgentRunner` interface from
   [`src/registry.ts`](src/registry.ts).
2. `register(<name>Runner)` in [`src/server.ts`](src/server.ts).

No changes to the MCP layer or core are needed — an `ask_<name>` tool appears automatically.

## Smoke tests

```powershell
node smoke.mjs            # calls each runner directly with a trivial task
node mcp-test.mjs         # connects an MCP client, lists tools, calls one
node mcp-test-claude.mjs  # drives the claude runner through MCP
node mcp-test-gemini.mjs  # drives the gemini runner through MCP
node mcp-test-jobs.mjs    # background jobs: start, poll, result, cancel, list
node mcp-test-session.mjs # explicit resume: teach a word, resume by session_id
```

## Roadmap

- **Git worktree isolation** — run each delegation in a temp worktree and return a
  reviewable diff instead of editing the shared tree.
- Live progress for background jobs (parse the child's JSON stream incrementally).
- Per-session call-count / cost budget guard.
- More adapters (Aider, …). Gemini CLI is already included.

## License

MIT
