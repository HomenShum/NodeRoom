import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import type { BankerCoachCue } from "../../nodeagent/skills/bankerCoach/coachArtifacts";

export function BankerCoachCueArtifact({ cues }: { cues: BankerCoachCue[] }) {
  return (
    <div className="r-coach-cues" data-testid="coach-cue-artifact">
      {cues.map((cue) => {
        const Icon = cue.severity === "risk" ? ShieldAlert : cue.severity === "watch" ? AlertTriangle : Info;
        return (
          <article key={cue.id} className="r-coach-cue" data-severity={cue.severity} data-testid="coach-cue">
            <Icon size={14} />
            <div>
              <strong>{cue.title}</strong>
              <p>{cue.body}</p>
              <small>{cue.actionLabel}</small>
            </div>
          </article>
        );
      })}
    </div>
  );
}
