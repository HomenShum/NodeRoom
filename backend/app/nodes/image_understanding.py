"""ImageUnderstanding node — GMI VLM (Nemotron Nano Omni / Gemini fallback)."""

import json
import logging

from ..llm import gmi_vision_json

logger = logging.getLogger(__name__)

UNDERSTANDING_PROMPT = """Analyze this photograph for 3D model generation.

Identify and return JSON with these fields:
{
  "subject": "<main subject description, e.g. 'a person wearing a black outfit'>",
  "category": "<object category, e.g. 'human', 'furniture', 'vehicle', 'accessory'>",
  "visible_parts": ["<list of visible parts/components>"],
  "hidden_parts": ["<list of parts likely hidden from view>"],
  "materials": ["<list of apparent materials>"],
  "pose": "<pose or orientation description>",
  "generation_prompt": "<a detailed prompt for 3D generation describing the subject>",
  "negative_prompt": "<things to avoid in generation, e.g. 'blurry, low quality, extra limbs'>"
}

Be specific and thorough. Return only the JSON."""


async def image_understanding(state: dict) -> dict:
    """Use VLM to understand the source photo."""
    photo_uri = state.get("source_photo_uri", "")
    if not photo_uri:
        logger.warning("image_understanding: no photo URI — using defaults")
        state["image_understanding"] = {
            "subject": "unknown",
            "category": "unknown",
            "visible_parts": [],
            "hidden_parts": [],
            "materials": [],
            "pose": "unknown",
            "generation_prompt": "a 3D model of the subject in the photo",
            "negative_prompt": "blurry, low quality, deformed",
        }
        return state

    result = await gmi_vision_json(photo_uri, UNDERSTANDING_PROMPT)

    if not result:
        logger.warning("image_understanding: VLM returned empty — using defaults")
        result = {
            "subject": "a subject from the photo",
            "category": "object",
            "visible_parts": ["main body"],
            "hidden_parts": ["back"],
            "materials": ["unknown"],
            "pose": "front-facing",
            "generation_prompt": "a 3D model of the subject shown in the photo",
            "negative_prompt": "blurry, low quality, deformed, extra parts",
        }

    state["image_understanding"] = result
    logger.info("image_understanding: subject=%s, category=%s", result.get("subject"), result.get("category"))
    return state
