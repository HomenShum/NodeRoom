"""Base adapter interface for GPU model workers."""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class GenerationResult:
    success: bool
    model_url: str = ""
    preview_url: str = ""
    error: str = ""
    blocked_reason: str = ""


class BaseModelAdapter(ABC):
    """Base class for model worker adapters.

    Each adapter: check endpoint env var → POST to worker → parse response or mark BLOCKED.
    """

    lane_name: str = "base"
    endpoint_env: str = ""
    api_key_env: str = ""

    def __init__(self):
        from ..config import load_settings
        self._settings = load_settings()

    def is_available(self) -> bool:
        """Check if this adapter is configured.

        Available if either endpoint OR api_key is set.
        Some adapters (e.g. Hunyuan) have a default endpoint and only need the key.
        """
        endpoint = getattr(self._settings, self._get_endpoint_attr(), "") if self._get_endpoint_attr() else ""
        api_key = getattr(self._settings, self._get_api_key_attr(), "") if self._get_api_key_attr() else ""
        return bool(endpoint) or bool(api_key)

    def _get_endpoint_attr(self) -> str:
        """Map endpoint_env to settings attribute name."""
        mapping = {
            "HUNYUAN3D_ENDPOINT": "hunyuan3d_endpoint",
            "TRELLIS_ENDPOINT": "trellis_endpoint",
            "PARTPACKER_ENDPOINT": "partpacker_endpoint",
            "PARTCRAFTER_ENDPOINT": "partcrafter_endpoint",
        }
        return mapping.get(self.endpoint_env, "")

    def _get_api_key_attr(self) -> str:
        mapping = {
            "HUNYUAN3D_API_KEY": "hunyuan3d_api_key",
            "TRELLIS_API_KEY": "trellis_api_key",
            "PARTPACKER_API_KEY": "partpacker_api_key",
            "PARTCRAFTER_API_KEY": "partcrafter_api_key",
        }
        return mapping.get(self.api_key_env, "")

    @abstractmethod
    async def generate(
        self,
        job_id: str,
        source_photo_uri: str,
        prompt: str,
        negative_prompt: str = "",
        output_format: str = "glb",
    ) -> GenerationResult:
        """Call the model worker to generate a 3D model."""
        ...
