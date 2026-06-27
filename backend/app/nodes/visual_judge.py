"""VisualJudge node — VLM comparison: source photo vs model screenshots."""

import logging

from ..judge import run_visual_judge

logger = logging.getLogger(__name__)


async def visual_judge(state: dict) -> dict:
    """Compare source photo to model screenshot via VLM."""
    photo_uri = state.get("source_photo_uri", "")
    attempts = state.get("attempts", [])
    if not attempts:
        return state

    # Find the latest completed attempt
    latest_completed = None
    for a in reversed(attempts):
        if a["status"] == "completed":
            latest_completed = a
            break

    if not latest_completed:
        logger.warning("visual_judge: no completed attempt to judge")
        state["judge_report"] = {
            "score": 0.0,
            "verdict": "mismatch",
            "what_matches": [],
            "what_is_wrong": ["No completed model to judge"],
            "recommendation": "Try a different generation lane.",
        }
        return state

    preview_url = latest_completed.get("preview_url", "") or latest_completed.get("model_url", "")

    logger.info("visual_judge: comparing photo=%s vs preview=%s", photo_uri, preview_url)

    report = await run_visual_judge(photo_uri, preview_url)

    state["judge_report"] = report

    # Update attempt score
    latest_completed["score"] = report.get("score", 0.0)

    logger.info("visual_judge: score=%.2f, verdict=%s", report.get("score", 0.0), report.get("verdict"))
    return state
