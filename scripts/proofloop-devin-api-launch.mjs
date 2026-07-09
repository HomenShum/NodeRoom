#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const promptPath = optionValue(args, "--prompt-file");
const exportPath = optionValue(args, "--export");
const runDir = optionValue(args, "--run-dir") ?? process.env.PROOFLOOP_AGENT_RUN_DIR;

if (!promptPath || !exportPath) {
  console.error("usage: proofloop-devin-api-launch --prompt-file <file> --export <file> [--run-dir <dir>]");
  process.exit(2);
}
if (!existsSync(promptPath)) {
  console.error(`prompt file missing: ${promptPath}`);
  process.exit(2);
}

const prompt = readFileSync(promptPath, "utf8");
const apiKey = process.env.PROOFLOOP_DEVIN_API_KEY || process.env.DEVIN_API_KEY;
const orgId = process.env.PROOFLOOP_DEVIN_ORG_ID || process.env.DEVIN_ORG_ID;
const baseUrl = (process.env.PROOFLOOP_DEVIN_API_BASE_URL || process.env.DEVIN_API_BASE_URL || "https://api.devin.ai").replace(/\/$/, "");
const dryRun = process.env.PROOFLOOP_DEVIN_API_DRY_RUN === "1";

if (!dryRun && (!apiKey || !orgId)) {
  console.error("Hosted Devin API launch requires PROOFLOOP_DEVIN_API_KEY/DEVIN_API_KEY and PROOFLOOP_DEVIN_ORG_ID/DEVIN_ORG_ID.");
  process.exit(2);
}

const startedAt = new Date().toISOString();
const payload = buildPayload(prompt);
const response = dryRun
  ? {
      ok: true,
      status: 200,
      body: {
        session_id: "dry-run-devin-session",
        url: "https://app.devin.ai/sessions/dry-run-devin-session",
        title: payload.title,
        tags: payload.tags,
      },
    }
  : await createSession({ baseUrl, orgId, apiKey, payload });
const finishedAt = new Date().toISOString();
const sessionId = stringValue(response.body?.session_id);
mkdirSync(dirname(exportPath), { recursive: true });
writeFileSync(exportPath, `${JSON.stringify({
  schema: "proofloop-devin-api-session-export-v1",
  host: "devin-api",
  startedAt,
  finishedAt,
  runDir,
  promptPath,
  endpoint: dryRun ? "dry-run" : `${baseUrl}/v3/organizations/${orgId}/sessions`,
  dryRun,
  request: redactPayload(payload),
  response,
  sessionId,
  sessionUrl: stringValue(response.body?.url),
}, null, 2)}\n`, "utf8");

if (!response.ok) {
  console.error(`Devin API launch failed with HTTP ${response.status}`);
  console.error(JSON.stringify(response.body));
  process.exit(1);
}
console.log(`Devin API session created: ${sessionId ?? "(unknown session id)"}`);
process.exit(0);

async function createSession(input) {
  const res = await fetch(`${input.baseUrl}/v3/organizations/${input.orgId}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.payload),
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    body: parseJson(text),
  };
}

function buildPayload(prompt) {
  const repos = csv(process.env.PROOFLOOP_DEVIN_REPOS || process.env.DEVIN_REPOS);
  const secretIds = csv(process.env.PROOFLOOP_DEVIN_SECRET_IDS || process.env.DEVIN_SECRET_IDS);
  const knowledgeIds = csv(process.env.PROOFLOOP_DEVIN_KNOWLEDGE_IDS || process.env.DEVIN_KNOWLEDGE_IDS);
  const tags = ["proofloop", ...(csv(process.env.PROOFLOOP_DEVIN_TAGS || process.env.DEVIN_TAGS))];
  const maxAcuLimit = numberValue(process.env.PROOFLOOP_DEVIN_MAX_ACU || process.env.DEVIN_MAX_ACU);
  const payload = {
    prompt,
    title: process.env.PROOFLOOP_DEVIN_TITLE || "ProofLoop repair session",
    tags,
    resumable: true,
    structured_output_required: false,
  };
  if (repos.length) payload.repos = repos;
  if (secretIds.length) payload.secret_ids = secretIds;
  if (knowledgeIds.length) payload.knowledge_ids = knowledgeIds;
  if (maxAcuLimit !== undefined) payload.max_acu_limit = maxAcuLimit;
  if (process.env.PROOFLOOP_DEVIN_MODE) payload.devin_mode = process.env.PROOFLOOP_DEVIN_MODE;
  if (process.env.PROOFLOOP_DEVIN_PLATFORM) payload.platform = process.env.PROOFLOOP_DEVIN_PLATFORM;
  if (process.env.PROOFLOOP_DEVIN_PLAYBOOK_ID) payload.playbook_id = process.env.PROOFLOOP_DEVIN_PLAYBOOK_ID;
  return payload;
}

function redactPayload(payload) {
  return {
    ...payload,
    prompt: `[redacted:${String(payload.prompt ?? "").length} chars]`,
  };
}

function optionValue(values, name) {
  const inline = values.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = values.indexOf(name);
  const next = values[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function csv(value) {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function numberValue(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value) {
  return typeof value === "string" && value.length ? value : undefined;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
