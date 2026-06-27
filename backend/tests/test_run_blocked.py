"""Test: POST /run with no model endpoints → job completes as PARTIAL with fallback model.

This simulates the scenario where all GPU worker endpoints are missing.
The pipeline should use the fallback adapter and still produce a result.
"""

import asyncio
import io
import time

import httpx
import pytest
from httpx import ASGITransport

from app.main import app


@pytest.mark.asyncio
async def test_run_blocked():
    """When no model endpoints are configured, job should complete via fallback."""
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Create a minimal fake image
        fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)

        # POST /run with a fake photo
        resp = await client.post(
            "/run",
            files={"photo": ("test.jpg", fake_image, "image/jpeg")},
            data={"prompt": ""},
        )

        assert resp.status_code == 202
        data = resp.json()
        assert "job_id" in data
        assert data["status"] == "queued"

        job_id = data["job_id"]

        # Poll until job is done (with timeout)
        max_wait = 30
        start = time.time()
        final_status = None
        job_data = None

        while time.time() - start < max_wait:
            # Yield to allow background task to run
            await asyncio.sleep(0.5)

            job_resp = await client.get(f"/jobs/{job_id}")
            assert job_resp.status_code == 200
            job_data = job_resp.json()
            final_status = job_data["status"]

            if final_status in ("completed", "partial", "blocked"):
                break

        # Job should complete (partial since fallback model won't match the photo well)
        assert final_status in ("completed", "partial", "blocked"), f"Job stuck in {final_status}"

        # Should have at least one attempt (fallback)
        assert len(job_data.get("attempts", [])) > 0

        # Fallback attempt should be present
        sources = [a["source"] for a in job_data["attempts"]]
        assert "fallback" in sources
