"""Environment variable loading and credential safety.

Never logs key values. Only logs present=true/false.
"""

import os
from dataclasses import dataclass
from typing import Optional

# --- Credential names that must never be logged as values ---
_SECRET_NAMES = {
    "GMI_MAAS_API_KEY",
    "HUNYUAN3D_API_KEY",
    "TRELLIS_API_KEY",
    "PARTPACKER_API_KEY",
    "PARTCRAFTER_API_KEY",
    "TAVILY_API_KEY",
    "LANGSMITH_API_KEY",
}


@dataclass
class Settings:
    # GMI MaaS
    gmi_maas_base_url: str
    gmi_maas_api_key: str
    vision_model: str
    orchestrator_model: str
    fallback_vision_model: str

    # GPU model workers
    hunyuan3d_endpoint: str
    hunyuan3d_api_key: str
    trellis_endpoint: str
    trellis_api_key: str
    partpacker_endpoint: str
    partpacker_api_key: str
    partcrafter_endpoint: str
    partcrafter_api_key: str

    # Web search
    tavily_api_key: str

    # Observability
    langsmith_tracing: bool
    langsmith_api_key: str
    langsmith_project: str

    # Storage / state
    artifact_bucket: str
    artifact_public_base_url: str
    redis_url: str

    # Runtime
    max_generation_attempts: int
    enable_part_aware_lanes: bool


def _get(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def _get_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except (ValueError, TypeError):
        return default


def _get_bool(key: str, default: bool = False) -> bool:
    return os.environ.get(key, str(default)).lower() in ("true", "1", "yes")


def load_settings() -> Settings:
    return Settings(
        gmi_maas_base_url=_get("GMI_MAAS_BASE_URL", "https://api.gmi-serving.com/v1"),
        gmi_maas_api_key=_get("GMI_MAAS_API_KEY"),
        vision_model=_get("VISION_MODEL", "nvidia/nemotron-3-nano-omni"),
        orchestrator_model=_get("ORCHESTRATOR_MODEL", "nvidia/nemotron-3-ultra"),
        fallback_vision_model=_get("FALLBACK_VISION_MODEL", "google/gemini-3-flash-preview"),
        hunyuan3d_endpoint=_get("HUNYUAN3D_ENDPOINT", "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests"),
        hunyuan3d_api_key=_get("HUNYUAN3D_API_KEY"),
        trellis_endpoint=_get("TRELLIS_ENDPOINT"),
        trellis_api_key=_get("TRELLIS_API_KEY"),
        partpacker_endpoint=_get("PARTPACKER_ENDPOINT"),
        partpacker_api_key=_get("PARTPACKER_API_KEY"),
        partcrafter_endpoint=_get("PARTCRAFTER_ENDPOINT"),
        partcrafter_api_key=_get("PARTCRAFTER_API_KEY"),
        tavily_api_key=_get("TAVILY_API_KEY"),
        langsmith_tracing=_get_bool("LANGSMITH_TRACING", False),
        langsmith_api_key=_get("LANGSMITH_API_KEY"),
        langsmith_project=_get("LANGSMITH_PROJECT", "photo-to-3d-proof-agent"),
        artifact_bucket=_get("ARTIFACT_BUCKET"),
        artifact_public_base_url=_get("ARTIFACT_PUBLIC_BASE_URL"),
        redis_url=_get("REDIS_URL"),
        max_generation_attempts=_get_int("MAX_GENERATION_ATTEMPTS", 2),
        enable_part_aware_lanes=_get_bool("ENABLE_PART_AWARE_LANES", False),
    )


def check_credential(name: str) -> dict:
    """Return {name, present} — never the value."""
    val = os.environ.get(name, "")
    return {"name": name, "present": bool(val)}


def credential_report() -> list[dict]:
    """Return list of {name, present} for all known credentials."""
    all_creds = sorted(_SECRET_NAMES | {
        "GMI_MAAS_BASE_URL",
        "HUNYUAN3D_ENDPOINT",
        "TRELLIS_ENDPOINT",
        "PARTPACKER_ENDPOINT",
        "PARTCRAFTER_ENDPOINT",
        "ARTIFACT_BUCKET",
        "ARTIFACT_PUBLIC_BASE_URL",
        "REDIS_URL",
    })
    return [check_credential(n) for n in all_creds]


def get_secret(name: str) -> Optional[str]:
    """Get a secret value. Only call this where you actually need the value."""
    if name not in _SECRET_NAMES:
        raise ValueError(f"{name} is not a known secret")
    val = os.environ.get(name, "")
    return val if val else None
