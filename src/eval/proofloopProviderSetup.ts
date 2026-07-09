import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Socket } from "node:net";
import { dirname, join } from "node:path";
import { listNebiusModels, sanitizeNebiusError } from "../lib/models/providers/nebius";

export const PROOFLOOP_PROVIDER_IDS = ["butterbase", "neo4j", "rocketride", "daytona", "cognee", "nebius", "opsera"] as const;

export type ProofloopProviderId = (typeof PROOFLOOP_PROVIDER_IDS)[number];
export type ProofloopProviderSetupStatus = "ready" | "needs_credentials" | "needs_adapter" | "blocked";

export type ProofloopProviderSetupCheck = {
  id: string;
  status: ProofloopProviderSetupStatus;
  detail: string;
};

export type ProofloopProviderSetupReceipt = {
  schema: "proofloop-provider-setup-v1";
  providerId: ProofloopProviderId;
  generatedAt: string;
  status: ProofloopProviderSetupStatus;
  env: {
    required: string[];
    optional: string[];
    present: string[];
    missing: string[];
  };
  checks: ProofloopProviderSetupCheck[];
  nextCommands: string[];
};

export type ProofloopProviderSetupOptions = {
  root?: string;
  env?: NodeJS.ProcessEnv;
  generatedAt?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function setupProofloopProvider(
  providerId: ProofloopProviderId,
  options: ProofloopProviderSetupOptions = {},
): Promise<ProofloopProviderSetupReceipt> {
  const env = options.env ?? process.env;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const required = requiredEnvForProvider(providerId, env);
  const optional = optionalEnvForProvider(providerId);
  const present = [...required, ...optional].filter((name) => Boolean(env[name]?.trim()));
  const missing = required.filter((name) => !env[name]?.trim());
  const checks: ProofloopProviderSetupCheck[] = [];

  if (providerId === "opsera") {
    checks.push({
      id: "provider-adapter",
      status: "needs_adapter",
      detail: "Opsera is tracked as a requested provider lane, but no live API/session adapter is implemented yet.",
    });
  } else if (missing.length) {
    checks.push({
      id: "required-env",
      status: "needs_credentials",
      detail: `Missing required env: ${missing.join(", ")}`,
    });
  } else {
    checks.push({ id: "required-env", status: "ready", detail: `Required env present: ${required.join(", ") || "none"}` });
    checks.push(await liveProviderCheck(providerId, env, fetchImpl, timeoutMs));
  }

  const status = aggregateStatus(checks);
  const receipt: ProofloopProviderSetupReceipt = {
    schema: "proofloop-provider-setup-v1",
    providerId,
    generatedAt,
    status,
    env: { required, optional, present, missing },
    checks,
    nextCommands: nextCommands(providerId, status),
  };
  writeProviderReceipt(options.root ?? process.cwd(), receipt);
  return receipt;
}

export async function setupProofloopProviders(
  providerIds: ProofloopProviderId[] = [...PROOFLOOP_PROVIDER_IDS],
  options: ProofloopProviderSetupOptions = {},
): Promise<ProofloopProviderSetupReceipt[]> {
  const receipts: ProofloopProviderSetupReceipt[] = [];
  for (const providerId of providerIds) receipts.push(await setupProofloopProvider(providerId, options));
  return receipts;
}

export function proofloopProviderReceiptPath(root: string, providerId: ProofloopProviderId): string {
  return join(root, ".proofloop", "setup", "providers", `${providerId}.json`);
}

export function parseProofloopProviderId(value: string): ProofloopProviderId {
  if ((PROOFLOOP_PROVIDER_IDS as readonly string[]).includes(value)) return value as ProofloopProviderId;
  throw new Error(`Unknown provider ${value}. Expected one of: ${PROOFLOOP_PROVIDER_IDS.join(", ")}`);
}

function requiredEnvForProvider(providerId: ProofloopProviderId, env: NodeJS.ProcessEnv): string[] {
  if (providerId === "butterbase") return ["BUTTERBASE_API_URL"];
  if (providerId === "neo4j") return ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD"];
  if (providerId === "rocketride") return ["ROCKETRIDE_API_KEY", env.ROCKETRIDE_WORKFLOW_URL ? "ROCKETRIDE_WORKFLOW_URL" : "ROCKETRIDE_API_URL"];
  if (providerId === "daytona") return ["DAYTONA_API_KEY"];
  if (providerId === "cognee") return [env.COGNEE_API_URL ? "COGNEE_API_URL" : "COGNEE_LOCAL_PATH"];
  if (providerId === "opsera") return [];
  return ["NEBIUS_API_KEY"];
}

function optionalEnvForProvider(providerId: ProofloopProviderId): string[] {
  if (providerId === "butterbase") return ["BUTTERBASE_APP_ID", "BUTTERBASE_API_KEY", "BUTTERBASE_CALLBACK_KEY"];
  if (providerId === "neo4j") return ["NEO4J_DATABASE"];
  if (providerId === "rocketride") return ["ROCKETRIDE_WORKFLOW_URL", "ROCKETRIDE_API_URL"];
  if (providerId === "daytona") return ["DAYTONA_API_URL"];
  if (providerId === "cognee") return ["COGNEE_API_URL", "COGNEE_LOCAL_PATH", "COGNEE_PYTHON"];
  if (providerId === "opsera") return ["OPSERA_API_URL", "OPSERA_API_KEY", "OPSERA_WORKFLOW_URL"];
  return ["NEBIUS_BASE_URL", "NEBIUS_CONTROL_BASE_URL", "NEBIUS_ENDPOINTS_URL"];
}

async function liveProviderCheck(
  providerId: ProofloopProviderId,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProofloopProviderSetupCheck> {
  try {
    if (providerId === "neo4j") return await neo4jTcpCheck(env, timeoutMs);
    if (providerId === "nebius") {
      const models = await listNebiusModels(env);
      return { id: "live-provider", status: "ready", detail: `Nebius model list reachable (${models.length} model(s)).` };
    }
    if (providerId === "cognee" && env.COGNEE_LOCAL_PATH && !env.COGNEE_API_URL) {
      return {
        id: "local-provider",
        status: existsSync(env.COGNEE_LOCAL_PATH) ? "ready" : "blocked",
        detail: existsSync(env.COGNEE_LOCAL_PATH) ? `Cognee local path exists: ${env.COGNEE_LOCAL_PATH}` : `Cognee local path not found: ${env.COGNEE_LOCAL_PATH}`,
      };
    }
    const url = providerHealthUrl(providerId, env);
    if (!url) return { id: "live-provider", status: "blocked", detail: `${providerId} has no health URL configured.` };
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "GET",
      headers: providerHeaders(providerId, env),
    }, timeoutMs);
    const reachable = response.status < 500;
    return {
      id: "live-provider",
      status: reachable ? "ready" : "blocked",
      detail: `${providerId} health endpoint ${url} returned HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      id: "live-provider",
      status: "blocked",
      detail: `${providerId} live check failed: ${sanitizeProviderError(error, env)}`,
    };
  }
}

function providerHealthUrl(providerId: ProofloopProviderId, env: NodeJS.ProcessEnv): string | undefined {
  if (providerId === "butterbase") return trimTrailingSlash(env.BUTTERBASE_API_URL ?? "");
  if (providerId === "rocketride") return env.ROCKETRIDE_WORKFLOW_URL?.trim() || trimTrailingSlash(env.ROCKETRIDE_API_URL ?? "");
  if (providerId === "daytona") return trimTrailingSlash(env.DAYTONA_API_URL ?? "https://api.daytona.io");
  if (providerId === "cognee") return trimTrailingSlash(env.COGNEE_API_URL ?? "");
  return undefined;
}

function providerHeaders(providerId: ProofloopProviderId, env: NodeJS.ProcessEnv): HeadersInit {
  const headers: Record<string, string> = {};
  if (providerId === "butterbase" && env.BUTTERBASE_API_KEY) headers.Authorization = `Bearer ${env.BUTTERBASE_API_KEY}`;
  if (providerId === "rocketride" && env.ROCKETRIDE_API_KEY) headers.Authorization = `Bearer ${env.ROCKETRIDE_API_KEY}`;
  if (providerId === "daytona" && env.DAYTONA_API_KEY) headers.Authorization = `Bearer ${env.DAYTONA_API_KEY}`;
  return headers;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function neo4jTcpCheck(env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ProofloopProviderSetupCheck> {
  const uri = env.NEO4J_URI ?? "";
  const parsed = parseHostPort(uri);
  if (!parsed) return { id: "live-provider", status: "blocked", detail: `NEO4J_URI is not a supported bolt/neo4j URI: ${uri}` };
  return await new Promise<ProofloopProviderSetupCheck>((resolveCheck) => {
    const socket = new Socket();
    const finish = (status: ProofloopProviderSetupStatus, detail: string) => {
      socket.destroy();
      resolveCheck({ id: "live-provider", status, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("ready", `Neo4j TCP endpoint reachable at ${parsed.host}:${parsed.port}.`));
    socket.once("timeout", () => finish("blocked", `Neo4j TCP endpoint timed out at ${parsed.host}:${parsed.port}.`));
    socket.once("error", (error) => finish("blocked", `Neo4j TCP endpoint failed at ${parsed.host}:${parsed.port}: ${error.message}`));
    socket.connect(parsed.port, parsed.host);
  });
}

function parseHostPort(uri: string): { host: string; port: number } | null {
  try {
    const url = new URL(uri);
    if (!["bolt:", "neo4j:", "neo4j+s:", "bolt+s:"].includes(url.protocol)) return null;
    return { host: url.hostname, port: Number(url.port || 7687) };
  } catch {
    return null;
  }
}

function aggregateStatus(checks: ProofloopProviderSetupCheck[]): ProofloopProviderSetupStatus {
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (checks.some((check) => check.status === "needs_adapter")) return "needs_adapter";
  if (checks.some((check) => check.status === "needs_credentials")) return "needs_credentials";
  return "ready";
}

function nextCommands(providerId: ProofloopProviderId, status: ProofloopProviderSetupStatus): string[] {
  const retry = `npm run proofloop -- providers setup ${providerId}`;
  if (status === "ready") return [retry, "npm run proofloop:live:btb"];
  if (status === "needs_adapter") return [retry, `Implement the ${providerId} provider adapter or remove it from launch copy before claiming live setup.`];
  return [retry, `Add the missing ${providerId} credentials to your local environment, then rerun the setup command.`];
}

function writeProviderReceipt(root: string, receipt: ProofloopProviderSetupReceipt): void {
  const path = proofloopProviderReceiptPath(root, receipt.providerId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

function sanitizeProviderError(error: unknown, env: NodeJS.ProcessEnv): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeNebiusError(message, env);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
