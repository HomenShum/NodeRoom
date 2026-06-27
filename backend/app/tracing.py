"""LangSmith tracing setup and helpers."""

import logging
import os
from contextlib import contextmanager
from typing import Optional

from .config import load_settings

logger = logging.getLogger(__name__)

_settings = None
_tracing_enabled = False


def setup_tracing():
    """Enable LangSmith tracing if configured."""
    global _settings, _tracing_enabled
    _settings = load_settings()

    if _settings.langsmith_tracing and _settings.langsmith_api_key:
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGSMITH_API_KEY"] = _settings.langsmith_api_key
        os.environ["LANGSMITH_PROJECT"] = _settings.langsmith_project
        _tracing_enabled = True
        logger.info("LangSmith tracing enabled — project: %s", _settings.langsmith_project)
    else:
        logger.info("LangSmith tracing disabled (LANGSMITH_TRACING not set or key missing)")


def is_tracing_enabled() -> bool:
    return _tracing_enabled


@contextmanager
def trace_context(**kwargs):
    """Context manager that logs trace metadata.

    Usage:
        with trace_context(job_id=job_id, lane="hunyuan"):
            ... do work ...
    """
    if _tracing_enabled:
        logger.debug("trace_context: %s", kwargs)
    yield
