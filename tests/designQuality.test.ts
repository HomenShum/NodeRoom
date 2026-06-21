import { describe, expect, it } from "vitest";
import { buildDesignQualityRun, designPerformanceChecks, designPerformancePasses, type DesignQualityRunInput } from "../src/eval/designQuality";
import { validateBrowserEvidence, type BrowserEvidence } from "../src/eval/designQualityBrowserEvidence";

function baseInput(overrides: Partial<DesignQualityRunInput> = {}): DesignQualityRunInput {
  return {
    runId: "dq-test",
    commitSha: "abc123",
    appUrl: "local",
    createdAt: "2026-06-21T00:00:00.000Z",
    scenario: "live_room_collab",
    artifacts: {
      videoPath: "docs/eval/live-browser-proofs/live-convex-broad-proof-20260620.webm",
      screenshots: [],
      domSnapshots: [],
      convexRunIds: [],
    },
    functionalGate: {
      status: "passed",
      tests: [
        { name: "npm run prod:gate", status: "passed" },
        { name: "npm run test:product:live", status: "passed" },
      ],
    },
    performance: {
      status: "passed",
      longTasks: 0,
      maxInteractionLatencyMs: 240,
      timeToOptimisticBubbleMs: 40,
      timeToEvidencePreviewMs: 250,
      cls: 0.01,
    },
    accessibility: {
      status: "passed",
      axeViolations: 0,
      keyboardPathPassed: true,
      reducedMotionPassed: true,
      screenReaderNotes: [],
    },
    mediaJudge: {
      model: "gemini-3.5-flash",
      total: 10.6,
      max: 16,
      dimensions: {
        featureClarity: 1.4,
        workflowCompleteness: 1.3,
        visualDesign: 1.2,
        consistency: 1.4,
        evidenceQuality: 1.5,
        legibility: 1.1,
        professionalRelevance: 1.4,
        productionHonesty: 1.3,
      },
      defects: [
        { severity: "P2", title: "Trace log text is small." },
        { severity: "P2", title: "Landing transition is too rapid." },
      ],
    },
    referenceComparisons: [
      {
        referenceApp: "Google Sheets",
        borrowedConvention: "Cell-level presence",
        nodeRoomScreen: "spreadsheet",
        score: 1.5,
        note: "Presence is advisory; CAS owns writes.",
      },
      {
        referenceApp: "Figma",
        borrowedConvention: "Object-level multiplayer",
        nodeRoomScreen: "artifact",
        score: 1.4,
        note: "Intent claims are scoped and non-blocking.",
      },
    ],
    viralitySignals: {
      roomInviteVisible: true,
      shareActionVisible: true,
      downstreamHandoffVisible: true,
      notificationDeepLinkVisible: false,
    },
    ...overrides,
  };
}

