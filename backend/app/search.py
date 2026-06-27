"""Tavily search client for context gathering."""

import logging
from typing import Optional

from .config import load_settings

logger = logging.getLogger(__name__)

_settings = None
_client = None


def _get_client():
    global _client, _settings
    if _client is None:
        _settings = load_settings()
        if not _settings.tavily_api_key:
            return None
        try:
            from tavily import AsyncTavilyClient
            _client = AsyncTavilyClient(api_key=_settings.tavily_api_key)
        except ImportError:
            logger.warning("tavily-python not installed — search disabled")
            return None
    return _client


async def tavily_search(query: str, max_results: int = 5) -> list[dict]:
    """Search via Tavily. Returns list of {title, url, content}.

    If Tavily key missing or error, returns empty list (graceful skip).
    """
    client = _get_client()
    if client is None:
        logger.info("Tavily not configured — skipping search for: %s", query)
        return []
    try:
        resp = await client.search(query=query, max_results=max_results)
        results = []
        for r in resp.get("results", []):
            results.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
            })
        return results
    except Exception as e:
        logger.warning("Tavily search error: %s", e)
        return []


async def search_object_context(category: str) -> dict:
    """Search for object structure and 3D model considerations."""
    queries = [
        f"{category} parts structure breakdown",
        f"{category} 3D model considerations",
    ]
    all_results = []
    for q in queries:
        results = await tavily_search(q)
        all_results.extend(results)
    return {
        "search_results": all_results,
        "reference_parts": [],
        "notes": f"Found {len(all_results)} context results for '{category}'" if all_results else "No search results — LLM reasoning only",
    }
