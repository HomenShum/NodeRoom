import { TrendingUp } from "lucide-react";
import type { RunwayMilestonePreview } from "../bankerCoachPacket";

export function RunwayMilestoneChartArtifact({ rows }: { rows: RunwayMilestonePreview[] }) {
  return (
    <div className="r-coach-runway" data-testid="coach-runway-artifact">
      {rows.length ? rows.map((row) => (
        <article key={row.id} className="r-coach-runway-row" data-status={row.status}>
          <div>
            <TrendingUp size={14} />
            <strong>{row.company}</strong>
            <span>{row.status.replace(/_/g, " ")}</span>
          </div>
          <dl>
            <dt>Cash</dt><dd>{row.cash}</dd>
            <dt>Burn</dt><dd>{row.burn}</dd>
            <dt>Runway</dt><dd>{row.runway}</dd>
          </dl>
          <p>{row.milestones.join("; ") || "Milestones pending"}</p>
        </article>
      )) : (
        <article className="r-coach-runway-row" data-status="gap">
          <div>
            <TrendingUp size={14} />
            <strong>Runway</strong>
            <span>gap</span>
          </div>
          <p>No runway artifact is present in this room.</p>
        </article>
      )}
    </div>
  );
}
