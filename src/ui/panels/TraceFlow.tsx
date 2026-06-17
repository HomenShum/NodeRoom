/**
 * Trace · Flow — the workflow's progression as a directed graph (reactflow), alongside the linear
 * Steps list under the same Trace record. Nodes are laid out by phase (column) in step order; edges
 * animate the flow; clicking a node shows that step + opens its source. Pan/zoom/minimap scale it.
 */
import { useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowUpRight } from "lucide-react";
import type { TraceRecord, TraceStep, TraceTone } from "./traceData";

const TONE: Record<TraceTone, string> = {
  ok: "var(--success-ink)",
  warn: "var(--warning-ink)",
  risk: "var(--danger-ink)",
  info: "var(--text-muted)",
};

export function TraceFlow({ record, onOpenSource }: {
  record: TraceRecord;
  onOpenSource: (artifactId: string, elementId?: string) => void;
}) {
  const phases = useMemo(() => {
    const seen: string[] = [];
    for (const s of record.steps) { const g = s.group ?? "Steps"; if (!seen.includes(g)) seen.push(g); }
    return seen;
  }, [record]);

  const { nodes, edges } = useMemo(() => {
    const COL = 248, ROW = 88;
    const rowOf: Record<string, number> = {};
    const nodes: Node[] = record.steps.map((s) => {
      const g = s.group ?? "Steps";
      const col = phases.indexOf(g);
      const row = (rowOf[g] = (rowOf[g] ?? -1) + 1);
      const label = s.label.length > 30 ? `${s.label.slice(0, 30)}…` : s.label;
      return {
        id: String(s.idx),
        position: { x: col * COL, y: row * ROW },
        data: { label: `${s.idx}. ${label}` },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          width: 200,
          fontSize: 11,
          fontWeight: 500,
          padding: "8px 10px",
          borderRadius: 10,
          border: `1px solid ${TONE[s.status]}`,
          background: "var(--bg-secondary)",
          color: "var(--text-primary)",
          textAlign: "left" as const,
        },
      };
    });
    const edges: Edge[] = [];
    for (let i = 0; i < record.steps.length - 1; i++) {
      edges.push({ id: `f${i}`, source: String(record.steps[i].idx), target: String(record.steps[i + 1].idx), animated: true, style: { stroke: "var(--line-strong)" } });
    }
    return { nodes, edges };
  }, [record, phases]);

  const [sel, setSel] = useState<TraceStep | null>(null);

  return (
    <div className="r-tracevu-flow" data-testid="trace-flow">
      <div className="r-tracevu-flowgraph">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => setSel(record.steps.find((s) => String(s.idx) === n.id) ?? null)}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      {sel && (
        <div className="r-tracevu-flowdetail" data-testid="trace-flow-detail" data-tone={sel.status}>
          <strong>{sel.idx}. {sel.label}</strong>
          {sel.detail && <p>{sel.detail}</p>}
          {sel.targetArtifactId && (
            <button type="button" className="r-tracevu-download" onClick={() => onOpenSource(sel.targetArtifactId!, sel.targetElementId)}>
              Open source cell <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
