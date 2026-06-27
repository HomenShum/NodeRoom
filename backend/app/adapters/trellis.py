"""TRELLIS model worker adapter."""

import logging

import httpx

from .base import BaseModelAdapter, GenerationResult

logger = logging.getLogger(__name__)


class TrellisAdapter(BaseModelAdapter):
    lane_name = "trellis"
    endpoint_env = "TRELLIS_ENDPOINT"
    api_key_env = "TRELLIS_API_KEY"

    async def generate(
        self,
        job_id: str,
        source_photo_uri: str,
        prompt: str,
        negative_prompt: str = "",
        output_format: str = "glb",
    ) -> GenerationResult:
        endpoint = self._settings.trellis_endpoint
        if not endpoint:
            return GenerationResult(success=False, blocked_reason="TRELLIS_ENDPOINT not configured")

        payload = {
            "job_id": job_id,
            "source_photo_uri": source_photo_uri,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "output_format": output_format,
        }
        headers = {}
        if self._settings.trellis_api_key:
            headers["Authorization"] = f"Bearer {self._settings.trellis_api_key}"

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
            logger.warning("TRELLIS generation failed: %s", e)
            return GenerationResult(success=False, error=str(e), blocked_reason=f"TRELLIS worker error: {e}")
