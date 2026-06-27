"""Fallback adapter — returns cached GLB when all live generation is blocked."""

import logging
import os

from .base import BaseModelAdapter, GenerationResult

logger = logging.getLogger(__name__)

# Path to cached fallback model relative to project root
FALLBACK_GLB_PATH = "public/proof/trellis2-clean-room-eyewear.glb"
# KhronosGroup sample GLB — always available, valid GLB
FALLBACK_GLB_PUBLIC_URL = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Box/glTF-Binary/Box.glb"


class FallbackAdapter(BaseModelAdapter):
    lane_name = "fallback"
    endpoint_env = ""
    api_key_env = ""

    def is_available(self) -> bool:
        return True  # always available

    async def generate(
        self,
        job_id: str,
        source_photo_uri: str,
        prompt: str,
        negative_prompt: str = "",
        output_format: str = "glb",
    ) -> GenerationResult:
        # Check if local file exists
        # Try to find from project root (parent of backend/)
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        project_root = os.path.dirname(backend_dir)
        local_path = os.path.join(project_root, FALLBACK_GLB_PATH)

        if os.path.exists(local_path):
            logger.info("Fallback: using local cached GLB at %s", local_path)
            return GenerationResult(
                success=True,
                model_url=f"file://{local_path}",
                preview_url="",
            )

        logger.info("Fallback: using remote cached GLB URL")
        return GenerationResult(
            success=True,
            model_url=FALLBACK_GLB_PUBLIC_URL,
            preview_url="",
        )
