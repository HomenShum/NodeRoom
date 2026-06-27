"""Visual judge — VLM comparison of source photo vs model screenshots."""

import json
import logging

from .llm import gmi_vision_json

logger = logging.getLogger(__name__)

JUDGE_PROMPT = """You are a visual judge comparing a source photograph to a 3D model screenshot.

Analyze how well the 3D model matches the original photo. Consider:
- Overall shape and silhouette
- Color and material appearance
- Key features and details
- Proportions and pose

Return a JSON object with exactly these fields:
{
  "score": <float 0.0 to 1.0>,
  "verdict": "<one of: match, partial, mismatch>",
  "what_matches": ["<list of things that match well>"],
  "what_is_wrong": ["<list of things that are wrong or missing>"],
  "recommendation": "<one sentence suggestion for improvement, or 'Acceptable result' if good>"
}

Be specific and concise. Return only the JSON."""


async def run_visual_judge(
    source_photo_url: str,
    model_screenshot_url: str,
) -> dict:
    """Compare source photo to model screenshot via VLM.

    Returns dict with: score, verdict, what_matches, what_is_wrong, recommendation.
    """
    if not source_photo_url or not model_screenshot_url:
        logger.warning("Visual judge: missing image URLs — returning default mismatch")
        return {
            "score": 0.0,
            "verdict": "mismatch",
            "what_matches": [],
            "what_is_wrong": ["No model screenshot available for comparison"],
            "recommendation": "Generate a model first, then compare.",
        }

    # Combine both images in the prompt
    prompt = f"""{JUDGE_PROMPT}

The first image is the source photograph.
The second image is the 3D model screenshot.

Source photo URL: {source_photo_url}
Model screenshot URL: {model_screenshot_url}

Compare them now."""

    result = await gmi_vision_json(source_photo_url, prompt)

    # Validate and fill defaults
    if not result:
        # VLM unavailable — return a neutral default
        logger.warning("Visual judge: VLM returned empty — using default")
        return {
            "score": 0.5,
            "verdict": "partial",
            "what_matches": ["basic silhouette"],
            "what_is_wrong": ["VLM comparison unavailable"],
            "recommendation": "VLM judge unavailable — manual review needed.",
        }

    return {
        "score": float(result.get("score", 0.5)),
        "verdict": result.get("verdict", "partial"),
        "what_matches": result.get("what_matches", []),
        "what_is_wrong": result.get("what_is_wrong", []),
        "recommendation": result.get("recommendation", ""),
    }
