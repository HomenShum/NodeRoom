// @vitest-environment jsdom
/**
 * Run Trace header honesty — every number and label on the run view must come
 * from the run's own agentRuns/agentSteps rows.
 *
 * Persona: the operator re-running the fresh-user proof opens Run Trace after a
 * read-only Free-route run (read_notebook ✗ → list_artifacts → read_notebook ✓)
 * and transcribes what it shows into the marketed receipt. On 2026-10-31 they
 * recorded "Room trace (42 events)" and a "v246 → v247" version chip, and the
 * root span read "Enrich rows 81-120". None of that was data: the header text,
 * the focus pill, both version pills, and the root-label swap were design-mock
 * literals (commit 5d4cc840, 2026-07-08). The 42 made the proof bundle's honest
 * "0 traces" look like a counter regression.
 *
 * Angles: the receipt's exact run; a different run in another room (labels must
 * follow the data, not stay fixed); an empty room (no fabricated chrome at all).
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunsPane } from "../src/ui/panels/TraceSurface";
import { assembleRunSpans, type RunSummary } from "../convex/runTrace";

const MOCK_LITERALS = [/42 events/, /v246/, /v247/, /Enrich rows 81-120/];

function summary(over: Partial<RunSummary>): RunSummary {
  return { id: "run_1", goal: "agent run", agentId: "agent_room", model: "cohere/north-mini-code:free", steps: 0, toolCalls: 0, costUsd: 0, ms: 0, exhausted: false, createdAt: Date.UTC(2026, 9, 31, 18, 7), ...over };
}

function renderPane(runs: RunSummary[], spans: ReturnType<typeof assembleRunSpans>["spans"]) {
  return render(
    <RunsPane toggle={null} runs={runs} selectedId={runs[0]?.id ?? null} onPick={() => {}} spans={spans} truncated={false}
      emptyHint="No agent runs yet — ask the room agent to do something and its span tree lands here." />,
  );
}

describe("Run Trace shows only what the run recorded", () => {
  it("the 2026-10-31 read-only proof run: real goal, real span count, no mock event count or version chip", () => {
    const goal = "Room NodeAgent · read the Open questions / workplan notebook";
    const run = summary({ goal, steps: 3, toolCalls: 3, ms: 16_700 });
    const { spans } = assembleRunSpans({ ...run, stopReason: "done", idempotencyKey: "proof-20261031" }, [
      { idx: 0, tool: "read_notebook", args: "{}", result: '{"ok":false,"reason":"artifact_not_notebook"}', status: "ok", ms: 110 },
      { idx: 1, tool: "list_artifacts", args: "{}", result: '{"ok":true}', status: "ok", ms: 14 },
      { idx: 2, tool: "read_notebook", args: '{"artifactId":"nb_workplan"}', result: '{"ok":true}', status: "ok", ms: 251 },
    ]);
    expect(spans).toHaveLength(5); // mission + context×3 group + 3 tool spans — the receipt's "5 spans"

    const { container } = renderPane([run], spans);

    for (const literal of MOCK_LITERALS) expect(container.textContent).not.toMatch(literal);
    const tree = screen.getByTestId("trace-run-tree");
    expect(within(tree).getAllByText(goal).length).toBeGreaterThan(0); // toolbar + root row carry the run's real goal
    expect(tree.textContent).toContain("5 spans");
  });

  it("a different run in another room keeps its own labels — nothing on the view is fixed text", () => {
    const goal = "Room NodeAgent · fill funding for rows 3-9";
    const runs = [summary({ id: "run_b", goal, steps: 2, toolCalls: 2, ms: 2_400 }), summary({ id: "run_a", goal: "earlier run", steps: 1 })];
    const { spans } = assembleRunSpans({ ...runs[0], stopReason: "done" }, [
      { idx: 0, tool: "read_range", args: '{"range":"A3:D9"}', result: '{"ok":true}', status: "ok", ms: 300 },
      { idx: 1, tool: "write_locked_cells", args: '{"cells":7}', result: '{"ok":true,"version":12}', status: "ok", ms: 900 },
    ]);

    const { container } = renderPane(runs, spans);

    for (const literal of MOCK_LITERALS) expect(container.textContent).not.toMatch(literal);
    expect(within(screen.getByTestId("trace-run-tree")).getAllByText(goal).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("trace-run-item")).toHaveLength(2);
  });

  it("an empty room shows the empty hint and no fabricated focus/version chrome", () => {
    const { container } = renderPane([], []);

    for (const literal of MOCK_LITERALS) expect(container.textContent).not.toMatch(literal);
    expect(screen.getByTestId("trace-runs-empty")).toBeTruthy();
    expect(screen.queryByTestId("trace-run-tree")).toBeNull();
  });
});
