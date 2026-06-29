# Security

## Bring your own keys

NodeRL bundles **no API keys or secrets**. The trajectory recorder takes an injected reasoner
and substrate; the judges take an injected model client. You provide credentials via your own
environment (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`,
`BROWSERBASE_API_KEY`, `GEMINI_API_KEY`). NodeRL never logs raw keys; redact them in any
custom logging you add.

## Do not commit captured data

Trajectories and memory episodes can contain whatever your agent saw — PII, financial detail,
proprietary content. NodeRL's example corpora are **synthetic** or **public-benchmark fixtures**
only. If you persist real runs:

- Treat `nodemem` episode `rawText` and context-pack JSON as sensitive — apply your own
  redaction before storage or export.
- Do not publish raw capture screenshots/PDFs that contain confidential material; link to the
  upstream public source instead.

## Network egress

`nodetrace` substrates fetch external URLs. URL validation guards are included, but you are
responsible for SSRF posture in your deployment (allowlists, response-size caps, timeouts).

## Reporting

Open a private security advisory on the repo, or contact the maintainer directly. Do not file
public issues for vulnerabilities.
