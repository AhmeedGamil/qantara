/**
 * Tracks the last session id per agent so `continue_session: true` can resume
 * the most recent conversation with that agent. In-memory only — scoped to the
 * lifetime of this MCP server process, which matches a single host session.
 */
const lastSessionByAgent = new Map<string, string>();

export function getLastSession(agent: string): string | undefined {
  return lastSessionByAgent.get(agent);
}

export function setLastSession(agent: string, sessionId: string | undefined): void {
  if (sessionId) lastSessionByAgent.set(agent, sessionId);
}
