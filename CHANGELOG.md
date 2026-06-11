# Changelog

All notable changes to qantara are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-06-11

### Added
- **Renamed to qantara** (formerly `agent-bridge`, which is taken on npm).
- `qantara setup` — one-command installer: detects installed agent CLIs
  (claude / codex / gemini), registers the bridge into each host exposing the
  *other* agents, pre-approves the tools, and forwards proxy env vars into the
  Codex entry. Idempotent, backs up every file it touches, supports `--dry-run`.
- `qantara` CLI entry point (`qantara` runs the MCP server, `qantara setup`
  installs, `--help`, `--version`).
- Gemini adapter (`ask_gemini`) via gemini-cli: JSON output parsing, headless
  session resume, `--approval-mode` policy (`BRIDGE_GEMINI_APPROVAL`),
  `--skip-trust` so folder trust can't silently downgrade the configured policy.
- `session_id` parameter on every `ask_*` tool — resume an exact session when
  running parallel sessions with the same agent (`continue_session` remains the
  sequential shorthand).
- Logo and badges in the README.

## [0.2.0] — 2026-06-11

### Added
- Background job system: `background: true` on `ask_*` returns a job id
  immediately instead of blocking; `check_job` polls status / fetches results /
  lists jobs; `cancel_job` kills a running delegation. Background jobs get
  `BRIDGE_JOB_TIMEOUT_MS` (1 h default) instead of the 10-minute blocking limit.
- Clarify preamble: delegated agents are told a supervising agent can answer
  follow-up questions, so they reply with questions instead of guessing on
  ambiguous tasks (`BRIDGE_CLARIFY=0` disables).
- Cancellation support (AbortSignal) in the exec layer.
- MIT license, publication-ready README and package metadata.

### Fixed
- Codex → Claude in headless `codex exec`: requires
  `default_tools_approval_mode = "approve"` on the MCP server entry (Codex
  auto-cancels MCP approval prompts when no human is present).
- Proxy-dependent `claude` logins failing with 403 under Codex: Codex strips
  the environment for MCP servers, so proxy vars must be re-declared in the
  server's env block (documented; `qantara setup` now does it automatically).

## [0.1.0] — 2026-06-10

### Added
- Initial bridge: stdio MCP server generating an `ask_<agent>` tool per
  registered runner (Claude Code, Codex), with `cwd`, model / reasoning /
  thinking knobs, session resume (`continue_session`), depth guard against
  agent→agent recursion loops, per-call timeout, and an output-size cap.
