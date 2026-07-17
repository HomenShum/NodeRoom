import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { auditUiLayerImports, type UiLayerAuditScope } from "../src/design/uiLayerPolicy";

const root = resolve(import.meta.dirname, "..");
const scope = parseScope(process.argv.slice(2));
const files = readSourceFiles(resolve(root, "src"));
const result = auditUiLayerImports(files, scope);
const json = process.argv.includes("--json");

if (json) {
  console.log(JSON.stringify({ scope, ...result }, null, 2));
} else if (result.ok) {
  console.log(`ui-layer audit: pass (${scope}, ${result.checkedFiles} source files)`);
} else {
  console.error(`ui-layer audit: fail (${result.findings.length} finding(s))`);
  for (const finding of result.findings) {
    console.error(`- ${finding.file}: ${finding.packageName} - ${finding.reason}`);
  }
}

if (!result.ok) process.exitCode = 1;

function readSourceFiles(directory: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) Object.assign(output, readSourceFiles(path));
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) output[relative(root, path).replaceAll("\\", "/")] = readFileSync(path, "utf8");
  }
  return output;
}

function parseScope(args: string[]): UiLayerAuditScope {
  const value = args.find((arg) => arg.startsWith("--scope="))?.split("=")[1];
  if (value === "primitives" || value === "motion") return value;
  return "all";
}
