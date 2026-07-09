# Free-First Production Provider Research

Date: 2026-07-08

This packet maps free or free-tier provider options onto NodeRoom's production
service lanes. "Free" here is intentionally split into three categories:

- Browser/local free: no hosted provider bill, but depends on client or local
  machine capability.
- Hosted free tier: free within quota, then blocked or billable.
- Prototype/free endpoint: working public endpoint, but not an SLA-backed
  production contract.

NodeRoom governance remains binding: free providers must not bypass Convex room
authorization, RoomCommand routing, NodeAgent execution, proposal confirmation,
or no-clobber protections.

## Current NodeRoom Lanes

| Lane | Current provider state | Free status |
|---|---|---|
| Web app hosting | Vercel production app | Free-tier capable on Hobby limits |
| Live room ledger | Convex managed deployment | Free-tier capable while under limits |
| Coordinator / NodeAgent LLM | OpenRouter, OpenAI, Gemini, Anthropic, Nebius adapters | OpenRouter free routes already supported |
| Voice STT | Convex `/voice/transcribe`, currently Nvidia when `VOICE_STT_PROVIDER=nvidia` | Nvidia prototype/free endpoint, prod-proofed |
| Voice TTS | Convex `/voice/synthesize`, OpenAI `gpt-4o-mini-tts` | Not free |
| Browser voice fallback | Web Speech API adapters | Free, browser-dependent |
| Local voice fallback | faster-whisper and Piper proof scripts | Free software, compute required |
| Embeddings | OKF provider: OpenAI, Gemini, or local hashing | Local hashing is free |
| Search/capture tooling | Optional Firecrawl / provider-specific scripts | Free-tier options exist, not guaranteed at scale |
| Analytics | Optional, outside live mutation path | Free options exist; ClickHouse Cloud is trial/paid |

## Proof Snapshot

Artifacts:

- `.proofloop/runs/voice-prod-deploy/latest/receipt.json`
- `.proofloop/runs/voice-free-audio-live/latest/receipt.json`

Production proof, run `20260708T212538Z`:

