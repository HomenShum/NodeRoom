"""RenderSnapshots node — placeholder preview URLs (real rendering = GPU worker)."""

import logging

logger = logging.getLogger(__name__)


async def render_snapshots(state: dict) -> dict:
    """Generate placeholder preview URLs for the model.

    Real rendering is a GPU worker concern. Here we just set placeholder URLs
    so the visual judge and frontend have something to reference.
    """
    attempts = state.get("attempts", [])
    if not attempts:
        return state

    latest = attempts[-1]
    if latest["status"] != "completed":
        return state

    model_url = latest.get("model_url", "")

    # Use model URL as preview if no separate preview was provided
    if not latest.get("preview_url"):
        latest["preview_url"] = model_url

    logger.info("render_snapshots: preview_url=%s", latest.get("preview_url"))
    return state
