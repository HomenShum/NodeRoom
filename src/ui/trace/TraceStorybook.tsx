import { LoopRewardPanel, type UiProofloopReward } from "./LoopRewardPanel";

export type TraceStorybookTrace = {
  runId: string;
  userGoal: string;
  outerTrace: {
    url: string;
    screenshots: Array<{ label?: string; path: string }>;
    uiAssertions: Array<{ id: string; expected: string; observed: string; passed: boolean }>;
  };
  innerTrace: {
    steps: Array<{ action: string; observation: string; toolName: string; costUsd: number; latencyMs: number; error?: string }>;
  };
  artifacts: Array<{ artifactId: string; exportPath: string; reopenPassed: boolean }>;
  reward: UiProofloopReward;
};

export type TraceStorybookEval = {
  verifier: { hardPass: boolean; score: number; minScore: number; failReasons: string[] };
  judge: { diagnosticSummary: string; evidencePaths: string[] };
  reward: UiProofloopReward & { failureCategories?: string[] };
};

export type TraceStorybookProps = {
  trace: TraceStorybookTrace;
  evalResult: TraceStorybookEval;
};

export function TraceStorybook({ trace, evalResult }: TraceStorybookProps) {
  const reward = trace.reward ?? evalResult.reward;
  return (
    <article aria-label="Trace Storybook" style={{ display: "grid", gap: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18 }}>Trace Storybook</h1>
          <p style={{ margin: "4px 0 0" }}>{trace.userGoal}</p>
        </div>
        <strong>{evalResult.verifier.hardPass ? "PASS" : "FAIL"}</strong>
      </header>
      <TraceAtom title="RoomHeaderAtom" items={[trace.runId, trace.outerTrace.url || "no url recorded"]} />
      <TraceAtom title="ChatMessageAtom" items={[trace.userGoal, evalResult.judge.diagnosticSummary]} />
      <TraceAtom title="ArtifactTabAtom" items={trace.artifacts.map((artifact) => `${artifact.artifactId}: ${artifact.exportPath}`)} />
      <TraceAtom title="SpreadsheetCellAtom" items={trace.outerTrace.uiAssertions.map((item) => `${item.id}: ${item.observed}`)} />
      <LoopRewardPanel reward={reward} failureCategories={evalResult.reward.failureCategories ?? []} />
      <TraceAtom title="VerdictBadgeAtom" items={[`${evalResult.verifier.score}/${evalResult.verifier.minScore}`]} />
      <TraceAtom title="AgentToolAtom" items={trace.innerTrace.steps.map((step) => `${step.toolName}: ${step.action} - ${step.observation}`)} />
      <TraceAtom title="EvidenceCardAtom" items={[...trace.outerTrace.screenshots.map((shot) => shot.path), ...trace.artifacts.map((artifact) => artifact.exportPath)]} />
      <TraceAtom title="SourceCaptureAtom" items={evalResult.judge.evidencePaths} />
      <TraceAtom title="FocusBoxAtom" items={trace.outerTrace.uiAssertions.map((item) => `${item.passed ? "pass" : "fail"}: ${item.expected}`)} />
      <TraceAtom title="CostBadgeAtom" items={trace.innerTrace.steps.map((step) => `${step.action}: $${step.costUsd}, ${step.latencyMs}ms`)} />
    </article>
  );
}

function TraceAtom({ title, items }: { title: string; items: string[] }) {
  return (
    <section aria-label={title} style={{ border: "1px solid rgba(148, 163, 184, .35)", borderRadius: 8, padding: 10 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 13 }}>{title}</h2>
      {items.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <span>No entries recorded.</span>
      )}
    </section>
  );
}
