import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ─── Proof-Loop Runner Tests ──────────────────────────────────────────────

describe("proofloop runner", () => {
  it("runner script exists", () => {
    expect(existsSync(join(process.cwd(), "scripts/proofloop-runner.ts"))).toBe(true);
  });

  it("runner exports ProofLoopConfig type with required fields", () => {
    // The runner is a CLI script — verify it can be parsed
    const content = readFileSync(join(process.cwd(), "scripts/proofloop-runner.ts"), "utf-8");
    expect(content).toContain("ProofLoopConfig");
    expect(content).toContain("ProofLoopStepConfig");
    expect(content).toContain("ProofLoopRunResult");
    expect(content).toContain("minScore");
    expect(content).toContain("steps");
  });

  it("runner implements score calculation and pass/fail logic", () => {
    const content = readFileSync(join(process.cwd(), "scripts/proofloop-runner.ts"), "utf-8");
    expect(content).toContain("requiredPassed");
    expect(content).toContain("failReasons");
    expect(content).toContain("score < config.minScore");
  });

  it("runner writes scorecard, trace, and memory", () => {
    const content = readFileSync(join(process.cwd(), "scripts/proofloop-runner.ts"), "utf-8");
    const artifactWriter = readFileSync(join(process.cwd(), "src/eval/proofloopArtifacts.ts"), "utf-8");
    expect(content).toContain("scorecard.md");
    expect(content).toContain("trace.jsonl");
    expect(content).toContain("rl-trace.json");
    expect(content).toContain("writeProofLoopArtifacts");
    expect(artifactWriter).toContain("node-trace-v2.json");
    expect(artifactWriter).toContain("node-eval.json");
    expect(artifactWriter).toContain("repair-prompt.md");
    expect(artifactWriter).toContain("trace-storybook.html");
    expect(content).toContain("memory.jsonl");
  });
});

// ─── Accounting Proof-Loop Tests ──────────────────────────────────────────

