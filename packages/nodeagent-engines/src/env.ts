import { readFileSync, existsSync } from "node:fs";
import type { ProviderEnv } from "./contract.js";

/** Parse KEY=VALUE lines (dotenv subset). Values are never logged. */
export function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * The Claude Code binary appends `/v1/messages` itself, so a base URL that
 * already ends in `/v1` produces `/v1/v1/messages` -> 404, which the CLI reports
 * as "the selected model may not exist". Keep the origin (and any proxy path
 * prefix) but drop a trailing `/v1`.
 */
export function normalizeAnthropicBaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
    return `${url.origin}${path}`;
  } catch {
    return undefined;
  }
}

/** Process env wins over files, matching dotenv precedence. */
export function loadProviderEnv(files: string[], processEnv: NodeJS.ProcessEnv = process.env): ProviderEnv {
  const merged: Record<string, string | undefined> = {};
  for (const f of files) Object.assign(merged, parseEnvFile(f));
  for (const [k, v] of Object.entries(processEnv)) if (v !== undefined && v !== "") merged[k] = v;
  return {
    anthropicApiKey: merged.ANTHROPIC_API_KEY || undefined,
    anthropicBaseUrl: normalizeAnthropicBaseUrl(merged.ANTHROPIC_BASE_URL),
    openaiApiKey: merged.OPENAI_API_KEY || undefined,
    googleApiKey: merged.GOOGLE_GENERATIVE_AI_API_KEY || merged.GEMINI_API_KEY || merged.GOOGLE_API_KEY || undefined,
    openrouterApiKey: merged.OPENROUTER_API_KEY || undefined,
  };
}

/**
 * Minimal OS environment for engine subprocesses. Host-session variables
 * (CLAUDECODE, CLAUDE_CODE_*, ANTHROPIC_*, OPENAI_*, CODEX_*) are never
 * inherited: an engine gets exactly the credentials Node hands it.
 */
const OS_KEYS = [
  "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
  "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "LANG", "LC_ALL", "TERM", "SHELL", "USER", "USERNAME",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
];

export function cleanChildEnv(extra: Record<string, string | undefined>, processEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of OS_KEYS) {
    const v = processEnv[k];
    if (v) env[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  return env;
}
