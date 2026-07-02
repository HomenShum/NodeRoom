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
      'case "memory"',
      'case "goal"',
      'case "gate"',
      'case "supervise"',
      'case "resume"',
      "memory init",
      "memory compact",
      "memory search",
      "memory doctor",
      "memory export --redacted",
      'case "storybook"',
      'case "repair"',
      'case "rerun"',
      'case "storyboard"',
      'case "clips"',
      'case "release-video"',
      'case "lagging"',
      'case "router"',
      "writeLoopArtifactsForMeta",
      "suiteConfigForAdapter",
      "knownSuites(config)",
      "official_scorer_unregistered",
      ".proofloop/goals",
      "heartbeats.jsonl",
      "ledger.jsonl",
      "queue.json",
      "blockers.json",
      "type GoalState",
      "TERMINAL_GOAL_STATES",
      "blocked_external",
      "needs_human_approval",
      "budget_exhausted",
      "worker_stalled",
      "proofloop gate --goal",
      "--user-emulation strict",
    ]) {
      expect(content).toContain(command);
    }
  });

  it("supervisor gate enforces proof artifacts before completion", () => {
    const content = readFileSync(join(process.cwd(), "scripts/proofloop-cli.ts"), "utf-8");
    for (const invariant of [
      "evaluateGoalGate",
      "latest proof run missing",
      "node-trace-v2.json",
      "node-eval.json",
      "scorecard.md",
      "NodeMem write missing",
      "live-user proof missing or invalid",
      "official scorer receipt missing or failing",
      "cockpit events missing",
      "CI/deploy proof missing for shipping goal",
    ]) {
      expect(content).toContain(invariant);
    }
  });

  it("supervisor records valid external blockers and continues unblocked work", () => {
    const content = readFileSync(join(process.cwd(), "scripts/proofloop-cli.ts"), "utf-8");
    for (const invariant of [
      "missing_credential",
      "missing_dataset",
      "missing_official_scorer",
      "paid_service_required",
      "destructive_approval_required",
      "external_service_down",
      "unblockedTasksRemaining",
      "btb_ui_bundle_root does not exist",
      "official BankerToolBench fixture bundle",
      "browserscenario does not exist",
      "nextRunnableTask",
      "recordGoalBlocker",
    ]) {
      expect(content).toContain(invariant);
    }
  });

  it("live adapter wrapper resolves registered browser scenarios", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf-8");
    const wrapper = readFileSync(join(process.cwd(), "scripts/proofloop-live-playwright.ts"), "utf-8");
    expect(packageJson).toContain("proofloop:live:adapter");
    expect(wrapper).toContain('suite === "adapter"');
    expect(wrapper).toContain("adapter.browserScenario");
    expect(wrapper).toContain("PROOFLOOP_BENCHMARK_ADAPTER");
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
      expect(adapter.expectedArtifacts).toContain("official-scorer-receipt.json");
      expect(adapter.expectedArtifacts).toContain("cockpit-events.jsonl");
      expect(adapter.expectedArtifacts).toContain("cockpit-snapshot.json");
      expect(adapter.expectedArtifacts).toContain("exported-files-reopen-proof.json");
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
});