describe("accounting proof-loop", () => {
  it("config exists and is valid JSON", () => {
    const path = join(process.cwd(), "proofloop/accounting/proofloop.accounting.config.json");
    expect(existsSync(path)).toBe(true);
    const config = JSON.parse(readFileSync(path, "utf-8"));
    expect(config.suite).toBe("accounting");
    expect(config.minScore).toBeGreaterThanOrEqual(80);
    expect(config.steps.length).toBeGreaterThan(0);
  });

  it("config has required steps", () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "proofloop/accounting/proofloop.accounting.config.json"), "utf-8"),
    );
    const stepNames = config.steps.map((s: { name: string }) => s.name);
    expect(stepNames).toContain("build");
    expect(stepNames).toContain("agent-ui-contract");
    expect(stepNames).toContain("fr-a1-bank-reconciliation-packet");
    expect(stepNames).toContain("accounting-benchmark-checks");
    expect(stepNames).toContain("visual-design-review");
    expect(stepNames).toContain("noderl-export");
  });

  it("scenario YAMLs exist", () => {
    const scenarios = [
      "invoice-extraction.yaml",
      "spreadsheet-reconciliation.yaml",
      "financial-statement-qa.yaml",
      "variance-analysis.yaml",
    ];
    for (const scenario of scenarios) {
      expect(existsSync(join(process.cwd(), "proofloop/accounting/scenarios", scenario))).toBe(true);
    }
  });

  it("rubric exists", () => {
    expect(existsSync(join(process.cwd(), "proofloop/accounting/rubrics/accounting-rubric.yaml"))).toBe(true);
  });

  it("benchmark registry has pinned benchmarks", () => {
    const registry = JSON.parse(
      readFileSync(join(process.cwd(), "proofloop/accounting/benchmarks/benchmark-registry.json"), "utf-8"),
    );
    expect(registry.benchmarks.length).toBeGreaterThanOrEqual(5);
    expect(registry.benchmarks.every((b: { pinned: boolean }) => b.pinned)).toBe(true);
    const names = registry.benchmarks.map((b: { name: string }) => b.name);
    expect(names).toContain("Finch");
    expect(names).toContain("BizFinBench");
    expect(names).toContain("FATURA");
  });

  it("seed script exists", () => {
    expect(existsSync(join(process.cwd(), "proofloop/accounting/seed-datasets.ts"))).toBe(true);
  });

  it("benchmark runner exists", () => {
    expect(existsSync(join(process.cwd(), "proofloop/accounting/run-benchmarks.ts"))).toBe(true);
  });

  it("benchmark runner scores derived output artifacts, not just fixture shape", () => {
    const content = readFileSync(join(process.cwd(), "proofloop/accounting/run-benchmarks.ts"), "utf-8");
    expect(content).toContain("PROOFLOOP_OUTPUT_DIR");
    expect(content).toContain("requiredRunReceipts");
    expect(content).toContain("validateFrA1Receipt");
    expect(content).toContain("fr-a1-bank-reconciliation.json");
    expect(content).toContain("invoice-extraction.output.json");
    expect(content).toContain("spreadsheet-reconciliation.output.json");
    expect(content).toContain("discrepancyCount === data.expectedDiscrepancies");
    expect(content).toContain("accounting-report-generation.output.json");
  });

  it("Playwright specs exist", () => {
    expect(existsSync(join(process.cwd(), "proofloop/accounting/scenarios/accounting-ui-contract.spec.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "proofloop/accounting/scenarios/noderoom-accounting.spec.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "proofloop/accounting/scenarios/nodebench-accounting-report.spec.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "proofloop/accounting/scenarios/fr-a1-bank-reconciliation.spec.ts"))).toBe(true);
  });
});

// ─── Notion SDR/BDR Proof-Loop Tests ──────────────────────────────────────

describe("notion SDR/BDR proof-loop", () => {
  it("config exists and is valid JSON", () => {
    const path = join(process.cwd(), "proofloop/notion/proofloop.notion.config.json");
    expect(existsSync(path)).toBe(true);
    const config = JSON.parse(readFileSync(path, "utf-8"));
    expect(config.suite).toBe("notion-sdr-bdr");
    expect(config.minScore).toBeGreaterThanOrEqual(70);
    expect(config.steps.length).toBeGreaterThan(0);
  });

  it("config has 4 scenario steps", () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "proofloop/notion/proofloop.notion.config.json"), "utf-8"),
    );
    const scenarioSteps = config.steps.filter((s: { name: string }) => s.name.startsWith("scenario-"));
    expect(scenarioSteps.length).toBe(4);
  });

  it("config includes clip generation (soft fail)", () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "proofloop/notion/proofloop.notion.config.json"), "utf-8"),
    );
    const clipStep = config.steps.find((s: { name: string }) => s.name === "generate-clips");
    expect(clipStep).toBeDefined();
    expect(clipStep.softFail).toBe(true);
  });

  it("scenario YAMLs exist for all 4 scenarios", () => {
    const scenarios = ["01-warm-intro.yaml", "02-follow-up.yaml", "03-automated-pipeline.yaml", "04-meeting-prep.yaml"];
    for (const scenario of scenarios) {
      expect(existsSync(join(process.cwd(), "proofloop/notion/scenarios", scenario))).toBe(true);
    }
  });

  it("data files exist", () => {
    expect(existsSync(join(process.cwd(), "proofloop/notion/data/leads.json"))).toBe(true);
    expect(existsSync(join(process.cwd(), "proofloop/notion/data/discovery-call-notes.json"))).toBe(true);
    expect(existsSync(join(process.cwd(), "proofloop/notion/data/pipeline.json"))).toBe(true);
    expect(existsSync(join(process.cwd(), "proofloop/notion/data/meetings.json"))).toBe(true);
  });

  it("leads data has 5 entries", () => {
    const leads = JSON.parse(readFileSync(join(process.cwd(), "proofloop/notion/data/leads.json"), "utf-8"));
    expect(leads.length).toBe(5);
  });

  it("pipeline data has stale and trigger prospects", () => {
    const pipeline = JSON.parse(readFileSync(join(process.cwd(), "proofloop/notion/data/pipeline.json"), "utf-8"));
    const stale = pipeline.filter((p: { daysStale: number }) => p.daysStale > 10);
    expect(stale.length).toBeGreaterThan(0);
    const triggers = pipeline.filter((p: { trigger: string | null }) => p.trigger !== null);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it("rubric exists", () => {
    expect(existsSync(join(process.cwd(), "proofloop/notion/rubrics/sales-agent-rubric.yaml"))).toBe(true);
  });

  it("Playwright specs exist for all 4 scenarios", () => {
    const specs = ["01-warm-intro.spec.ts", "02-follow-up.spec.ts", "03-automated-pipeline.spec.ts", "04-meeting-prep.spec.ts"];
    for (const spec of specs) {
      expect(existsSync(join(process.cwd(), "proofloop/notion/scenarios", spec))).toBe(true);
    }
  });
});

// ─── Adapter Tests ────────────────────────────────────────────────────────

