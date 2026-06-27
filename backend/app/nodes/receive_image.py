"""ReceiveImage node — validate and store source photo."""

import hashlib
import logging
from typing import TypedDict

logger = logging.getLogger(__name__)


class PhotoTo3DState(TypedDict, total=False):
    job_id: str
    source_photo_uri: str
    source_photo_hash: str
    image_understanding: dict
    context_research: dict
    part_plan: dict
    attempts: list[dict]
    best_attempt_id: str
    judge_report: dict
    final_artifact_manifest: str
    # internal
    current_lane: str
    generation_attempt_count: int
    improved_prompt: str
    improved_negative_prompt: str


async def receive_image(state: PhotoTo3DState) -> PhotoTo3DState:
    """Validate source photo URI and compute hash."""
    uri = state.get("source_photo_uri", "")
    if not uri:
        logger.error("receive_image: no source_photo_uri in state")
        state["source_photo_hash"] = ""
    else:
        state["source_photo_hash"] = hashlib.sha256(uri.encode()).hexdigest()[:16]

    logger.info("receive_image: photo received, hash=%s", state.get("source_photo_hash", ""))
    return state
