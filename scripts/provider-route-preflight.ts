import "./benchmark/loadEnv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type PreflightReceipt = {
  schema: "provider-route-preflight-v1";
  generatedAt: string;
  provider: "openrouter";
  model?: string;
  minBalanceUsd: number;
  keyPresent: boolean;
  ok: boolean;
  status: "pass" | "fail" | "skipped";
  reason?: string;
  checks: Array<{
    name: string;
    ok: boolean;
    status?: number;
    detail?: Record<string, unknown>;
    error?: string;
  }>;
  officialDocs: string[];
};

const provider = optionValue("--provider") ?? "openrouter";
const model = optionValue("--model") ?? process.env.BENCH_AGENT_MODEL_POLICY ?? process.env.AGENT_TOP_PAID_MODEL ?? process.env.AGENT_MODEL;
const minBalanceUsd = numericOption("--min-balance-usd", Number(process.env.PROOFLOOP_PROVIDER_PREFLIGHT_MIN_USD ?? 1));
const jsonOut = optionValue("--json-out") ?? "docs/eval/provider-route-preflight.json";
const soft = process.argv.includes("--soft");

if (provider !== "openrouter") {
  const receipt = baseReceipt({ ok: false, status: "fail", reason: `unsupported_provider:${provider}`, checks: [] });
  writeReceipt(receipt);
  if (!soft) process.exit(1);
} else {
  const receipt = await openRouterPreflight();
  writeReceipt(receipt);
  console.log(`${receipt.status.toUpperCase()} provider preflight (${receipt.provider})${receipt.reason ? `: ${receipt.reason}` : ""}`);
  if (!receipt.ok && !soft) process.exit(1);
}

async function openRouterPreflight(): Promise<PreflightReceipt> {
  const key = process.env.OPENROUTER_API_KEY ?? "";
  if (!key) {
    return baseReceipt({
      ok: false,
      status: "fail",
      reason: "missing_OPENROUTER_API_KEY",
      checks: [{ name: "openrouter_api_key_present", ok: false }],
    });
  }

  const base = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${key}` };
  const checks: PreflightReceipt["checks"] = [{ name: "openrouter_api_key_present", ok: true }];

  const credits = await getJson(`${base}/credits`, headers);
  checks.push({
    name: "openrouter_credits",
    ok: credits.ok,
    status: credits.status,
    detail: credits.ok ? credits.json : undefined,
    error: credits.ok ? undefined : credits.error,
  });

  const keyInfo = await getJson(`${base}/key`, headers);
  checks.push({
    name: "openrouter_key",
    ok: keyInfo.ok,
    status: keyInfo.status,
    detail: keyInfo.ok ? keyInfo.json : undefined,
    error: keyInfo.ok ? undefined : keyInfo.error,
  });

  if (!credits.ok) {
    return baseReceipt({ ok: false, status: "fail", reason: providerFailureReason(credits.status, credits.error), checks });
  }

  const data = objectRecord(objectRecord(credits.json)?.data);
  const totalCredits = numberValue(data?.total_credits);
  const totalUsage = numberValue(data?.total_usage);
  const remaining = totalCredits === undefined || totalUsage === undefined ? undefined : totalCredits - totalUsage;
  checks.push({
    name: "openrouter_min_balance",
    ok: remaining !== undefined && remaining >= minBalanceUsd,
    detail: { totalCredits, totalUsage, remaining, minBalanceUsd },
  });

  if (remaining === undefined) {
    return baseReceipt({ ok: false, status: "fail", reason: "openrouter_credits_shape_unrecognized", checks });
  }
  if (remaining < minBalanceUsd) {
    return baseReceipt({ ok: false, status: "fail", reason: "provider_insufficient_credits", checks });
  }
  return baseReceipt({ ok: true, status: "pass", checks });
}

function baseReceipt(args: {
  ok: boolean;
  status: "pass" | "fail" | "skipped";
  reason?: string;
  checks: PreflightReceipt["checks"];
}): PreflightReceipt {
  return {
    schema: "provider-route-preflight-v1",
    generatedAt: new Date().toISOString(),
    provider: "openrouter",
    model,
    minBalanceUsd,
    keyPresent: Boolean(process.env.OPENROUTER_API_KEY),
    ok: args.ok,
    status: args.status,
    reason: args.reason,
    checks: args.checks,
    officialDocs: [
      "https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits",
      "https://openrouter.ai/docs/api/reference/limits",
    ],
  };
}

async function getJson(url: string, headers: Record<string, string>): Promise<
  | { ok: true; status: number; json: unknown }
  | { ok: false; status?: number; error: string }
> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    let json: unknown = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = { raw: text.slice(0, 500) }; }
    if (!response.ok) return { ok: false, status: response.status, error: `${response.status}:${JSON.stringify(json).slice(0, 500)}` };
    return { ok: true, status: response.status, json };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function providerFailureReason(status: number | undefined, error: string): string {
  if (status === 401) return "provider_auth_required";
  if (status === 402) return "provider_insufficient_credits";
  if (status === 403) return "provider_forbidden_or_management_key_required";
  return `provider_preflight_failed:${error.slice(0, 120)}`;
}

function writeReceipt(receipt: PreflightReceipt): void {
  const path = resolve(process.cwd(), jsonOut);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = process.argv.indexOf(name);
  const next = process.argv[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function numericOption(name: string, fallback: number): number {
  const raw = Number(optionValue(name) ?? fallback);
  return Number.isFinite(raw) ? Math.max(0, raw) : fallback;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
