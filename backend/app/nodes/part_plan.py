"""PartPlan node — Nemotron Ultra part planning from VLM + search."""

import json
import logging

from ..config import load_settings
from ..llm import gmi_chat

logger = logging.getLogger(__name__)

PART_PLAN_PROMPT = """You are a 3D model part planner. Based on the image understanding and context research, create a part plan.

Image Understanding:
{understanding}

Context Research:
{research}

Return JSON with these fields:
{{
  "parts": [
    {{"id": "part_1", "label": "<part name>", "visible": true, "importance": "high|medium|low", "expected_geometry": "<description>"}}
  ],
  "part_aware_enabled": false,
  "do_not_generate_as_separate_parts": ["<parts that should be merged into the main body>"]
}}

Keep it simple — for most objects, a single part is sufficient. Only enable part_aware_enabled if the object clearly has distinct separable components. Return only the JSON."""


async def part_plan(state: dict) -> dict:
    """Plan parts for 3D generation using LLM."""
    understanding = state.get("image_understanding", {})
    research = state.get("context_research", {})

    settings = load_settings()

    prompt = PART_PLAN_PROMPT.format(
        understanding=json.dumps(understanding, indent=2),
        research=json.dumps(research, indent=2),
    )

    raw = await gmi_chat(prompt, system="You are a 3D model part planning assistant.")

    plan = {}
    if raw:
        try:
            plan = json.loads(raw)
        except json.JSONDecodeError:
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                try:
                    plan = json.loads(raw[start:end])
                except json.JSONDecodeError:
                    pass

    if not plan:
        logger.warning("part_plan: LLM returned no parseable plan — using default")
        plan = {
            "parts": [
                {
                    "id": "part_1",
                    "label": understanding.get("subject", "main object"),
                    "visible": True,
                    "importance": "high",
                    "expected_geometry": understanding.get("generation_prompt", "main body"),
                }
            ],
            "part_aware_enabled": settings.enable_part_aware_lanes,
            "do_not_generate_as_separate_parts": [],
        }

    # Override part_aware_enabled with env setting
    plan["part_aware_enabled"] = settings.enable_part_aware_lanes

    state["part_plan"] = plan
    logger.info("part_plan: %d parts, part_aware=%s", len(plan.get("parts", [])), plan.get("part_aware_enabled"))
    return state
