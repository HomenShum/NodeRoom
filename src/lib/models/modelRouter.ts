export type ModelTask =
  | "seo_judge"
  | "landing_copy"
  | "agent_reasoning"
  | "visual_video_judge"
  | "fast_chat"
  | "code_reasoning";

export type ProviderName = "nebius" | "gemini" | "openai";

export type ProviderPreference = {
  primary: ProviderName;
  fallback: ProviderName[];
};

export type ModelRouteDecision = {
  task: ModelTask;
  provider: ProviderName;
  model: string;
  preference: ProviderPreference;
  fallbacks: Array<{ provider: ProviderName; model: string; available: boolean; reason: string }>;
  available: boolean;
  reason: string;
};

export const DEFAULT_PROVIDER_POLICY: Record<ModelTask, ProviderPreference> = {
  seo_judge: { primary: "nebius", fallback: ["gemini", "openai"] },
  landing_copy: { primary: "nebius", fallback: ["gemini", "openai"] },
  agent_reasoning: { primary: "nebius", fallback: ["gemini", "openai"] },
  visual_video_judge: { primary: "gemini", fallback: ["nebius", "openai"] },
  fast_chat: { primary: "nebius", fallback: ["gemini", "openai"] },
  code_reasoning: { primary: "nebius", fallback: ["openai", "gemini"] },
};

const DEFAULT_MODELS: Record<ModelTask, Record<ProviderName, string>> = {
  seo_judge: {
    nebius: "nebius/MiniMaxAI/MiniMax-M2.5",
    gemini: "gemini-3.5-flash",
    openai: "gpt-5.4-mini",
  },
  landing_copy: {
    nebius: "nebius/MiniMaxAI/MiniMax-M2.5",
    gemini: "gemini-3.5-flash",
    openai: "gpt-5.4-mini",
  },
  agent_reasoning: {
    nebius: "nebius/zai-org/GLM-5.2",
    gemini: "gemini-3.5-flash",
    openai: "gpt-5.4",
  },
  visual_video_judge: {
    nebius: "nebius/zai-org/GLM-5.2",
    gemini: "gemini-3.5-flash",
    openai: "gpt-5.4-mini",
  },
  fast_chat: {
    nebius: "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    gemini: "gemini-3.5-flash",
    openai: "gpt-5.4-nano",
  },
  code_reasoning: {
    nebius: "nebius/deepseek-ai/DeepSeek-V4-Pro",
    gemini: "gemini-3.5-flash",
    openai: "gpt-5.4",
  },
};

const TASK_ENV_MODEL: Partial<Record<ModelTask, string>> = {
  seo_judge: "SEO_JUDGE_MODEL",
  landing_copy: "LANDING_COPY_MODEL",
  agent_reasoning: "AGENT_MODEL",
  visual_video_judge: "GEMINI_SEO_VIDEO_JUDGE_MODEL",
  fast_chat: "FAST_CHAT_MODEL",
  code_reasoning: "CODE_REASONING_MODEL",
};

export function routeModelTask(args: {
  task: ModelTask;
  policy?: Partial<Record<ModelTask, ProviderPreference>>;
  env?: NodeJS.ProcessEnv;
}): ModelRouteDecision {
  const env = args.env ?? process.env;
  const preference = args.policy?.[args.task] ?? DEFAULT_PROVIDER_POLICY[args.task];
  const candidates = [preference.primary, ...preference.fallback];
  const candidateStates = candidates.map((provider) => ({
    provider,
    model: modelForProvider(args.task, provider, env),
    available: providerAvailable(provider, env) && providerSupportsTask(provider, args.task, env),
    reason: providerReason(provider, args.task, env),
  }));
  const chosen = candidateStates.find((candidate) => candidate.available) ?? candidateStates[0];
  return {
    task: args.task,
    provider: chosen.provider,
    model: chosen.model,
    preference,
    fallbacks: candidateStates.slice(1),
    available: chosen.available,
    reason: chosen.available
      ? `${chosen.provider} selected for ${args.task}: ${chosen.reason}`
      : `${chosen.provider} is preferred for ${args.task} but unavailable: ${chosen.reason}`,
  };
}

export function modelForProvider(task: ModelTask, provider: ProviderName, env: NodeJS.ProcessEnv = process.env): string {
  const taskEnv = TASK_ENV_MODEL[task];
  const providerTaskEnv = `${provider.toUpperCase()}_${task.toUpperCase()}_MODEL`;
  const genericModel = taskEnv ? env[taskEnv]?.trim() : undefined;
  return env[providerTaskEnv]?.trim()
    ?? (genericModel && modelMatchesProvider(genericModel, provider) ? genericModel : undefined)
    ?? DEFAULT_MODELS[task][provider];
}

export function providerAvailable(provider: ProviderName, env: NodeJS.ProcessEnv = process.env): boolean {
  if (provider === "nebius") return Boolean(env.NEBIUS_API_KEY?.trim());
  if (provider === "gemini") return Boolean((env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY)?.trim());
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY?.trim());
  return false;
}

export function providerSupportsTask(provider: ProviderName, task: ModelTask, env: NodeJS.ProcessEnv = process.env): boolean {
  if (task !== "visual_video_judge") return true;
  if (provider === "gemini") return true;
  if (provider === "nebius") return env.NEBIUS_ENABLE_VISION_JUDGE === "1";
  return false;
}

function providerReason(provider: ProviderName, task: ModelTask, env: NodeJS.ProcessEnv): string {
  if (!providerAvailable(provider, env)) return `${providerEnvName(provider)} is not set`;
  if (!providerSupportsTask(provider, task, env)) return `${provider} is not enabled for ${task}`;
  if (provider === "nebius" && task !== "visual_video_judge") return "Nebius-first policy for text/JSON and app-side model work";
  if (provider === "gemini" && task === "visual_video_judge") return "Gemini-first policy for video understanding";
  return "fallback provider available";
}

function providerEnvName(provider: ProviderName): string {
  if (provider === "nebius") return "NEBIUS_API_KEY";
  if (provider === "gemini") return "GOOGLE_GENERATIVE_AI_API_KEY";
  return "OPENAI_API_KEY";
}

function modelMatchesProvider(model: string, provider: ProviderName): boolean {
  if (provider === "nebius") return model.startsWith("nebius/");
  if (provider === "gemini") return model.startsWith("gemini-");
  return /^(gpt-|o[0-9])/.test(model);
}
