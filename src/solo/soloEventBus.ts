import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SOLO_EVENTS_FILE, soloPath, type RalphMilestone } from "./ralphLoopLedger";

export const SOLO_EVENT_TYPES = [
  "session.start",
  "session.stop",
  "phase.start",
  "phase.stop",
  "prompt.submit",
  "tool.pre",
  "tool.post",
  "tool.error",
  "file.read.pre",
  "file.write.pre",
  "file.write.post",
  "command.run.pre",
  "command.run.post",
  "browser.proof.start",
  "browser.proof.stop",
  "receipt.write",
  "memory.write",
  "eval.start",
  "eval.stop",
  "rework.recorded",
] as const;

export type SoloEventType = (typeof SOLO_EVENT_TYPES)[number];

export const SOLO_AGENT_TARGETS = [
  "claude-code",
  "codex",
  "windsurf",
  "devin-desktop",
  "devin-cloud",
  "cursor",
  "trae",
  "opencode",
  "openclaw",
  "hermes",
  "pi-agent",
  "flue-ai",
  "generic",
] as const;

export type SoloAgentTarget = (typeof SOLO_AGENT_TARGETS)[number];

export type SoloAgentAdapterKind = "hook-native" | "api-session" | "cli-wrapper" | "native-event";
export type SoloClaimLevel = "full_lifecycle" | "api_audit" | "external_proof_only" | "native_trace";

export type SoloAgentAdapter = {
  target: SoloAgentTarget;
  label: string;
  nativeHooks: boolean | "verify";
  rulesOrSkills: boolean | "likely";
  mcp: boolean | "limited" | "likely";
  adapterKind: SoloAgentAdapterKind;
  claimLevel: SoloClaimLevel;
  notes: string;
};

export const SOLO_AGENT_ADAPTERS: SoloAgentAdapter[] = [
  { target: "claude-code", label: "Claude Code", nativeHooks: true, rulesOrSkills: true, mcp: true, adapterKind: "hook-native", claimLevel: "full_lifecycle", notes: "Map native lifecycle hooks into SoloEvent." },
  { target: "codex", label: "Codex", nativeHooks: true, rulesOrSkills: true, mcp: true, adapterKind: "hook-native", claimLevel: "full_lifecycle", notes: "Use repo/user hook config when available; receipts remain mandatory." },
  { target: "windsurf", label: "Windsurf / Cascade", nativeHooks: true, rulesOrSkills: true, mcp: true, adapterKind: "hook-native", claimLevel: "full_lifecycle", notes: "Map read/write/command/MCP hook surfaces into SoloEvent." },
  { target: "devin-desktop", label: "Devin Desktop", nativeHooks: true, rulesOrSkills: true, mcp: true, adapterKind: "hook-native", claimLevel: "full_lifecycle", notes: "Desktop hook surface plus receipt verification." },
  { target: "devin-cloud", label: "Devin Cloud", nativeHooks: false, rulesOrSkills: true, mcp: "limited", adapterKind: "api-session", claimLevel: "api_audit", notes: "Collect session, audit, playbook, and artifact receipts." },
  { target: "cursor", label: "Cursor", nativeHooks: "verify", rulesOrSkills: true, mcp: true, adapterKind: "cli-wrapper", claimLevel: "external_proof_only", notes: "Use rules/MCP where available; CLI proof wrapper is authoritative." },
  { target: "trae", label: "Trae IDE", nativeHooks: "verify", rulesOrSkills: "likely", mcp: "likely", adapterKind: "cli-wrapper", claimLevel: "external_proof_only", notes: "Treat as wrapped until native hook docs are verified." },
  { target: "opencode", label: "OpenCode", nativeHooks: "verify", rulesOrSkills: "likely", mcp: "likely", adapterKind: "cli-wrapper", claimLevel: "external_proof_only", notes: "Observe commands, files, tests, browser proof, and scorer receipts." },
  { target: "openclaw", label: "OpenClaw", nativeHooks: "verify", rulesOrSkills: true, mcp: "likely", adapterKind: "cli-wrapper", claimLevel: "external_proof_only", notes: "Use perimeter wrapper; never trust self-reported completion." },
  { target: "hermes", label: "Hermes", nativeHooks: "verify", rulesOrSkills: true, mcp: "likely", adapterKind: "cli-wrapper", claimLevel: "external_proof_only", notes: "Persistent-agent path needs strict memory and delayed-action receipts." },
  { target: "pi-agent", label: "Pi Agent Core", nativeHooks: true, rulesOrSkills: true, mcp: true, adapterKind: "native-event", claimLevel: "native_trace", notes: "Reference adapter: emit SoloEvent directly from the runtime." },
  { target: "flue-ai", label: "Flue AI", nativeHooks: true, rulesOrSkills: true, mcp: true, adapterKind: "native-event", claimLevel: "native_trace", notes: "Direct event emitter plus receipt writes." },
  { target: "generic", label: "Generic CLI", nativeHooks: false, rulesOrSkills: false, mcp: false, adapterKind: "cli-wrapper", claimLevel: "external_proof_only", notes: "No hooks: wrap process, collect external proof only." },
];

