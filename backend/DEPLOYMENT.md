# GMI AgentBox Deployment Checklist

## Pre-deployment

1. **Set all required environment variables** in your deployment platform:
   - `GMI_MAAS_BASE_URL` — GMI MaaS API base URL
   - `GMI_MAAS_API_KEY` — GMI MaaS API key
   - `VISION_MODEL` — VLM model ID (default: `nvidia/nemotron-3-nano-omni`)
   - `ORCHESTRATOR_MODEL` — LLM model ID (default: `nvidia/nemotron-3-ultra`)
   - `FALLBACK_VISION_MODEL` — Fallback VLM (default: `google/gemini-3-flash-preview`)

2. **Set GPU worker endpoints** (if available):
   - `HUNYUAN3D_ENDPOINT` + `HUNYUAN3D_API_KEY`
   - `TRELLIS_ENDPOINT` + `TRELLIS_API_KEY`
   - `PARTPACKER_ENDPOINT` + `PARTPACKER_API_KEY` (optional)
   - `PARTCRAFTER_ENDPOINT` + `PARTCRAFTER_API_KEY` (optional)

3. **Set optional services**:
   - `TAVILY_API_KEY` — for context search (graceful skip if missing)
   - `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` — for tracing
   - `REDIS_URL` — for persistent job state (in-memory if missing)

4. **Set runtime config**:
   - `MAX_GENERATION_ATTEMPTS` — max retry attempts (default: 2)
   - `ENABLE_PART_AWARE_LANES` — enable PartPacker/PartCrafter (default: false)

## Build & Deploy

```bash
# Build
docker build -t photo-to-3d-backend .

# Run locally
docker run -p 8080:8080 --env-file .env photo-to-3d-backend

# Or deploy to your platform of choice
```

## Post-deployment Verification

1. **Health check**:
   ```bash
   curl https://your-endpoint/health
   # → { "ok": true }
   ```

2. **Credential check**:
   ```bash
   curl https://your-endpoint/credentials
   # → { "credentials": [{ "name": "GMI_MAAS_API_KEY", "present": true }, ...] }
   ```

3. **End-to-end test**:
   ```bash
   curl -F photo=@test.jpg https://your-endpoint/run
   # → { "job_id": "job_...", "status": "queued", "message": "..." }
   ```

4. **SSE stream**:
   ```bash
   curl -N https://your-endpoint/jobs/{job_id}/events
   ```

5. **Stub page**:
   - Visit `https://your-endpoint/stub` in a browser

## GMI AgentBox Registration

1. Ensure the service is accessible at a public URL
2. Register the following endpoints with AgentBox:
   - `POST /run` — start a job
   - `GET /jobs/{job_id}` — poll job status
   - `GET /jobs/{job_id}/events` — SSE stream
   - `GET /jobs/{job_id}/artifacts` — get artifacts
   - `GET /health` — health check
3. Configure the AgentBox to forward `GMI_MAAS_*` environment variables
4. Set `LANGSMITH_PROJECT` to your preferred LangSmith project name

## Monitoring

- **LangSmith**: View traces at `https://smith.langchain.com` under your project
- **Logs**: `docker logs photo-to-3d-backend`
- **Credential status**: `GET /credentials` (never exposes values)
