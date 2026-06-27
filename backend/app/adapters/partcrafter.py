"""PartCrafter model worker adapter (optional, part-aware lanes only)."""

import logging

import httpx

from .base import BaseModelAdapter, GenerationResult

logger = logging.getLogger(__name__)


class PartCrafterAdapter(BaseModelAdapter):
    lane_name = "partcrafter"
    endpoint_env = "PARTCRAFTER_ENDPOINT"
    api_key_env = "PARTCRAFTER_API_KEY"

    async def generate(
        self,
        job_id: str,
        source_photo_uri: str,
        prompt: str,
        negative_prompt: str = "",
        output_format: str = "glb",
    ) -> GenerationResult:
        endpoint = self._settings.partcrafter_endpoint
        if not endpoint:
            return GenerationResult(success=False, blocked_reason="PARTCRAFTER_ENDPOINT not configured")

        payload = {
            "job_id": job_id,
            "source_photo_uri": source_photo_uri,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "output_format": output_format,
        }
        headers = {}
        if self._settings.partcrafter_api_key:
            headers["Authorization"] = f"Bearer {self._settings.partcrafter_api_key}"

        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.post(endpoint, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                return GenerationResult(
                    success=True,
                    model_url=data.get("model_url", ""),
                    preview_url=data.get("preview_url", ""),
                )
        except Exception as e:
            logger.warning("PartCrafter generation failed: %s", e)
            return GenerationResult(success=False, error=str(e), blocked_reason=f"PartCrafter worker error: {e}")
