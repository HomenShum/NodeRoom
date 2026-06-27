"""CompleteJob node — set final status."""

import logging

logger = logging.getLogger(__name__)


async def complete_job(state: dict) -> dict:
    """Set the final job status based on results."""
    judge = state.get("judge_report", {})
    score = judge.get("score", 0.0)
    verdict = judge.get("verdict", "mismatch")
    attempts = state.get("attempts", [])

    completed = [a for a in attempts if a["status"] == "completed"]
    blocked = [a for a in attempts if a["status"] == "blocked"]

    if not completed:
        state["__final_status"] = "blocked"
        state["__final_message"] = "All generation lanes blocked. No model produced."
    elif score >= 0.65 or verdict == "match":
        state["__final_status"] = "completed"
        state["__final_message"] = "3D model generated and judged acceptable."
    else:
        state["__final_status"] = "partial"
        state["__final_message"] = f"Model generated but judge score is {score:.2f} ({verdict})."

    logger.info("complete_job: status=%s, score=%.2f", state["__final_status"], score)
    return state