export type SoloBusEvent = {
  schema: 1;
  id: string;
  event: SoloEventType;
  agent: SoloAgentTarget;
  phase?: RalphMilestone;
  loopId?: string;
  status?: "ok" | "blocked" | "error" | "running";
  tool?: string;
  command?: string;
  path?: string;
  stdoutPath?: string;
  receiptPath?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type SoloEventValidation = {
  ok: boolean;
  errors: string[];
};

export function createSoloEvent(input: Omit<SoloBusEvent, "schema" | "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
}): SoloBusEvent {
  return {
    schema: 1,
    id: input.id ?? randomUUID(),
    event: input.event,
    agent: input.agent,
    phase: input.phase,
    loopId: input.loopId,
    status: input.status,
    tool: input.tool,
    command: input.command,
    path: input.path,
    stdoutPath: input.stdoutPath,
    receiptPath: input.receiptPath,
    createdAt: input.createdAt ?? new Date().toISOString(),
    payload: input.payload,
  };
}

export function validateSoloEvent(value: unknown): SoloEventValidation {
  const errors: string[] = [];
  const event = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<SoloBusEvent> : undefined;
  if (!event) return { ok: false, errors: ["event must be a JSON object"] };
  if (event.schema !== 1) errors.push("schema must be 1");
  if (!event.id) errors.push("id is required");
  if (!event.event || !(SOLO_EVENT_TYPES as readonly string[]).includes(event.event)) errors.push(`unknown event: ${String(event.event)}`);
  if (!event.agent || !(SOLO_AGENT_TARGETS as readonly string[]).includes(event.agent)) errors.push(`unknown agent: ${String(event.agent)}`);
  if (!event.createdAt || Number.isNaN(Date.parse(event.createdAt))) errors.push("createdAt must be an ISO timestamp");
  return { ok: errors.length === 0, errors };
}

