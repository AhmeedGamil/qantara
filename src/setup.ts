/**
 * `qantara setup` — one-command registration into every detected host.
 *
 * Principles:
 *  - Surgical merges only: never rewrite a host's config wholesale.
 *  - Backup before touching any file (<file>.qantara.bak).
 *  - Idempotent: running twice changes nothing the second time.
 *  - --dry-run prints the plan without writing.
 *
 * Per host it configures the bridge to expose every OTHER detected agent
 * (Claude sees ask_codex/ask_gemini, Codex sees ask_claude/ask_gemini, ...).
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = "qantara";

interface Action {
  desc: string;
  apply: () => string; // returns a result line
}

function cliWorks(cmd: string): boolean {
  try {
    const r = spawnSync(cmd, ["--version"], {
      shell: true,
      windowsHide: true,
      timeout: 60_000,
      encoding: "utf8",
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function backup(file: string): void {
  copyFileSync(file, `${file}.qantara.bak`);
}

/** Proxy vars worth forwarding into hosts that strip the environment (Codex). */
function proxyVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]) {
    const v = process.env[key] ?? process.env[key.toLowerCase()];
    if (v) out[key] = v;
  }
  return out;
}

export async function runSetup(argv: string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), "server.js");
  const nodePath = process.execPath;
  const home = homedir();

  console.log(`qantara setup${dryRun ? " (dry run)" : ""}`);
  console.log(`  server: ${serverPath}`);

  const detected: Record<string, boolean> = {
    claude: cliWorks("claude"),
    codex: cliWorks("codex"),
    gemini: cliWorks("gemini"),
  };
  const agents = Object.keys(detected).filter((k) => detected[k]);
  console.log(
    `  detected: ${Object.entries(detected)
      .map(([k, v]) => `${k}=${v ? "yes" : "no"}`)
      .join("  ")}`,
  );
  if (agents.length < 2) {
    console.log(
      "Fewer than two agent CLIs found — there is nothing to bridge. " +
        "Install at least two of: claude, codex, gemini.",
    );
    return;
  }

  const exposeFor = (host: string) =>
    agents.filter((a) => a !== host).join(",");
  const actions: Action[] = [];
  const warnings: string[] = [];

  // ---------- Claude Code (via its own `claude mcp` CLI) ----------
  if (detected.claude) {
    const legacy = spawnSync("claude", ["mcp", "get", "agent-bridge"], {
      shell: true,
      windowsHide: true,
      timeout: 60_000,
      encoding: "utf8",
    });
    if (legacy.status === 0) {
      warnings.push(
        'Claude Code still has the old "agent-bridge" server registered — ' +
          "remove it with: claude mcp remove -s user agent-bridge",
      );
    }
    const existing = spawnSync("claude", ["mcp", "get", SERVER], {
      shell: true,
      windowsHide: true,
      timeout: 60_000,
      encoding: "utf8",
    });
    if (existing.status === 0) {
      console.log("  claude: already registered — skipping");
    } else {
      const expose = exposeFor("claude");
      actions.push({
        desc: `claude: register "${SERVER}" (user scope) with BRIDGE_EXPOSE=${expose}`,
        apply: () => {
          const r = spawnSync(
            "claude",
            // Name must precede -e: the -e option is variadic and would
            // otherwise swallow the server name as another KEY=value.
            [
              "mcp", "add", "-s", "user", SERVER,
              "-e", `BRIDGE_EXPOSE=${expose}`,
              "--", `"${nodePath}"`, `"${serverPath}"`,
            ],
            { shell: true, windowsHide: true, timeout: 120_000, encoding: "utf8" },
          );
          if (r.status !== 0) {
            throw new Error(`claude mcp add failed: ${r.stderr || r.stdout}`);
          }
          return "registered via `claude mcp add -s user`";
        },
      });
    }

    // Pre-approve the bridge's tools so they don't prompt every session.
    const settingsPath = join(home, ".claude", "settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const allow: string[] = (settings.permissions ??= {}).allow ??= [];
      if (allow.includes(`mcp__${SERVER}`)) {
        console.log("  claude: tools already allowlisted — skipping");
      } else {
        actions.push({
          desc: `claude: allowlist "mcp__${SERVER}" in ~/.claude/settings.json`,
          apply: () => {
            backup(settingsPath);
            allow.push(`mcp__${SERVER}`);
            writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
            return "allowlisted (backup: settings.json.qantara.bak)";
          },
        });
      }
    }
  }

  // ---------- Codex (append to ~/.codex/config.toml) ----------
  if (detected.codex) {
    const configPath = join(
      process.env.CODEX_HOME ?? join(home, ".codex"),
      "config.toml",
    );
    const toml = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    if (toml.includes("[mcp_servers.agent-bridge]")) {
      warnings.push(
        'Codex config still has the old "[mcp_servers.agent-bridge]" entry — ' +
          `remove it from ${configPath} to avoid running two copies of the bridge.`,
      );
    }
    if (toml.includes(`[mcp_servers.${SERVER}]`)) {
      console.log("  codex: already registered — skipping");
    } else {
      const expose = exposeFor("codex");
      const proxies = proxyVars();
      actions.push({
        desc:
          `codex: append [mcp_servers.${SERVER}] to ${configPath} ` +
          `(BRIDGE_EXPOSE=${expose}, approval=approve` +
          (Object.keys(proxies).length ? ", forwarding proxy vars" : "") +
          ")",
        apply: () => {
          if (existsSync(configPath)) backup(configPath);
          const lines = [
            "",
            `[mcp_servers.${SERVER}]`,
            `command = '${nodePath}'`,
            `args = ['${serverPath}']`,
            "enabled = true",
            "startup_timeout_sec = 120",
            "tool_timeout_sec = 600",
            "# Required so headless `codex exec` does not auto-cancel MCP tool calls.",
            'default_tools_approval_mode = "approve"',
            "",
            `[mcp_servers.${SERVER}.env]`,
            `BRIDGE_EXPOSE = "${expose}"`,
          ];
          if (Object.keys(proxies).length) {
            lines.push(
              "# Codex strips the environment for MCP servers; forward the proxy.",
            );
            for (const [k, v] of Object.entries(proxies)) {
              lines.push(`${k} = "${v}"`);
            }
          }
          writeFileSync(configPath, toml + lines.join("\n") + "\n");
          return `appended (backup: config.toml.qantara.bak)`;
        },
      });
    }
  }

  // ---------- Gemini (merge into ~/.gemini/settings.json) ----------
  if (detected.gemini) {
    const settingsPath = join(home, ".gemini", "settings.json");
    const settings = existsSync(settingsPath)
      ? JSON.parse(readFileSync(settingsPath, "utf8"))
      : {};
    const servers = (settings.mcpServers ??= {});
    if (servers["agent-bridge"]) {
      warnings.push(
        'Gemini settings still have the old "agent-bridge" server — ' +
          `remove it from ${settingsPath}.`,
      );
    }
    if (servers[SERVER]) {
      console.log("  gemini: already registered — skipping");
    } else {
      const expose = exposeFor("gemini");
      actions.push({
        desc: `gemini: add mcpServers.${SERVER} to ${settingsPath} (BRIDGE_EXPOSE=${expose})`,
        apply: () => {
          if (existsSync(settingsPath)) backup(settingsPath);
          servers[SERVER] = {
            command: nodePath,
            args: [serverPath],
            env: { BRIDGE_EXPOSE: expose },
          };
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
          return "added (backup: settings.json.qantara.bak)";
        },
      });
    }
  }

  // ---------- Execute ----------
  if (actions.length === 0) {
    console.log("\nNothing to do — every detected host is already configured.");
  } else {
    console.log("\nPlan:");
    for (const a of actions) console.log(`  * ${a.desc}`);
    if (dryRun) {
      console.log("\nDry run — nothing written.");
    } else {
      console.log("");
      for (const a of actions) {
        try {
          console.log(`  ok: ${a.apply()}`);
        } catch (err) {
          console.error(`  FAILED: ${a.desc}\n    ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
      console.log(
        "\nDone. Restart each host (new MCP servers load at session start).",
      );
    }
  }
  for (const w of warnings) console.log(`\nWARNING: ${w}`);
}
