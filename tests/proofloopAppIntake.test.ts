import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProofloopThisRepoPlan,
  detectAppAdapters,
  writeProofloopThisRepoPlan,
} from "../src/eval/proofloopAppIntake";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Proof Loop app intake", () => {
  it("detects this repo as the NodeRoom reference app with a live browser proof command", () => {
    const report = buildProofloopThisRepoPlan({
      root: process.cwd(),
      goal: "Prove the primary agent workflow.",
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(report.schema).toBe("proofloop-this-repo-v1");
    expect(report.primaryAdapter).toBe("noderoom");
    expect(report.workflow.app.adapterId).toBe("noderoom");
    expect(report.workflow.proofGates).toContain("fresh_browser_context");
    expect(report.workflow.proofGates).toContain("verifier_receipt_written");
    expect(report.fastDeterministicGates).toContain("build_gate");
    expect(report.fastDeterministicGates).toContain("typecheck_gate");
    expect(report.liveBrowserProofCommand).toContain("proofloop -- run browser-live");
    expect(report.liveBrowserProofCommand).toContain("--user-emulation strict");
  });

  it("writes local intake and workflow specs for a generic Vite app", () => {
    const root = tempRoot();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "fixture-agent-app",
      scripts: { dev: "vite", build: "vite build", typecheck: "tsc --noEmit" },
      devDependencies: { vite: "^5.0.0" },
    }, null, 2));
    writeFileSync(join(root, "vite.config.ts"), "export default {};\n");

    const adapters = detectAppAdapters(root);
    expect(adapters[0].id).toBe("vite-app");

    const report = buildProofloopThisRepoPlan({ root, goal: "Run the fixture agent task." });
    const paths = writeProofloopThisRepoPlan(report, { root });

    expect(existsSync(paths.intakeReportPath)).toBe(true);
    expect(existsSync(paths.workflowSpecPath)).toBe(true);
    expect(JSON.parse(readFileSync(paths.intakeReportPath, "utf8")).primaryAdapter).toBe("vite-app");
    expect(JSON.parse(readFileSync(paths.workflowSpecPath, "utf8")).proofGates).toContain("node_trace_v2_written");
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-intake-"));
  tempRoots.push(root);
  return root;
}
