"""GMI MaaS OpenAI-compatible client for chat and vision."""

import json
import logging
from typing import Optional

from openai import AsyncOpenAI

from .config import load_settings

logger = logging.getLogger(__name__)

_client: Optional[AsyncOpenAI] = None
_settings = None


def _get_client() -> AsyncOpenAI:
    global _client, _settings
    if _client is None:
        _settings = load_settings()
        _client = AsyncOpenAI(
            base_url=_settings.gmi_maas_base_url,
            api_key=_settings.gmi_maas_api_key or "missing-key",
        )
    return _client


async def gmi_chat(
    prompt: str,
    system: str = "You are a helpful 3D generation orchestrator.",
    model: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> str:
    """Text-only chat via GMI MaaS (Nemotron Ultra)."""
    client = _get_client()
    model = model or (_settings.orchestrator_model if _settings else "nvidia/nemotron-3-ultra")
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.error("gmi_chat error: %s", e)
        return ""


async def gmi_vision(
    image_url: str,
    prompt: str,
    model: Optional[str] = None,
    temperature: float = 0.5,
    max_tokens: int = 4096,
) -> str:
    """Vision (image+text) via GMI MaaS (Nemotron Nano Omni or Gemini fallback)."""
    client = _get_client()
    s = _settings or load_settings()
    model = model or s.vision_model
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": image_url}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.warning("gmi_vision primary model %s failed: %s — trying fallback", model, e)
        if s.fallback_vision_model and s.fallback_vision_model != model:
            try:
                resp = await client.chat.completions.create(
                    model=s.fallback_vision_model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": image_url}},
                                {"type": "text", "text": prompt},
                            ],
                        }
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return resp.choices[0].message.content or ""
            except Exception as e2:
                logger.error("gmi_vision fallback also failed: %s", e2)
        return ""


async def gmi_vision_json(
    image_url: str,
    prompt: str,
    model: Optional[str] = None,
) -> dict:
    """Vision call that expects JSON output. Parses and returns dict."""
    raw = await gmi_vision(image_url, prompt, model=model)
    if not raw:
        return {}
    # Try to extract JSON from the response
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Try to find JSON block
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start:end])
            except json.JSONDecodeError:
                pass
    logger.warning("gmi_vision_json: could not parse JSON from response")
    return {}
