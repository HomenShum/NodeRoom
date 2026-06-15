import { CheckCircle2, ClipboardList } from "lucide-react";
import type { ReviewRoundUpdate } from "../../nodeagent/skills/bankerCoach/coachArtifacts";

export function ReviewRoundUpdateArtifact({ update }: { update: ReviewRoundUpdate }) {
  return (
    <article className="r-coach-review" data-testid="coach-review-artifact">
      <div className="r-coach-review-head">
        <ClipboardList size={14} />
        <strong>{update.subject}</strong>
        <span>{update.status.replace(/_/g, " ")}</span>
      </div>
      <div className="r-coach-review-body">
        {update.bullets.map((bullet) => (
          <p key={bullet}><CheckCircle2 size={12} />{bullet}</p>
        ))}
      </div>
      {!!update.openQuestions.length && (
        <div className="r-coach-review-list">
          <b>Open questions</b>
          {update.openQuestions.map((question) => <span key={question}>{question}</span>)}
        </div>
      )}
    </article>
  );
}
