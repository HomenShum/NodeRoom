export type UiProofloopReward = {
  taskCompletion: number;
  evidenceGrounding: number;
  artifactCorrectness: number;
  visualClarity: number;
  humanAcceptance: number;
  costEfficiency: number;
  latencyEfficiency: number;
  safety: number;
  total: number;
};

export type LoopRewardPanelProps = {
  reward: UiProofloopReward;
  failureCategories?: string[];
};

const rewardKeys = [
  "taskCompletion",
  "evidenceGrounding",
  "artifactCorrectness",
  "visualClarity",
  "humanAcceptance",
  "costEfficiency",
  "latencyEfficiency",
  "safety",
] as const satisfies ReadonlyArray<keyof UiProofloopReward>;

export function LoopRewardPanel({ reward, failureCategories = [] }: LoopRewardPanelProps) {
  return (
    <section aria-label="Loop reward" style={{ display: "grid", gap: 10 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>LoopRewardPanel</h2>
        <strong aria-label="total reward">{reward.total.toFixed(3)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8 }}>
        {rewardKeys.map((key) => (
          <label key={key} style={{ display: "grid", gridTemplateColumns: "minmax(160px, 1fr) 90px", alignItems: "center", gap: 10 }}>
            <span>{key}</span>
            <meter min={0} max={1} value={reward[key]} aria-label={key} />
          </label>
        ))}
      </div>
      <div aria-label="failure categories" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {failureCategories.length ? failureCategories.map((category) => <code key={category}>{category}</code>) : <span>No lagging layer above threshold.</span>}
      </div>
    </section>
  );
}