describe("design quality scorecard", () => {
  it("keeps product correctness pass/fail separate from the media score", () => {
    const run = buildDesignQualityRun(baseInput());

    expect(run.productCorrectnessScore).toBe("pass_fail_only");
    expect(run.mediaJudge?.total).toBe(10.6);
    expect(run.uiUxScore.total).toBeGreaterThan(10.6);
    expect(run.uiUxScore.max).toBe(100);
    expect(run.verdict).toBe("ship_but_media_needs_polish");
  });

  it("does not ship when functional gates were not run in the current design pass", () => {
    const run = buildDesignQualityRun(baseInput({
      functionalGate: {
        status: "not_run",
        tests: [{ name: "npm run prod:gate", status: "not_run" }],
      },
    }));

    expect(run.verdict).toBe("needs_functional_gate");
    expect(run.blockers).toContain("functional gate not run in this design-quality pass");
  });

  it("turns P0/P1 media defects into design blockers after functional gates pass", () => {
    const run = buildDesignQualityRun(baseInput({
      mediaJudge: {
        ...baseInput().mediaJudge!,
        defects: [{ severity: "P1", title: "Critical text is unreadable." }],
      },
    }));

    expect(run.verdict).toBe("design_blocker");
    expect(run.blockers[0]).toContain("P1 media/design defect");
  });

  it("treats accessibility failure as its own blocker, not as a Gemini/media problem", () => {
    const run = buildDesignQualityRun(baseInput({
      accessibility: {
        status: "failed",
        axeViolations: 3,
        keyboardPathPassed: false,
        reducedMotionPassed: true,
        screenReaderNotes: ["Agent stream is too noisy."],
      },
    }));

    expect(run.verdict).toBe("accessibility_blocker");
  });

  it("credits deterministic browser accessibility checks without pretending axe ran", () => {
    const run = buildDesignQualityRun(baseInput({
      accessibility: {
        status: "passed",
        deterministicViolations: 0,
        keyboardPathPassed: true,
        reducedMotionPassed: true,
        screenReaderNotes: [],
      },
    }));

    expect(run.uiUxScore.dimensions.accessibility).toBe(8);
    expect(run.accessibility.axeViolations).toBeUndefined();
  });

  it("blocks shipping when browser performance evidence fails", () => {
    const run = buildDesignQualityRun(baseInput({
      performance: {
        status: "failed",
        longTasks: 1,
        maxInteractionLatencyMs: 350,
        timeToOptimisticBubbleMs: 90,
        timeToEvidencePreviewMs: 220,
        cls: 0,
      },
    }));

    expect(run.blockers).toContain("performance gate failed");
    expect(run.verdict).toBe("design_blocker");
    expect(run.uiUxScore.dimensions.responsivenessInteraction).toBe(0);
  });

  it("uses one shared performance budget for pass/fail and scoring", () => {
    const performance = baseInput().performance;

    expect(designPerformanceChecks(performance)).toEqual({
      maxInteractionLatencyMs: true,
      timeToOptimisticBubbleMs: true,
      timeToEvidencePreviewMs: true,
      longTasks: true,
      cls: true,
    });
    expect(designPerformancePasses(performance)).toBe(true);
    expect(designPerformancePasses({ ...performance, timeToOptimisticBubbleMs: 101 })).toBe(false);
  });

  it("rejects stale browser evidence when the runtime source tree changed", () => {
    const evidence = browserEvidence({ sourceTreeHash: "old-tree" });

    expect(validateBrowserEvidence(evidence, {
      currentSourceTreeHash: "new-tree",
      requestedAppUrl: "local",
      nowMs: Date.parse("2026-06-21T00:30:00.000Z"),
    })).toEqual({ valid: false, reason: "source_tree_hash_mismatch" });
  });

  it("accepts current local browser evidence across dynamic preview ports", () => {
    const evidence = browserEvidence({ appUrl: "http://127.0.0.1:5317" });

    expect(validateBrowserEvidence(evidence, {
      currentSourceTreeHash: "tree",
      requestedAppUrl: "local",
      nowMs: Date.parse("2026-06-21T00:30:00.000Z"),
    }).valid).toBe(true);
  });

  it("rejects old or wrong-target browser evidence", () => {
    const old = validateBrowserEvidence(browserEvidence(), {
      currentSourceTreeHash: "tree",
      requestedAppUrl: "local",
      nowMs: Date.parse("2026-06-21T04:30:00.000Z"),
    });
    const wrongTarget = validateBrowserEvidence(browserEvidence({ appUrl: "https://old.example.test" }), {
      currentSourceTreeHash: "tree",
      requestedAppUrl: "https://new.example.test",
      nowMs: Date.parse("2026-06-21T00:30:00.000Z"),
    });

    expect(old.reason).toBe("too_old");
    expect(wrongTarget).toEqual({ valid: false, reason: "app_url_mismatch" });
  });
});

function browserEvidence(overrides: Partial<BrowserEvidence> = {}): BrowserEvidence {
  return {
    schema: 1,
    runId: "browser-test",
    commitSha: "abc123+dirty",
    sourceTreeHash: "tree",
    generatedAt: "2026-06-21T00:00:00.000Z",
    appUrl: "http://127.0.0.1:5317",
    serverMode: "preview",
    capture: {
      status: "passed",
      screenshots: ["docs/eval/design-quality/browser/browser-test/desktop.png"],
      domSnapshots: ["docs/eval/design-quality/browser/browser-test/desktop.dom.json"],
      viewports: [],
      findings: [],
    },
    performance: baseInput().performance,
    accessibility: baseInput().accessibility,
    ...overrides,
  };
}
