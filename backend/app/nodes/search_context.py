"""SearchContext node — Tavily search for object structure references."""

import logging

from ..search import search_object_context

logger = logging.getLogger(__name__)


async def search_context(state: dict) -> dict:
    """Search for context about the detected object category."""
    understanding = state.get("image_understanding", {})
    category = understanding.get("category", "object")

    logger.info("search_context: searching for category=%s", category)
    result = await search_object_context(category)

    state["context_research"] = result
    logger.info("search_context: %d results found", len(result.get("search_results", [])))
    return state
