"""RetryDecision node — score < threshold + budget → improve; else select best."""

import logging

from ..config import load_settings

logger = logging.getLogger(__name__)

SCORE_THRESHOLD = 0.65


async def retry_decision(state: dict) -> dict:
    """Decide whether to retry with improved prompt or accept the result."""
    settings = load_settings()
    max_attempts = settings.max_generation_attempts

    judge = state.get("judge_report", {})
    score = judge.get("score", 0.0)
    attempts = state.get("attempts", [])
    attempt_count = state.get("generation_attempt_count", len(attempts))

    # Find best completed attempt
    completed = [a for a in attempts if a["status"] == "completed"]
    if completed:
        best = max(completed, key=lambda a: a.get("score", 0.0))
        state["best_attempt_id"] = best["id"]

    if score >= SCORE_THRESHOLD:
        logger.info("retry_decision: score=%.2f >= threshold — accepting", score)
        state["__next__"] = "select_best"
        return state

    if attempt_count < max_attempts:
        # Check if there are untried lanes
        tried_lanes = {a.get("lane", a.get("source", "")) for a in attempts}
        from .route_generation import _get_available_lanes
        part_aware = state.get("part_plan", {}).get("part_aware_enabled", False)
        available = _get_available_lanes(part_aware=part_aware)
        untried = [a for a in available if a.lane_name not in tried_lanes]

        if untried:
            logger.info("retry_decision: score=%.2f < threshold, untried lanes available — retrying", score)
            # Improve prompt based on judge feedback
            recommendation = judge.get("recommendation", "")
            current_prompt = state.get("improved_prompt") or state.get("image_understanding", {}).get("generation_prompt", "")
            state["improved_prompt"] = f"{current_prompt}. Improvement: {recommendation}" if recommendation else current_prompt
            state["__next__"] = "retry"
            return state
        else:
            logger.info("retry_decision: score=%.2f but no untried lanes — accepting best", score)
            state["__next__"] = "select_best"
            return state

    logger.info("retry_decision: max attempts reached — accepting best (score=%.2f)", score)
    state["__next__"] = "select_best"
    return state