describe("proofloop adapters", () => {
  it("CLI implements loop engineering commands", () => {
    const content = readFileSync(join(process.cwd(), "scripts/proofloop-cli.ts"), "utf-8");
    for (const command of [
      'case "eval"',
      'case "mem"',
      'case "storybook"',
      'case "repair"',
      'case "codex"',
      'case "agents"',
      'case "rerun"',
      'case "storyboard"',
      'case "clips"',
      'case "release-video"',
      'case "lagging"',
      'case "router"',
      'case "solve-blockers"',
      'case "blocker"',
      'case "compare-models"',
      'case "promote-harness"',
      'case "charts"',
      "writeLoopArtifactsForMeta",
      "writeCodexRelaunchPacket",
      "setupProofloopAgentAdapter",
      "launchProofloopAgentAdapter",
      "--closed-loop",
      "proofloopModelRouteForRun",
      "solveProofloopBlocker",
      "writeProofloopChartPack",
      "writeChartsAfterCommand",
      "chart-pack.html",
      "--user-emulation strict",
      "stale_receipt",
      "fileIsFresh",
      "bankertoolbench-live-room-proof.json",
    ]) {
      expect(content).toContain(command);
    }
  });

  it("strict live-user benchmark adapters exist", () => {
    for (const adapterId of ["bankertoolbench", "finch", "finauditing", "workstreambench"]) {
      const path = join(process.cwd(), "proofloop", "benchmarks", adapterId, "adapter.json");
      expect(existsSync(path)).toBe(true);
      const adapter = JSON.parse(readFileSync(path, "utf-8"));
      expect(adapter.seedInputsThroughUi).toBe(true);
      expect(adapter.liveUserCommand).toContain("--prod");
      expect(adapter.liveUserCommand).toContain("--user-emulation strict");
      expect(adapter.expectedArtifacts).toContain("live-user-contract.json");
      expect(adapter.scoreFields).toContain("productPathCompletion");
      expect(adapter.scoreFields).toContain("officialSemanticScore");
    }
  });

  it("visual-judge adapter exists", () => {
    expect(existsSync(join(process.cwd(), "proofloop/adapters/visual-judge.ts"))).toBe(true);
    const content = readFileSync(join(process.cwd(), "proofloop/adapters/visual-judge.ts"), "utf-8");
    expect(content).toContain("chromium");
    expect(content).toContain("color-contrast");
    expect(content).toContain("mobile-viewport");
  });

  it("export-rl-trace adapter exists", () => {
    expect(existsSync(join(process.cwd(), "proofloop/adapters/export-rl-trace.ts"))).toBe(true);
    const content = readFileSync(join(process.cwd(), "proofloop/adapters/export-rl-trace.ts"), "utf-8");
    expect(content).toContain("rl-trace.json");
    expect(content).toContain("totalReward");
  });

  it("generate-clips adapter exists", () => {
    expect(existsSync(join(process.cwd(), "proofloop/adapters/generate-clips.ts"))).toBe(true);
    const content = readFileSync(join(process.cwd(), "proofloop/adapters/generate-clips.ts"), "utf-8");
    expect(content).toContain("chromium");
    expect(content).toContain("clip-manifest");
    expect(content).toContain("storyboard");
  });
});

// ─── CI Workflow Tests ────────────────────────────────────────────────────

describe("proofloop CI workflow", () => {
  it("workflow file exists", () => {
    expect(existsSync(join(process.cwd(), ".github/workflows/proofloop-suites.yml"))).toBe(true);
  });

  it("workflow has accounting and notion jobs", () => {
    const content = readFileSync(join(process.cwd(), ".github/workflows/proofloop-suites.yml"), "utf-8");
    expect(content).toContain("accounting");
    expect(content).toContain("notion-sdr-bdr");
    expect(content).toContain("npm run proofloop:accounting");
    expect(content).toContain("npm run proofloop:notion");
  });

  it("workflow uploads artifacts", () => {
    const content = readFileSync(join(process.cwd(), ".github/workflows/proofloop-suites.yml"), "utf-8");
    expect(content).toContain("upload-artifact");
  });
});

// ─── npm script Tests ─────────────────────────────────────────────────────

