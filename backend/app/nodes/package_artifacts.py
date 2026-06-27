"""PackageArtifacts node — write artifact manifest."""

import json
import logging

logger = logging.getLogger(__name__)


async def package_artifacts(state: dict) -> dict:
    """Write the final artifact manifest."""
    attempts = state.get("attempts", [])
    best_id = state.get("best_attempt_id", "")

    best_attempt = None
    for a in attempts:
        if a["id"] == best_id:
            best_attempt = a
            break

    if not best_attempt:
        # Fall back to latest completed
        completed = [a for a in attempts if a["status"] == "completed"]
        if completed:
            best_attempt = completed[-1]

    manifest = {
        "job_id": state.get("job_id", ""),
        "best_attempt": best_attempt,
        "all_attempts": attempts,
        "judge_report": state.get("judge_report", {}),
        "source_photo_uri": state.get("source_photo_uri", ""),
    }

    state["final_artifact_manifest"] = json.dumps(manifest, indent=2)

    # Set current model URL for API response
    if best_attempt:
        state["__final_model_url"] = best_attempt.get("model_url", "")
        state["__final_preview_url"] = best_attempt.get("preview_url", "")

    logger.info("package_artifacts: manifest written, best=%s", best_id)
    return state
