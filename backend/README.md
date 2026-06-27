# Photo-to-3D Proof Agent — Backend

FastAPI + LangGraph orchestrator for photo-to-3D generation with visual judging.

## Quick Start

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env  # fill in your keys
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## API Contract

```
POST /run                          → 202 { job_id, status, message }
GET  /jobs/{job_id}                → job state + judge + attempts
GET  /jobs/{job_id}/events         → SSE stream
GET  /jobs/{job_id}/artifacts      → artifact manifest
GET  /health                       → { ok: true }
GET  /credentials                  → { credentials: [{ name, present }] }
GET  /stub                         → HTML integration stub
```

### POST /run

Upload a photo and start a 3D generation job.

```bash
curl -F photo=@test.jpg http://localhost:8080/run
curl -F photo=@test.jpg -F "prompt=a person in a black jacket" http://localhost:8080/run
```

Response: `202 { "job_id": "job_abc123", "status": "queued", "message": "Photo received. Generation started." }`

### GET /jobs/{job_id}

```json
{
  "job_id": "job_123",
  "status": "comparing",
  "progress": 72,
  "simple_message": "Comparing the 3D model to the photo.",
  "source_photo_url": "https://...",
  "current_model_url": "https://...",
  "model_preview_url": "https://...",
  "compare_image_url": "",
  "judge": {
    "score": 0.72,
    "verdict": "partial",
    "what_matches": ["black outfit", "long hair", "human silhouette"],
    "what_is_wrong": ["face detail is weak", "hands are noisy"],
    "recommendation": "Try tighter crop and stronger clothing prompt."
  },
  "attempts": [
    {
      "id": "att_001",
      "source": "hunyuan",
      "status": "completed",
      "score": 0.72,
      "model_url": "https://...",
      "preview_url": "https://...",
      "note": "Hunyuan3D generated GLB"
    }
  ]
}
```

### SSE Events

```
photo_received | understanding_image | context_searched | planning_parts
| generation_started | model_ready | compare_started | judge_ready
| improvement_started | completed | partial | blocked
```

Each event: `data: {"type": "...", "data": {"progress": 42, "node": "..."}, "ts": 1234567890}`

## Architecture

```
Browser → AgentBox orchestrator (FastAPI :8080)
  → GMI MaaS (OpenAI-compatible) for LLM/VLM
  → Tavily Search for context gathering
  → GPU workers (external HTTP endpoints)
    → Hunyuan3D worker
    → TRELLIS worker
    → PartPacker worker (optional)
    → PartCrafter worker (optional)
  → LangSmith traces
  → Redis (job state) or in-memory (dev)
```

### LangGraph State Machine

```
ReceiveImage → ImageUnderstanding → SearchContext → PartPlan
→ RouteGeneration → RunGeneration → ValidateImport
→ RenderSnapshots → VisualJudge → RetryDecision
  ├── score low + budget → retry with improved prompt
  ├── Hunyuan blocked → TRELLIS fallback
  ├── part-aware enabled → PartPacker/PartCrafter
  └── acceptable → SelectBest → PackageArtifacts → CompleteJob
```

## Environment Variables

See `.env.example` for the full list. Key ones:

| Variable | Purpose |
|----------|---------|
| `GMI_MAAS_BASE_URL` | GMI MaaS API base URL |
| `GMI_MAAS_API_KEY` | GMI MaaS API key |
| `VISION_MODEL` | VLM model for image understanding + judge |
| `ORCHESTRATOR_MODEL` | LLM model for part planning |
| `HUNYUAN3D_ENDPOINT` | Hunyuan3D worker URL |
| `TRELLIS_ENDPOINT` | TRELLIS worker URL |
| `TAVILY_API_KEY` | Tavily search API key (optional) |
| `LANGSMITH_TRACING` | Enable LangSmith tracing |
| `MAX_GENERATION_ATTEMPTS` | Max retry attempts (default: 2) |
| `ENABLE_PART_AWARE_LANES` | Enable PartPacker/PartCrafter (default: false) |

## Credential Safety

The backend **never logs API key values**. Use `GET /credentials` to check which
credentials are present (returns `{name, present}` only).

## Tests

```bash
cd backend
pytest tests/ -v
```

## Docker

```bash
docker build -t photo-to-3d-backend .
docker run -p 8080:8080 --env-file .env photo-to-3d-backend
```

## Integration Stub

Visit `http://localhost:8080/stub` for a minimal HTML page that demonstrates
the full upload → poll → show model + judge flow.

## Known Limitations

- Live Hunyuan/TRELLIS generation blocked if endpoints/keys missing → fallback GLB used
- Fallback GLB is eyewear, not the user's photo subject
- No real model screenshot rendering (placeholder previews)
- PartPacker/PartCrafter adapters are scaffolds — they call external endpoints but don't include worker Dockerfiles
- Visual judge uses VLM comparison, not deterministic pixel diff
- Tavily search is optional — if key missing, LLM reasoning alone drives part planning
