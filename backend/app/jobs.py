"""JobState dataclass and job store (in-memory or Redis)."""

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Optional

from .config import load_settings


@dataclass
class Attempt:
    id: str = ""
    source: str = ""           # hunyuan, trellis, partpacker, partcrafter, fallback
    status: str = "pending"    # pending, running, completed, blocked
    score: float = 0.0
    model_url: str = ""
    preview_url: str = ""
    note: str = ""


@dataclass
class JudgeReport:
    score: float = 0.0
    verdict: str = ""          # match, partial, mismatch
    what_matches: list[str] = field(default_factory=list)
    what_is_wrong: list[str] = field(default_factory=list)
    recommendation: str = ""


@dataclass
class JobState:
    job_id: str = ""
    status: str = "queued"     # queued, understanding, searching, planning, generating, comparing, completed, partial, blocked
    progress: int = 0
    simple_message: str = ""
    source_photo_url: str = ""
    current_model_url: str = ""
    model_preview_url: str = ""
    compare_image_url: str = ""
    judge: Optional[JudgeReport] = None
    attempts: list[Attempt] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    events: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("events", None)  # events are internal
        return d

    def add_event(self, event_type: str, data: dict | None = None) -> dict:
        evt = {"type": event_type, "data": data or {}, "ts": time.time()}
        self.events.append(evt)
        self.updated_at = time.time()
        return evt


class JobStore:
    """In-memory job store. Redis backend when REDIS_URL is set."""

    def __init__(self):
        self._jobs: dict[str, JobState] = {}
        self._lock = asyncio.Lock()
        self._settings = load_settings()
        self._redis = None
        if self._settings.redis_url:
            try:
                import redis.asyncio as aioredis
                self._redis = aioredis.from_url(self._settings.redis_url)
            except ImportError:
                pass  # fall back to in-memory

    async def create_job(self, source_photo_url: str) -> JobState:
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        job = JobState(job_id=job_id, source_photo_url=source_photo_url)
        async with self._lock:
            self._jobs[job_id] = job
        return job

    async def get_job(self, job_id: str) -> Optional[JobState]:
        async with self._lock:
            return self._jobs.get(job_id)

    async def update_job(self, job_id: str, **kwargs) -> Optional[JobState]:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            for k, v in kwargs.items():
                if k == "judge" and isinstance(v, JudgeReport):
                    job.judge = v
                elif k == "judge" and isinstance(v, dict):
                    job.judge = JudgeReport(**v)
                elif hasattr(job, k):
                    setattr(job, k, v)
            job.updated_at = time.time()
            return job

    async def add_event(self, job_id: str, event_type: str, data: dict | None = None) -> Optional[dict]:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            return job.add_event(event_type, data)


# Singleton
_store: Optional[JobStore] = None


def get_job_store() -> JobStore:
    global _store
    if _store is None:
        _store = JobStore()
    return _store
