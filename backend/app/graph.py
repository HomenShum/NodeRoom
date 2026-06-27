"""LangGraph state machine wiring for the photo-to-3D pipeline.

Since LangGraph may not be installed in all environments, this module
provides a manual async pipeline runner that follows the same state machine
topology. If langgraph is available, it can be used; otherwise the manual
runner is the default.
"""

import logging
from typing import Any, Callable

from .nodes.receive_image import receive_image, PhotoTo3DState
from .nodes.image_understanding import image_understanding
from .nodes.search_context import search_context
from .nodes.part_plan import part_plan
from .nodes.route_generation import route_generation
from .nodes.run_generation import run_generation
from .nodes.validate_import import validate_import
from .nodes.render_snapshots import render_snapshots
from .nodes.visual_judge import visual_judge
from .nodes.retry_decision import retry_decision
from .nodes.package_artifacts import package_artifacts
from .nodes.complete_job import complete_job

logger = logging.getLogger(__name__)

# Node → event type mapping for SSE
NODE_EVENTS = {
    "receive_image": "photo_received",
    "image_understanding": "understanding_image",
    "search_context": "context_searched",
    "part_plan": "planning_parts",
    "route_generation": "generation_started",
    "run_generation": "model_ready",
    "validate_import": "model_ready",
    "render_snapshots": "compare_started",
    "visual_judge": "judge_ready",
    "retry_decision": "improvement_started",
    "package_artifacts": "completed",
    "complete_job": "completed",
}

# Progress percentages per node
NODE_PROGRESS = {
    "receive_image": 5,
    "image_understanding": 15,
    "search_context": 25,
    "part_plan": 35,
    "route_generation": 40,
    "run_generation": 55,
    "validate_import": 60,
    "render_snapshots": 65,
    "visual_judge": 75,
    "retry_decision": 80,
    "package_artifacts": 90,
    "complete_job": 100,
}


async def run_pipeline(
    state: PhotoTo3DState,
    on_event: Callable[[str, dict], Any] | None = None,
) -> PhotoTo3DState:
    """Run the full photo-to-3D pipeline.

    Args:
        state: Initial pipeline state.
        on_event: Optional callback invoked as (event_type, data) after each node.
    """
    async def _emit(node_name: str):
        if on_event:
            event_type = NODE_EVENTS.get(node_name, node_name)
            progress = NODE_PROGRESS.get(node_name, 0)
            await on_event(event_type, {"progress": progress, "node": node_name})

    # Linear pipeline with retry loop
    state = await receive_image(state)
    await _emit("receive_image")

    state = await image_understanding(state)
    await _emit("image_understanding")

    state = await search_context(state)
    await _emit("search_context")

    state = await part_plan(state)
    await _emit("part_plan")

    # Generation loop (with retry)
    max_retries = 3
    for _ in range(max_retries):
        state = await route_generation(state)
        await _emit("route_generation")

        state = await run_generation(state)
        await _emit("run_generation")

        state = await validate_import(state)
        await _emit("validate_import")

        state = await render_snapshots(state)
        await _emit("render_snapshots")

        state = await visual_judge(state)
        await _emit("visual_judge")

        state = await retry_decision(state)
        await _emit("retry_decision")

        next_step = state.pop("__next__", "select_best")
        if next_step == "retry":
            continue
        break

    state = await package_artifacts(state)
    await _emit("package_artifacts")

    state = await complete_job(state)
    await _emit("complete_job")

    return state
