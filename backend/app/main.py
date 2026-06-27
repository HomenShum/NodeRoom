"""FastAPI app — routes, SSE, file upload."""

import asyncio
import json
import logging
import os
import time
import uuid

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import load_settings, credential_report
from .tracing import setup_tracing
from .jobs import get_job_store, JobState, JudgeReport, Attempt
from .graph import run_pipeline, NODE_EVENTS, NODE_PROGRESS

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Photo-to-3D Proof Agent", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize tracing on startup
setup_tracing()

# Upload directory
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/tmp/photo-to-3d-uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Serve stub page
STUB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "stub")


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/credentials")
async def credentials():
    """Report which credentials are present (never values)."""
    return {"credentials": credential_report()}


@app.post("/run")
async def run(
    photo: UploadFile = File(...),
    prompt: str = Form(default=""),
):
    """Upload a photo and start a 3D generation job.

    Returns 202 with job_id.
    """
    # Save uploaded file
    ext = os.path.splitext(photo.filename or "photo.jpg")[1] or ".jpg"
    file_id = uuid.uuid4().hex[:12]
    filename = f"{file_id}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    content = await photo.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # Create a URL for the photo (local file path as URI)
    photo_uri = f"file://{filepath}"

    # Create job
    store = get_job_store()
    job = await store.create_job(source_photo_url=photo_uri)

    # Start pipeline in background
    asyncio.create_task(_run_job_pipeline(job.job_id, photo_uri, prompt))

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "job_id": job.job_id,
            "status": "queued",
            "message": "Photo received. Generation started.",
        },
    )


async def _run_job_pipeline(job_id: str, photo_uri: str, user_prompt: str):
    """Run the pipeline and update job state + events."""
    store = get_job_store()

    # Update status
    await store.update_job(job_id, status="understanding", progress=5, simple_message="Analyzing your photo...")

    # Event callback
    event_queue: asyncio.Queue = asyncio.Queue()

    async def on_event(event_type: str, data: dict):
        await store.add_event(job_id, event_type, data)
        await event_queue.put({"type": event_type, "data": data})
        # Update progress
        progress = data.get("progress", 0)
        msg = _progress_message(event_type)
        await store.update_job(job_id, progress=progress, simple_message=msg, status=_event_to_status(event_type))

    # Build initial state
    state = {
        "job_id": job_id,
        "source_photo_uri": photo_uri,
        "attempts": [],
        "generation_attempt_count": 0,
    }
    if user_prompt:
        state["improved_prompt"] = user_prompt

    try:
        final_state = await run_pipeline(state, on_event=on_event)

        # Update job with final results
        judge = final_state.get("judge_report", {})
        attempts = final_state.get("attempts", [])
        final_status = final_state.get("__final_status", "completed")
        final_message = final_state.get("__final_message", "Done.")
        final_model_url = final_state.get("__final_model_url", "")
        final_preview_url = final_state.get("__final_preview_url", "")

        # Convert attempts to API format
        api_attempts = []
        for a in attempts:
            api_attempts.append(Attempt(
                id=a.get("id", ""),
                source=a.get("source", a.get("lane", "")),
                status=a.get("status", ""),
                score=a.get("score", 0.0),
                model_url=a.get("model_url", ""),
                preview_url=a.get("preview_url", ""),
                note=a.get("note", ""),
            ))

        judge_report = JudgeReport(
            score=judge.get("score", 0.0),
            verdict=judge.get("verdict", ""),
            what_matches=judge.get("what_matches", []),
            what_is_wrong=judge.get("what_is_wrong", []),
            recommendation=judge.get("recommendation", ""),
        )

        await store.update_job(
            job_id,
            status=final_status,
            progress=100,
            simple_message=final_message,
            current_model_url=final_model_url,
            model_preview_url=final_preview_url,
            judge=judge_report,
            attempts=api_attempts,
        )

    except Exception as e:
        logger.error("Pipeline error for job %s: %s", job_id, e, exc_info=True)
        await store.update_job(
            job_id,
            status="blocked",
            progress=0,
            simple_message=f"Pipeline error: {e}",
        )


def _event_to_status(event_type: str) -> str:
    """Map SSE event type to job status."""
    mapping = {
        "photo_received": "understanding",
        "understanding_image": "understanding",
        "context_searched": "searching",
        "planning_parts": "planning",
        "generation_started": "generating",
        "model_ready": "generating",
        "compare_started": "comparing",
        "judge_ready": "comparing",
        "improvement_started": "generating",
        "completed": "completed",
    }
    return mapping.get(event_type, "processing")


def _progress_message(event_type: str) -> str:
    """Human-readable progress message per event type."""
    messages = {
        "photo_received": "Photo received and validated.",
        "understanding_image": "Analyzing the photo to understand the subject...",
        "context_searched": "Searching for reference information...",
        "planning_parts": "Planning the 3D model structure...",
        "generation_started": "Starting 3D model generation...",
        "model_ready": "3D model generated. Validating...",
        "compare_started": "Comparing the 3D model to the photo...",
        "judge_ready": "Visual judge evaluating the model...",
        "improvement_started": "Improving the generation prompt and retrying...",
        "completed": "Job complete.",
    }
    return messages.get(event_type, "Processing...")


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Get job state + judge + attempts."""
    store = get_job_store()
    job = await store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict()


@app.get("/jobs/{job_id}/events")
async def job_events(job_id: str):
    """SSE stream of job events."""
    store = get_job_store()
    job = await store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        sent_events = 0
        while True:
            job = await store.get_job(job_id)
            if not job:
                break

            # Send any new events
            new_events = job.events[sent_events:]
            for evt in new_events:
                yield f"data: {json.dumps(evt)}\n\n"
                sent_events += 1

            # Check if job is done
            if job.status in ("completed", "partial", "blocked"):
                yield f"data: {json.dumps({'type': 'done', 'data': {'status': job.status}})}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/jobs/{job_id}/artifacts")
async def job_artifacts(job_id: str):
    """Get artifact manifest for a job."""
    store = get_job_store()
    job = await store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "job_id": job_id,
        "status": job.status,
        "model_url": job.current_model_url,
        "preview_url": job.model_preview_url,
        "judge": job.judge.__dict__ if job.judge else None,
        "attempts": [a.__dict__ for a in job.attempts],
    }


@app.get("/stub")
async def stub_page():
    """Serve the minimal integration stub HTML."""
    stub_path = os.path.join(STUB_DIR, "index.html")
    if os.path.exists(stub_path):
        with open(stub_path, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Stub not found</h1>", status_code=404)
