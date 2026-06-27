"""Hunyuan3D model worker adapter — GMI Cloud serverless API.

Uses the GMI Cloud request-queue pattern:
1. POST to submit a generation request → returns request_id
2. GET request status → poll until completed/failed
3. Fetch result (model URL) from completed request
"""

import asyncio
import logging

import httpx

from .base import BaseModelAdapter, GenerationResult

logger = logging.getLogger(__name__)

# GMI Cloud serverless inference endpoint
GMI_CLOUD_BASE = "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey"
SUBMIT_URL = f"{GMI_CLOUD_BASE}/requests"
STATUS_URL = f"{GMI_CLOUD_BASE}/requests/{{request_id}}"

# Polling config
POLL_INTERVAL_SEC = 5
POLL_MAX_WAIT_SEC = 300  # 5 minutes


class HunyuanAdapter(BaseModelAdapter):
    lane_name = "hunyuan"
    endpoint_env = "HUNYUAN3D_ENDPOINT"
    api_key_env = "HUNYUAN3D_API_KEY"

    async def generate(
        self,
        job_id: str,
        source_photo_uri: str,
        prompt: str,
        negative_prompt: str = "",
        output_format: str = "glb",
    ) -> GenerationResult:
        api_key = self._settings.hunyuan3d_api_key
        if not api_key:
            return GenerationResult(success=False, blocked_reason="HUNYUAN3D_API_KEY not configured")

        # Allow overriding the endpoint, default to GMI Cloud serverless
        submit_url = self._settings.hunyuan3d_endpoint or SUBMIT_URL

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        # GMI Cloud payload format for hunyuan-3d-pro
        payload = {
            "model": "hunyuan-3d-pro",
            "payload": {
                "prompt": prompt,
                "enable_pbr": True,
                "face_count": 500000,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                # Step 1: Submit request
                logger.info("Hunyuan3D: submitting to %s", submit_url)
                resp = await client.post(submit_url, json=payload, headers=headers)

                # GMI Cloud returns 500 for ResourceInsufficient — don't use raise_for_status
                data = resp.json()

                # Check for error response
                if resp.status_code >= 400:
                    error_msg = data.get("error", data.get("message", f"HTTP {resp.status_code}"))
                    if "ResourceInsufficient" in str(error_msg):
                        return GenerationResult(
                            success=False,
                            blocked_reason="Hunyuan3D: GMI Cloud resources insufficient (Tencent-side capacity). Retry later.",
                        )
                    return GenerationResult(success=False, blocked_reason=f"Hunyuan3D: {error_msg}")

                request_id = data.get("id") or data.get("request_id") or data.get("requestId")
                if not request_id:
                    error = data.get("error", data.get("message", ""))
                    if error:
                        return GenerationResult(success=False, blocked_reason=f"Hunyuan3D: {error}")
                    return GenerationResult(success=False, blocked_reason=f"Hunyuan3D: no request_id returned. Response: {data}")

                logger.info("Hunyuan3D: request submitted, id=%s", request_id)

                # Step 2: Poll for completion
                status_url = STATUS_URL.format(request_id=request_id)
                elapsed = 0
                while elapsed < POLL_MAX_WAIT_SEC:
                    await asyncio.sleep(POLL_INTERVAL_SEC)
                    elapsed += POLL_INTERVAL_SEC

                    poll_resp = await client.get(status_url, headers=headers)
                    poll_data = poll_resp.json()

                    req_status = poll_data.get("status", "").lower()

                    if req_status in ("completed", "succeeded", "success"):
                        # Extract model URL from result
                        result = poll_data.get("result", poll_data)
                        model_url = (
                            result.get("model_url")
                            or result.get("download_url")
                            or result.get("output", {}).get("model_url", "")
                            if isinstance(result.get("output"), dict)
                            else ""
                        )
                        preview_url = result.get("preview_url", "")

                        logger.info("Hunyuan3D: completed, model_url=%s", model_url)
                        return GenerationResult(
                            success=True,
                            model_url=model_url,
                            preview_url=preview_url,
                        )

                    elif req_status in ("failed", "error", "cancelled"):
                        error_msg = poll_data.get("error", poll_data.get("message", "Unknown error"))
                        logger.warning("Hunyuan3D: request failed — %s", error_msg)
                        return GenerationResult(
                            success=False,
                            blocked_reason=f"Hunyuan3D: request {req_status} — {error_msg}",
                        )

                    logger.debug("Hunyuan3D: polling... status=%s, elapsed=%ds", req_status, elapsed)

                # Timeout
                logger.warning("Hunyuan3D: polling timed out after %ds", POLL_MAX_WAIT_SEC)
                return GenerationResult(
                    success=False,
                    blocked_reason=f"Hunyuan3D: polling timed out after {POLL_MAX_WAIT_SEC}s",
                )

        except httpx.HTTPStatusError as e:
            logger.warning("Hunyuan3D: HTTP error %d — %s", e.response.status_code, e.response.text[:200])
            return GenerationResult(
                success=False,
                error=str(e),
                blocked_reason=f"Hunyuan3D: HTTP {e.response.status_code}",
            )
        except Exception as e:
            logger.warning("Hunyuan3D generation failed: %s", e)
            return GenerationResult(success=False, error=str(e), blocked_reason=f"Hunyuan3D error: {e}")
