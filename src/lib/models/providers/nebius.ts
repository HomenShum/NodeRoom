export type NebiusModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
};

export type NebiusModelsResponse = {
  data?: NebiusModel[];
};

export type NebiusEndpoint = {
  id?: string;
  name?: string;
  model?: string;
  status?: string;
  [key: string]: unknown;
};

export type NebiusEndpointPlan = {
  model: string;
  endpointName: string;
  createAllowed: boolean;
  reason: string;
  nextCommand: string;
};

export type NebiusChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type NebiusChatResponse = {
  id?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null | Array<{ type?: string; text?: string }>;
      reasoning?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

const DEFAULT_NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1";

export function nebiusBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return trimTrailingSlash(env.NEBIUS_BASE_URL ?? DEFAULT_NEBIUS_BASE_URL);
}

export function nebiusControlBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return trimTrailingSlash(env.NEBIUS_CONTROL_BASE_URL ?? nebiusBaseUrl(env));
}

export async function listNebiusModels(env: NodeJS.ProcessEnv = process.env): Promise<NebiusModel[]> {
  const response = await nebiusFetch("/models", { method: "GET" }, env, nebiusBaseUrl(env));
  const body = await response.json() as NebiusModelsResponse;
  return body.data ?? [];
}

export async function listNebiusEndpoints(env: NodeJS.ProcessEnv = process.env): Promise<NebiusEndpoint[]> {
  const url = env.NEBIUS_ENDPOINTS_URL?.trim();
  const response = await nebiusFetch(url ?? "/endpoints", { method: "GET" }, env, url ? undefined : nebiusControlBaseUrl(env));
  const body = await response.json() as { data?: NebiusEndpoint[]; endpoints?: NebiusEndpoint[] };
  return body.data ?? body.endpoints ?? [];
}

export async function nebiusChatCompletion(args: {
  model: string;
  messages: NebiusChatMessage[];
  temperature?: number;
  maxTokens?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<NebiusChatResponse> {
  const env = args.env ?? process.env;
  const model = args.model.replace(/^nebius\//i, "");
  const response = await nebiusFetch("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: args.messages,
      temperature: args.temperature ?? 0.2,
      max_tokens: args.maxTokens,
    }),
  }, env, nebiusBaseUrl(env));
  return await response.json() as NebiusChatResponse;
}

export function extractNebiusMessageText(response: NebiusChatResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => typeof part.text === "string" ? part.text : "").join("").trim();
  }
  return "";
}

export function hasNebiusReasoningTrace(response: NebiusChatResponse): boolean {
  return typeof response.choices?.[0]?.message?.reasoning === "string";
}

export function buildNebiusEndpointPlan(args: {
  model: string;
  endpointName?: string;
  createAllowed?: boolean;
}): NebiusEndpointPlan {
  const endpointName = args.endpointName ?? endpointNameForModel(args.model);
  const nextCommand = `npm run nebius:ensure-endpoint -- --model ${quoteArg(args.model)} --endpoint-name ${quoteArg(endpointName)} --allow-create`;
  return {
    model: args.model,
    endpointName,
    createAllowed: args.createAllowed === true,
    reason: args.createAllowed === true
      ? "Creation allowed by explicit flag; run the command after checking model, region, GPU, and cost assumptions."
      : "Creation is disabled by default. Review this plan and re-run with --allow-create if a dedicated endpoint is justified.",
    nextCommand,
  };
}

export function requireNebiusApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.NEBIUS_API_KEY?.trim();
  if (!key) throw new Error("NEBIUS_API_KEY is required");
  return key;
}

export function sanitizeNebiusError(error: unknown, env: NodeJS.ProcessEnv = process.env): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of Object.values(env)) {
    const secret = value?.trim();
    if (secret && secret.length > 12) message = message.replaceAll(secret, "[redacted]");
  }
  return message.replace(/\s+/g, " ").slice(0, 500);
}

async function nebiusFetch(pathOrUrl: string, init: RequestInit, env: NodeJS.ProcessEnv, baseUrl?: string): Promise<Response> {
  const key = requireNebiusApiKey(env);
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${trimTrailingSlash(baseUrl ?? nebiusBaseUrl(env))}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  const response = await fetch(url, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Nebius request failed: ${response.status} ${text.slice(0, 500)}`);
  }
  return response;
}

function endpointNameForModel(model: string): string {
  return `noderoom-${model.replace(/^nebius\//i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}`;
}

function quoteArg(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : JSON.stringify(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
