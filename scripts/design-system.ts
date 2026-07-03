import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  auditNodeRoomDesignSystem,
  designSystemFiles,
  getNodeRoomDesignManifest,
  type DesignAuditResult,
} from "../src/design/designSystem";

const command = process.argv[2] ?? "help";
const json = process.argv.includes("--json");

if (command === "manifest") {
  write(getNodeRoomDesignManifest());
} else if (command === "audit") {
  const result = auditNodeRoomDesignSystem(readDesignFiles());
  write(result);
  if (!result.ok) process.exitCode = 1;
} else {
  const help = [
    "NodeRoom design-system CLI",
    "",
    "Commands:",
    "  tsx scripts/design-system.ts manifest --json",
    "  tsx scripts/design-system.ts audit --json",
    "",
    "This is Astryx-inspired: expose a compact manifest and audit checks so agents ground UI work in local conventions.",
  ].join("\n");
  console.log(help);
}

function readDesignFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of designSystemFiles) {
    files[file] = readFileSync(resolve(file), "utf8");
  }
  return files;
}

function write(payload: unknown) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (isAuditResult(payload)) {
    console.log(payload.ok ? "design-system audit: pass" : "design-system audit: fail");
    for (const item of payload.findings) {
      const location = item.line ? `${item.file}:${item.line}` : item.file;
      console.log(`${item.severity.toUpperCase()} ${item.code} ${location} - ${item.message}`);
    }
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

function isAuditResult(value: unknown): value is DesignAuditResult {
  return !!value && typeof value === "object" && "findings" in value && "summary" in value;
}
