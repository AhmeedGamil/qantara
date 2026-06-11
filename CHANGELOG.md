# Changelog

All notable changes to qantara are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-06-11

Initial release.

### Added
- Stdio MCP server generating an `ask_<agent>` tool per registered agent —
  adapters included for **Claude Code**, **Codex**, and **Gemini** — so any
  host gains the ability to delegate tasks to the other agents via their
  headless CLIs, reusing your existing CLI logins.
- `qantara setup` — one-command installer: detects installed agent CLIs,
  registers the bridge into each host exposing the *other* agents,
  pre-approves the tools (Claude allowlist, Codex
  `default_tools_approval_mode`), and forwards proxy env vars into the Codex
  entry. Idempotent, backs up every file it touches, supports `--dry-run`.
- Background job system: `background: true` on `ask_*` returns a job id
  immediately instead of blocking; `check_job` polls status / fetches results /
  lists jobs; `cancel_job` kills a running delegation. Background jobs get
  `BRIDGE_JOB_TIMEOUT_MS` (1 h default) instead of the 10-minute blocking
  limit.
- Session resume: `continue_session` (sequential shorthand) and `session_id`
  (exact resume for parallel sessions with the same agent).
- Clarify preamble: delegated agents are told a supervising agent can answer
  follow-up questions, so they reply with questions instead of guessing on
  ambiguous tasks (`BRIDGE_CLARIFY=0` disables).
- Depth guard against agent→agent recursion loops (`BRIDGE_MAX_DEPTH`),
  per-call timeout, and output-size cap.
- Env-driven policy (`BRIDGE_*`), fixed at host registration time — callers
  cannot change policy at runtime.