describe("proofloop npm scripts", () => {
  it("package.json has proofloop scripts", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    expect(pkg.scripts["proofloop:accounting"]).toBeDefined();
    expect(pkg.scripts["proofloop:notion"]).toBeDefined();
    expect(pkg.scripts["proofloop:proximitty"]).toBeDefined();
    expect(pkg.scripts["proofloop:proximitty:models"]).toBeDefined();
    expect(pkg.scripts["proofloop:proximitty:clips"]).toBeDefined();
    expect(pkg.scripts["proofloop:live:browser"]).toContain("proofloop-live-playwright.ts browser");
    expect(pkg.scripts["proofloop:live:btb"]).toContain("proofloop-live-playwright.ts bankertoolbench");
    expect(pkg.scripts["benchmark:proofloop:board"]).toBeDefined();
    expect(pkg.scripts["benchmark:proofloop:charts"]).toBeDefined();
    expect(pkg.scripts["benchmark:proofloop:npx-package"]).toContain("proofloop-npx-package-proof.ts");
    expect(pkg.scripts["benchmark:proofloop:preprod"]).toContain("proofloop-preprod-readiness.ts");
    expect(pkg.scripts["benchmark:proofloop:preprod:live"]).toContain("https://noderoom.live");
    expect(pkg.scripts["benchmark:proofloop:preprod:live"]).toContain("--live-story");
    expect(pkg.scripts["proofloop:accounting:seed"]).toBeDefined();
    expect(pkg.scripts["proofloop:notion:seed"]).toBeDefined();
  });

  it("proofloop:accounting script references accounting config", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    expect(pkg.scripts["proofloop:accounting"]).toContain("proofloop.accounting.config.json");
  });

  it("proofloop:notion script references notion config", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    expect(pkg.scripts["proofloop:notion"]).toContain("proofloop.notion.config.json");
  });

  it("Proximitty underwriting suite exists with required artifacts and adapters", () => {
    const configPath = join(process.cwd(), "proofloop/suites/proximitty-underwriting-pr0.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.suite).toBe("proximitty-underwriting-pr0");
    expect(config.minScore).toBeGreaterThanOrEqual(85);
    const stepNames = config.steps.map((step: { name: string }) => step.name);
    expect(stepNames).toContain("scenario-1-underwriting-intake");
    expect(stepNames).toContain("scenario-2-risk-research-evidence");
    expect(stepNames).toContain("scenario-3-underwriting-packet");
    expect(stepNames).toContain("scenario-4-model-policy-comparison");
    expect(stepNames).toContain("model-delta-and-verifier");

    for (const path of [
      "proofloop/datasets/proximitty-demo-underwriting/company-profile.json",
      "proofloop/datasets/proximitty-demo-underwriting/underwriting-policy.md",
      "proofloop/datasets/proximitty-demo-underwriting/synthetic-financials.csv",
      "proofloop/datasets/proximitty-demo-underwriting/risk-notes.md",
      "proofloop/datasets/proximitty-demo-underwriting/source-pack.md",
      "proofloop/rubrics/underwriting-rubric.yaml",
      "proofloop/rubrics/evidence-rubric.yaml",
      "proofloop/rubrics/visual-design-rubric.yaml",
      "proofloop/rubrics/live-user-contract.yaml",
      "proofloop/adapters/node-trace-v2-export.mjs",
      "proofloop/adapters/node-eval.mjs",
      "proofloop/adapters/nodemem-write.mjs",
      "proofloop/adapters/model-delta.mjs",
      "proofloop/adapters/generate-clips.mjs",
      "proofloop/cockpit/server.mjs",
      "scripts/proofloop.mjs",
      "scripts/proofloop-memory.mjs",
      ".github/workflows/proofloop.yml",
    ]) {
      expect(existsSync(join(process.cwd(), path))).toBe(true);
    }

    const clipAdapter = readFileSync(join(process.cwd(), "proofloop/adapters/generate-clips.mjs"), "utf-8");
    expect(clipAdapter).toContain("videos");
    expect(clipAdapter).toContain("final-proximitty-demo.mp4");

    const memoryCli = readFileSync(join(process.cwd(), "scripts/proofloop-memory.mjs"), "utf-8");
    expect(memoryCli).toContain("index.db");
    expect(memoryCli).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5");
    expect(memoryCli).toContain("cloudSync: false");
    expect(memoryCli).toContain("storeScreenshots: \"path-only\"");

    const wrapper = readFileSync(join(process.cwd(), "scripts/proofloop.mjs"), "utf-8");
    expect(wrapper).toContain("proofloop-memory.mjs");
    expect(wrapper).toContain(".proofloop\", \"memory\", \"index.db\"");

    const liveLauncher = readFileSync(join(process.cwd(), "scripts/proofloop-live-playwright.ts"), "utf-8");
    expect(liveLauncher).toContain("BTB_UI_VERIFIER_COMMAND");
    expect(liveLauncher).toContain("benchmark:bankertoolbench:proof");
  });
});
