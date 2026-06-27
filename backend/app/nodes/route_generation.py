"""RouteGeneration node — pick lane: Hunyuan → TRELLIS → PartPacker/PartCrafter → fallback."""

import logging

from ..adapters.hunyuan import HunyuanAdapter
from ..adapters.trellis import TrellisAdapter
from ..adapters.partpacker import PartPackerAdapter
from ..adapters.partcrafter import PartCrafterAdapter
from ..adapters.fallback import FallbackAdapter

logger = logging.getLogger(__name__)


def _get_available_lanes(part_aware: bool = False) -> list:
    """Return list of available adapter instances in priority order."""
    lanes = []

    hunyuan = HunyuanAdapter()
    if hunyuan.is_available():
        lanes.append(hunyuan)

    trellis = TrellisAdapter()
    if trellis.is_available():
        lanes.append(trellis)

    if part_aware:
        pp = PartPackerAdapter()
        if pp.is_available():
            lanes.append(pp)
        pc = PartCrafterAdapter()
        if pc.is_available():
            lanes.append(pc)

    # Fallback is always available
    lanes.append(FallbackAdapter())

    return lanes


async def route_generation(state: dict) -> dict:
    """Determine which generation lane to use next."""
    part_plan = state.get("part_plan", {})
    part_aware = part_plan.get("part_aware_enabled", False)

    attempts = state.get("attempts", [])
    attempt_count = state.get("generation_attempt_count", 0)

    # Determine which lanes have already been tried
    tried_lanes = {a.get("lane", a.get("source", "")) for a in attempts}

    available = _get_available_lanes(part_aware=part_aware)

    # Find next untried lane
    next_lane = None
    for adapter in available:
        if adapter.lane_name not in tried_lanes:
            next_lane = adapter
            break

    if next_lane is None:
        # All lanes tried — use fallback
        next_lane = FallbackAdapter()

    state["current_lane"] = next_lane.lane_name
    state["generation_attempt_count"] = attempt_count + 1

    logger.info(
        "route_generation: lane=%s, attempt=%d, tried=%s",
        next_lane.lane_name,
        state["generation_attempt_count"],
        tried_lanes,
    )
    return state
