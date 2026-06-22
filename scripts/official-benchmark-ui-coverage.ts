import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildOfficialBenchmarkUiCoverageReport,
  type OfficialBenchmarkUiCoverageReport,
} from "../src/eval/officialBenchmarkUiCoverage";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/official-benchmark-ui-coverage.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/OFFICIAL_BENCHMARK_UI_COVERAGE.md";
const strict = args.includes("--strict");

const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: new Date().toISOString() });

writeJson(jsonOut, report);
writeText(mdOut, renderMarkdown(report));
console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `official benchmark UI coverage: covered=${report.summary.coveredTracks}/${report.summary.tracks} ` +
  `requiredDeliverables=${report.summary.requiredDeliverableKinds.join(",")}`,
);

if (strict && !report.summary.liveBrowserFreshRoomReady) process.exitCode = 1;

function renderMarkdown(report: OfficialBenchmarkUiCoverageReport): string {
  const lines: string[] = [];
  lines.push("# Official Benchmark UI Coverage");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt ?? "unknown"}`);
  lines.push("");
  lines.push("This ledger answers the live-browser question directly: has NodeRoom driven official benchmark tasks through a fresh room, public @nodeagent chat, UI upload/export, downloaded artifacts, and scorer/verifier handoff?");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Tracks covered: ${report.summary.coveredTracks}/${report.summary.tracks}`);
  lines.push(`- Tracks partial: ${report.summary.partialTracks}/${report.summary.tracks}`);
  lines.push(`- Tracks missing: ${report.summary.missingTracks}/${report.summary.tracks}`);
  lines.push(`- Required deliverable kinds: ${report.summary.requiredDeliverableKinds.map((item) => `\`${item}\``).join(", ")}`);
  lines.push(`- Live browser fresh-room ready: ${report.summary.liveBrowserFreshRoomReady ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Policy");
  lines.push("");
  for (const item of report.policy) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Deliverable Types");
  lines.push("");
  lines.push("| Kind | Label | Extensions | Required For | Validation |");
  lines.push("|---|---|---|---|---|");
  for (const item of report.deliverableTypes) {
    lines.push(
      `| \`${item.kind}\` | ${item.label} | ${item.extensions.map((ext) => `\`${ext}\``).join(", ")} | ` +
      `${item.requiredFor.map((id) => `\`${id}\``).join(", ") || "optional"} | ${item.validation.join("; ")} |`,
    );
  }
  lines.push("");
  lines.push("## UI Gates");
  lines.push("");
  for (const gate of report.gates) lines.push(`- \`${gate.id}\`: ${gate.label}`);
  lines.push("");
  lines.push("## Tracks");
  lines.push("");
  lines.push("| Track | Status | Required Deliverables | Live-Browser Deliverables | Required Spec | Blockers |");
  lines.push("|---|---:|---|---|---|---|");
  for (const track of report.tracks) {
    lines.push(
      `| \`${track.id}\` | ${track.status} | ${track.requiredDeliverables.map((item) => `\`${item}\``).join(", ")} | ` +
      `${track.liveBrowserFreshRoomDeliverables.map((item) => `\`${item}\``).join(", ") || "none"} | ` +
      `\`${track.requiredSpec}\` | ${renderBlockers(track.blockers)} |`,
    );
  }
  lines.push("");
  for (const track of report.tracks) {
    lines.push(`### ${track.title}`);
    lines.push("");
    lines.push(`- Current evidence: ${track.currentEvidence.map((item) => `\`${item}\``).join(", ")}`);
    lines.push(`- Missing deliverables: ${track.missingDeliverables.map((item) => `\`${item}\``).join(", ") || "none"}`);
    lines.push("");
    lines.push("| Gate | Status | Evidence / blocker |");
    lines.push("|---|---:|---|");
    for (const gate of track.gates) {
      lines.push(`| \`${gate.id}\` | ${gate.status} | ${gate.evidence ? `\`${gate.evidence}\`` : gate.blocker ?? ""} |`);
    }
    lines.push("");
  }
  while (lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function renderBlockers(blockers: string[]): string {
  return blockers.map((blocker) => blocker.replace(/\.+$/g, "")).join("; ");
}

function writeText(path: string, content: string): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