export async function appendSoloBusEvent(projectRoot: string, event: SoloBusEvent): Promise<void> {
  const validation = validateSoloEvent(event);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  const path = soloPath(projectRoot, SOLO_EVENTS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

export function readSoloBusEvents(projectRoot: string): SoloBusEvent[] {
  const path = soloPath(projectRoot, SOLO_EVENTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/g)
    .filter((line) => line.trim().length > 0)
    .map((line) => normalizeEvent(JSON.parse(line)))
    .filter((event): event is SoloBusEvent => event !== null);
}

export function renderAgentMatrix(adapters: SoloAgentAdapter[] = SOLO_AGENT_ADAPTERS): string {
  const rows = adapters.map((adapter) => [
    adapter.label,
    String(adapter.nativeHooks),
    String(adapter.rulesOrSkills),
    String(adapter.mcp),
    adapter.adapterKind,
    adapter.claimLevel,
  ]);
  return renderTable(["Agent", "Hooks", "Rules", "MCP", "Adapter", "Claim"], rows);
}

export function installSoloHookTemplates(projectRoot: string, target: SoloAgentTarget): string[] {
  const written: string[] = [];
  const write = (relativePath: string, content: string) => {
    const absolute = join(projectRoot, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
    written.push(relativePath);
  };
  write(".solo/bin/record-event", recordEventScript());
  if (target === "codex" || target === "generic") {
    write(".codex/hooks.json", JSON.stringify({
      hooks: [
        { event: "SessionStart", command: ".solo/bin/record-event --event session.start --agent codex" },
        { event: "UserPromptSubmit", command: ".solo/bin/record-event --event prompt.submit --agent codex" },
        { event: "PostToolUse", command: ".solo/bin/record-event --event tool.post --agent codex" },
        { event: "Stop", command: ".solo/bin/record-event --event session.stop --agent codex" },
      ],
    }, null, 2) + "\n");
  }
  if (target === "claude-code" || target === "generic") {
    write(".claude/settings.json", JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: ".solo/bin/record-event --event session.start --agent claude-code" }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: ".solo/bin/record-event --event prompt.submit --agent claude-code" }] }],
        PostToolUse: [{ hooks: [{ type: "command", command: ".solo/bin/record-event --event tool.post --agent claude-code" }] }],
        Stop: [{ hooks: [{ type: "command", command: ".solo/bin/record-event --event session.stop --agent claude-code" }] }],
      },
    }, null, 2) + "\n");
  }
  if (target === "windsurf" || target === "devin-desktop" || target === "generic") {
    write(".windsurf/hooks.json", JSON.stringify({
      hooks: [
        { event: "pre_run_command", command: ".solo/bin/record-event --event command.run.pre --agent windsurf" },
        { event: "post_run_command", command: ".solo/bin/record-event --event command.run.post --agent windsurf" },
        { event: "post_write_code", command: ".solo/bin/record-event --event file.write.post --agent windsurf" },
      ],
    }, null, 2) + "\n");
  }
  if (target === "devin-cloud" || target === "generic") {
    write(".devin/rules/solo-founder-loop.md", [
      "# Solo Founder Loop",
      "",
      "Report API session, playbook, audit, PR, and artifact receipts to `.solo/events.jsonl`.",
      "Natural-language completion is not a product claim; `proof-verdict.json` is required.",
      "",
    ].join("\n"));
  }
  return written;
}

function recordEventScript(): string {
  return [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };",
    "const event = { schema: 1, id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, event: opt('--event', 'tool.post'), agent: opt('--agent', 'generic'), phase: opt('--phase', undefined), status: opt('--status', 'ok'), createdAt: new Date().toISOString() };",
    "const file = path.join(process.cwd(), '.solo', 'events.jsonl');",
    "fs.mkdirSync(path.dirname(file), { recursive: true });",
    "fs.appendFileSync(file, JSON.stringify(event) + '\\n');",
    "",
  ].join("\n");
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const renderRow = (row: string[]) => `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  const divider = `|-${widths.map((width) => "-".repeat(width)).join("-|-")}-|`;
  return [renderRow(headers), divider, ...rows.map(renderRow)].join("\n");
}

function normalizeEvent(value: unknown): SoloBusEvent | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!record) return null;
  if (typeof record.event === "string") return record as SoloBusEvent;
  if (typeof record.kind === "string") {
    const event = createSoloEvent({
      id: typeof record.id === "string" ? record.id : undefined,
      event: mapLegacyKind(record.kind),
      agent: "generic",
      phase: typeof record.milestone === "string" ? record.milestone as RalphMilestone : undefined,
      loopId: typeof record.loopId === "string" ? record.loopId : undefined,
      status: "ok",
      createdAt: typeof record.at === "string" ? record.at : undefined,
      payload: { legacy: record },
    });
    return event;
  }
  return null;
}

function mapLegacyKind(kind: string): SoloEventType {
  if (kind === "loop.init") return "session.start";
  if (kind === "loop.start") return "phase.start";
  if (kind === "loop.verify") return "eval.stop";
  if (kind === "loop.blocked") return "tool.error";
  if (kind === "receipt") return "receipt.write";
  if (kind === "command") return "command.run.post";
  return "prompt.submit";
}
