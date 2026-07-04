import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  auditDesignTokenDrift,
  auditNodeRoomDesignSystem,
  canonicalTokenFile,
  designSystemFiles,
  getNodeRoomDesignManifest,
  type DesignAuditResult,
  type DesignDriftInput,
  type DesignDriftResult,
} from "../src/design/designSystem";

const command = process.argv[2] ?? "help";
const json = process.argv.includes("--json");
/** Human-readable drift output is capped so the slop report stays scannable. */
const DRIFT_PRINT_CAP = 40;

if (command === "manifest") {
  write(getNodeRoomDesignManifest());
} else if (command === "audit") {
  const result = auditNodeRoomDesignSystem(readDesignFiles());
  const drift = auditDesignTokenDrift(readDriftInputs());
  if (json) {
    console.log(JSON.stringify({ ...result, drift }, null, 2));
  } else {
    write(result);
    printDrift(drift);
  }
  if (!result.ok) process.exitCode = 1;
} else {
  const help = [
    "NodeRoom design-system CLI",
    "",
    "Commands:",
    "  tsx scripts/design-system.ts manifest --json",
    "  tsx scripts/design-system.ts audit --json",
    "",
    "audit = hard gate (regressions fail) + token-drift slop detector (warnings only):",
    "  - hex colors outside the canonical token set (design-reference/assets/colors_and_type.css + styles.css :root tokens)",
    "  - font sizes off the 11/12/13/14/15/17/20/26/31/40px type scale",
    "  - border radii off the 4/6/8/10/12/16/9999px radius scale",
    "For paired design-vs-product screenshots run: npm run design:parity",
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

function readDriftInputs(): DesignDriftInput {
  const appCss = readFileSync(resolve("src/app/styles.css"), "utf8");
  const files: Record<string, string> = { "src/app/styles.css": appCss };
  for (const file of listFilesRecursive(resolve("src/ui"), ".tsx")) {
    files[relative(process.cwd(), file).replaceAll("\\", "/")] = readFileSync(file, "utf8");
  }
  const canonicalPath = resolve(canonicalTokenFile);
  const canonicalCss = existsSync(canonicalPath) ? readFileSync(canonicalPath, "utf8") : "";
  return { canonicalCss, appCss, files };
}

function listFilesRecursive(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(child, suffix));
    else if (entry.name.endsWith(suffix)) out.push(child);
  }
  return out;
}

function printDrift(drift: DesignDriftResult) {
  const { summary } = drift;
  console.log(
    `token-drift: ${summary.warnings} warnings (hex ${summary.hexDrift}, type-scale ${summary.typeScaleDrift}, radius ${summary.radiusScaleDrift}; allowed hexes ${summary.allowedHexes}) - guidance only, never fails the audit`
  );
  const overflow = drift.findings.length > DRIFT_PRINT_CAP - 1;
  const shown = drift.findings.slice(0, overflow ? DRIFT_PRINT_CAP - 2 : DRIFT_PRINT_CAP - 1);
  for (const item of shown) {
    const location = item.line ? `${item.file}:${item.line}` : item.file;
    console.log(`WARN ${item.code} ${location} - ${item.message}`);
  }
  const omitted = drift.findings.length - shown.length;
  if (omitted > 0) {
    console.log(`... ${omitted} more drift warnings - run "npm run design:audit -- --json" for the full list`);
  }
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