- `https://noderoom.live` root and story route passed.
- Convex voice endpoints fail closed before provider calls.
- Live STT roundtrip returned `provider: nvidia`.
- Live STT model: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`.
- TTS roundtrip still returned OpenAI-backed `audio/mpeg`.

Free audio live proof, run `20260708T214433Z`:

- Browser `speechSynthesis` passed.
- Local faster-whisper STT passed.
- Local Piper TTS passed.
- OpenRouter dedicated STT had zero zero-priced candidates.
- OpenRouter `/audio/speech` had zero zero-priced candidates.
- OpenRouter audio-input chat still failed with "no audio attached" behavior.

## Recommended Free-First Stack

| Lane | Recommended free-first default | Fallback | Notes |
|---|---|---|---|
| Hosting | Keep Vercel Hobby while limits fit | Cloudflare Pages | Cloudflare Pages/Workers give a strong free bundle, but migration is not needed yet. |
| Live room ledger | Keep Convex Free/Starter managed | Self-host Convex | Self-hosting is only "free" if we already own compute; managed Convex is safer for now. |
| Coordinator LLM | OpenRouter `openrouter/free` plus pinned free models | Gemini free tier, Groq free plan, paid escape hatch | Keep provider egress controls and file-egress guardrails. |
| Voice STT | Nvidia direct prototype/free endpoint | Browser SpeechRecognition, Cloudflare Whisper, Groq Whisper, local faster-whisper, OpenAI paid | Nvidia prod path is proven; local proof needs local key only because prod key is stored in Convex. |
| Voice TTS | Browser `speechSynthesis` for default narration | Gemini TTS preview free tier, Cloudflare MeloTTS, Google Cloud TTS free quota, local Piper, OpenAI paid | Hosted free-tier TTS must be quota-guarded and fail closed in free-only mode until explicitly confirmed. |
| Embeddings | Existing local hashing fallback | Cloudflare BGE-M3 or Gemini embedding free tier | Do not add a required hosted embedding dependency for the live room ledger. |
| Search/capture | Native fetch/readability where enough | Firecrawl/Tavily/SerpAPI/Brave free credits | Keep optional; never put third-party scraping in live mutation path. |
| Analytics | Cloudflare Web Analytics or PostHog free tier | Self-host Plausible; ClickHouse only off-path | Analytics must remain outside live room mutations. |

## Provider Findings

### Hosting

- Vercel Hobby is free for personal/small-scale projects with included monthly
  usage, but Hobby is not a commercial production SLA.
- Cloudflare Pages is a strong free static hosting candidate with free custom
  domains and high static delivery limits.
- Cloudflare Workers Free can also host a small AI proxy or provider bridge, but
  function limits and Workers AI quotas become the real constraint.

Decision: keep Vercel for now. Consider Cloudflare only if we decide to put
Workers AI behind a provider gateway.

### Convex / Room Ledger

- Convex managed Free/Starter provides built-in resources.
- Convex can also be self-hosted, but that shifts operational burden onto us.

Decision: do not replace Convex. The managed deployment remains the source of
truth. Self-host Convex is a future cost-control option, not the default.

### Coordinator / NodeAgent LLM

- OpenRouter currently exposes multiple zero-priced text models and
  `openrouter/free`.
- Gemini API has free-tier models, but free-tier data handling differs from paid
  tier and must be considered provider egress.
- Groq exposes a free plan with published rate limits and fast open-model
  inference, useful as an additional text/STT provider.
- Cloudflare Workers AI offers a daily free allocation and can cover text,
  embeddings, STT, and TTS behind a single edge service.

Decision: keep OpenRouter free as the default free coordinator lane because the
repo already has routing/proof hooks. Add Cloudflare/Groq only as separate,
proofed adapters.

### STT

Viable free/free-tier options:

- Nvidia `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`: direct endpoint
  prod-proofed for browser-recorded audio. Classification: prototype/free
  endpoint.
- Browser `SpeechRecognition`: free, but limited availability and not a
  deterministic server-side proof target.
- Local faster-whisper / whisper.cpp: free software, strong fallback for local or
  self-hosted environments.
- Cloudflare Workers AI Whisper: free within Workers AI daily allocation; paid
  by audio minute after that.
- Groq Whisper: free-plan rate limited; useful as a low-latency hosted STT
  fallback.
- Google Cloud STT: 60 minutes/month free tier; paid beyond quota.

Rejected as default:

- OpenRouter audio-input chat. Catalog shows one zero-priced candidate, but live
  proof returned "no audio attached" instead of a verified transcript.
- OpenRouter dedicated STT. Catalog currently has no zero-priced transcription
  models.

### TTS

Viable free/free-tier options:

- Browser `speechSynthesis`: immediate free default for browser narration;
  proof passed. Voice quality and voice list depend on client OS/browser.
- Local Piper: proof passed with generated WAV and roundtrip transcript. Best
  self-host/local option.
- Gemini API TTS preview: documented free-tier option for text-to-audio
  generation. Use only behind a provider egress decision because the free tier
  may have different data-use terms from paid API traffic.
- Cloudflare Workers AI MeloTTS: hosted TTS with Workers AI free allocation.
  Good candidate for replacing OpenAI TTS in the Convex fallback path if we add
  a Cloudflare provider adapter.
- Google Cloud TTS: monthly free character quota for Standard/WaveNet voices.
  Requires Google Cloud billing setup and quota controls.
- eSpeak NG: robust free fallback for accessibility/debug audio, but voice
  quality is not product-grade.
- MeloTTS open source: possible local/self-host option, heavier than Piper.

Rejected as default:

- OpenRouter `/audio/speech`. Catalog currently has zero zero-priced speech/TTS
  models.
- Groq Orpheus as a "free" default. Groq has a free API key/free plan, but
  Orpheus pricing is character-based; use only if a live proof confirms free
  plan behavior for our expected volume.

### Embeddings

Viable free/free-tier options:

- Existing local hashing vector fallback. Deterministic, zero provider cost.
- Cloudflare Workers AI BGE-M3 under Workers AI free allocation.
- Gemini embedding free tier for experiments, with paid scale-up path.

Decision: keep local hashing as the default for free production. Use hosted
embeddings only for quality upgrades and record provider egress.

### Search / Capture / Research Tools

Viable free-tier options:

- Firecrawl: monthly free page credits.
- Tavily: monthly free API credits.
- SerpAPI: small monthly free search quota.
- Brave Search API: monthly free credits, then metered.
- Native fetch/Playwright/readability: free except our compute and egress.

Decision: keep these optional. They must not enter the live mutation path.

### Analytics

Viable free/free-tier options:

- Cloudflare Web Analytics: free privacy-first web analytics.
- PostHog: generous free tier with billing limits available.
- Plausible Community Edition: self-hosted free software.
- ClickHouse self-hosted: free software, but compute/ops are ours.

Rejected as free default:

- ClickHouse Cloud. It is a trial/paid managed product, not a permanent free
  production lane.

## Implementation Plan

1. Add provider policy config:
   - `VOICE_STT_PROVIDER_ORDER=nvidia,browser,cloudflare,groq,local,openai`
   - `VOICE_TTS_PROVIDER_ORDER=browser,cloudflare,google,piper,openai`
   - `NODEAGENT_FREE_PROVIDER_ORDER=openrouter,gemini,groq,cloudflare`

2. Make browser TTS the first narration path:
   - Use `speechSynthesis` for committed room events and agent responses.
   - Call Convex `/voice/synthesize` only when browser TTS is unavailable or
     user explicitly selects hosted voice.

3. Add hosted free TTS adapters:
   - First Gemini TTS preview, because the existing Google key path is already
     used by NodeRoom and the API has an explicit free tier.
   - Then Cloudflare Workers AI MeloTTS, because it also covers STT and
     embeddings under one free allocation.
   - Then Google Cloud TTS with strict monthly quota env and hard stop.
   - Keep every hosted free-tier adapter behind an explicit confirmation env in
     `NODEROOM_FREE_ONLY=1` so a quota/billing setup cannot silently become the
     default.

4. Add hosted free STT adapters:
   - Keep Nvidia as current prod default while it remains proofed.
   - Add Cloudflare Whisper.
   - Add Groq Whisper.
   - Keep OpenAI paid fallback disabled by default in "free-only" mode.

5. Add free-only runtime mode:
   - `NODEROOM_FREE_ONLY=1`
   - If enabled, any paid provider route must fail closed with a visible reason
     and proof receipt entry.

6. Add proof gates:
   - `voice:free-audio:live-proof` must pass at least one hosted or browser STT
     and one browser/local/hosted TTS lane.
   - `voice:prod-deploy:proof --real-provider` must record `provider`,
     `model`, status, bytes/duration, and governance checks.
   - A new `free-provider:prod-proof` should assert no paid provider was used in
     free-only mode.

## Source Index

- Nvidia Nemotron model page: `https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`
- OpenRouter free router: `https://openrouter.ai/openrouter/free`
- OpenRouter audio docs: `https://openrouter.ai/docs/guides/overview/multimodal/audio`
- OpenRouter STT docs: `https://openrouter.ai/docs/guides/overview/multimodal/stt`
- OpenRouter TTS docs: `https://openrouter.ai/docs/guides/overview/multimodal/tts`
- Convex pricing: `https://www.convex.dev/pricing`
- Convex self-hosting: `https://docs.convex.dev/self-hosting`
- Vercel Hobby: `https://vercel.com/docs/plans/hobby`
- Cloudflare Workers AI pricing: `https://developers.cloudflare.com/workers-ai/platform/pricing/`
- Cloudflare Whisper: `https://developers.cloudflare.com/workers-ai/models/whisper/`
- Cloudflare MeloTTS: `https://developers.cloudflare.com/workers-ai/models/melotts/`
- Cloudflare BGE-M3: `https://developers.cloudflare.com/workers-ai/models/bge-m3/`
- Cloudflare Pages/Workers pricing: `https://developers.cloudflare.com/workers/platform/pricing/`
- Google Cloud STT pricing: `https://cloud.google.com/speech-to-text/pricing`
- Google Cloud TTS pricing: `https://cloud.google.com/text-to-speech/pricing`
- Gemini TTS docs: `https://ai.google.dev/gemini-api/docs/speech-generation`
- Gemini API pricing: `https://ai.google.dev/gemini-api/docs/pricing`
- Groq rate limits: `https://console.groq.com/docs/rate-limits`
- Groq TTS docs: `https://console.groq.com/docs/text-to-speech`
- Hugging Face Inference Providers pricing: `https://huggingface.co/docs/inference-providers/en/pricing`
- MDN Web Speech API: `https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API`
- Piper: `https://github.com/rhasspy/piper`
- Piper current fork: `https://github.com/OHF-voice/piper1-gpl`
- whisper.cpp: `https://github.com/ggml-org/whisper.cpp`
- eSpeak NG: `https://github.com/espeak-ng/espeak-ng`
- MeloTTS: `https://github.com/myshell-ai/MeloTTS`
- Firecrawl pricing: `https://www.firecrawl.dev/pricing`
- Tavily credits: `https://docs.tavily.com/documentation/api-credits`
- SerpAPI pricing: `https://serpapi.com/pricing`
- Brave Search API pricing: `https://api-dashboard.search.brave.com/documentation/pricing`
- Cloudflare Web Analytics: `https://developers.cloudflare.com/web-analytics/`
- PostHog pricing: `https://posthog.com/pricing`
- Plausible self-hosted: `https://plausible.io/self-hosted-web-analytics`
- ClickHouse pricing: `https://clickhouse.com/pricing`
