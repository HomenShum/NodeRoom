"""RunGeneration node — call model worker adapter."""

import logging
import uuid

from ..adapters.hunyuan import HunyuanAdapter
from ..adapters.trellis import TrellisAdapter
from ..adapters.partpacker import PartPackerAdapter
from ..adapters.partcrafter import PartCrafterAdapter
from ..adapters.fallback import FallbackAdapter

logger = logging.getLogger(__name__)

_LANE_MAP = {
    "hunyuan": HunyuanAdapter,
    "trellis": TrellisAdapter,
    "partpacker": PartPackerAdapter,
    "partcrafter": PartCrafterAdapter,
    "fallback": FallbackAdapter,
}


async def run_generation(state: dict) -> dict:
    """Call the selected model worker adapter to generate a 3D model."""
    lane = state.get("current_lane", "fallback")
    understanding = state.get("image_understanding", {})

    # Use improved prompt if available (from retry), else from understanding
    prompt = state.get("improved_prompt") or understanding.get("generation_prompt", "a 3D model of the subject")
    negative_prompt = state.get("improved_negative_prompt") or understanding.get("negative_prompt", "")

    adapter_cls = _LANE_MAP.get(lane, FallbackAdapter)
    adapter = adapter_cls()

    attempt_id = f"att_{uuid.uuid4().hex[:8]}"
    job_id = state.get("job_id", "unknown")
    photo_uri = state.get("source_photo_uri", "")

    logger.info("run_generation: lane=%s, attempt_id=%s", lane, attempt_id)

    result = await adapter.generate(
        job_id=job_id,
        source_photo_uri=photo_uri,
        prompt=prompt,
        negative_prompt=negative_prompt,
    )

    attempt = {
        "id": attempt_id,
        "lane": lane,
        "source": lane,
        "status": "completed" if result.success else "blocked",
        "score": 0.0,
        "model_url": result.model_url,
        "preview_url": result.preview_url,
        "note": result.blocked_reason or result.error or f"{lane} generated model",
    }

    attempts = state.get("attempts", [])
    attempts.append(attempt)
    state["attempts"] = attempts

    if result.success:
        logger.info("run_generation: success, model_url=%s", result.model_url)
    else:
        logger.warning("run_generation: blocked — %s", result.blocked_reason or result.error)

    return state
