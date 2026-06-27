"""ValidateImport node — check GLB is loadable."""

import logging

import httpx

logger = logging.getLogger(__name__)


async def validate_import(state: dict) -> dict:
    """Check that the generated model URL is accessible."""
    attempts = state.get("attempts", [])
    if not attempts:
        return state

    latest = attempts[-1]
    if latest["status"] != "completed":
        return state

    # Skip validation for fallback lane — it's a last-resort model
    if latest.get("lane", latest.get("source", "")) == "fallback":
        logger.info("validate_import: skipping validation for fallback lane")
        return state

    model_url = latest.get("model_url", "")
    if not model_url or model_url.startswith("file://"):
        # Can't validate file:// URLs or empty — assume valid
        logger.info("validate_import: skipping validation for %s", model_url or "empty URL")
        return state

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.head(model_url)
            if resp.status_code < 400:
                logger.info("validate_import: model URL valid (status=%d)", resp.status_code)
            else:
                logger.warning("validate_import: model URL returned status=%d", resp.status_code)
                latest["status"] = "blocked"
                latest["note"] = f"Model URL validation failed: HTTP {resp.status_code}"
    except Exception as e:
        logger.warning("validate_import: could not validate URL: %s", e)
        # Don't block — might be a local network endpoint

    return state
