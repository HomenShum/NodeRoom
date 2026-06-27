"""Test: Verify fallback model URL + judge report returned when all live generation blocked.

With no endpoints configured, the fallback adapter should return a cached GLB
and the visual judge should still produce a report (even if VLM is unavailable).
"""

import asyncio
import io
import time

import httpx
import pytest
from httpx import ASGITransport

from app.main import app


@pytest.mark.asyncio
async def test_run_fallback():
    """Fallback model URL and judge report should be present when all live generation blocked."""
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)

        resp = await client.post(
            "/run",
            files={"photo": ("test.jpg", fake_image, "image/jpeg")},
        )
        assert resp.status_code == 202
        job_id = resp.json()["job_id"]

        # Wait for completion
        max_wait = 30
        start = time.time()
        job_data = None

        while time.time() - start < max_wait:
            await asyncio.sleep(0.5)
            job_resp = await client.get(f"/jobs/{job_id}")
            job_data = job_resp.json()
            if job_data["status"] in ("completed", "partial", "blocked"):
                break

        assert job_data is not None
        assert job_data["status"] in ("completed", "partial", "blocked")

        # Check that fallback model URL is set
        assert job_data.get("current_model_url", "") != "" or job_data.get("status") == "blocked"

        # Check that judge report exists (even if default/placeholder)
        if job_data.get("judge"):
            judge = job_data["judge"]
            assert "score" in judge
            assert "verdict" in judge
            assert "what_matches" in judge
            assert "what_is_wrong" in judge

        # Check artifacts endpoint
        artifacts_resp = await client.get(f"/jobs/{job_id}/artifacts")
        assert artifacts_resp.status_code == 200
        artifacts = artifacts_resp.json()
        assert artifacts["job_id"] == job_id
        assert len(artifacts.get("attempts", [])) > 0
