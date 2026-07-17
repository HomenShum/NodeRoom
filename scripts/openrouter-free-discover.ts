import "./benchmark/loadEnv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { judge } from "../src/nodeagent/models/adapter";
import { model } from "../src/nodeagent/models/adapter";
import { selectOpenRouterFreeModels } from "../src/nodeagent/models/openRouterFreeModels";

const limit = parseLimit();
const jsonOut = optionValue("--json-out");
const smoke = process.argv.includes("--smoke");
const agentSmoke = process.argv.includes("--agent-smoke");
const candidates = await selectOpenRouterFreeModels({ mode: "agent", limit, forceRefresh: true });
const liveProbes: Array<Record<string, unknown>> = [];

console.log(`OpenRouter free-auto candidates (${candidates.length})`);
for (const [index, model] of candidates.entries()) {
  const context = model.context_length ?? model.top_provider?.context_length ?? 0;
  const params = model.supported_parameters ?? [];
  console.log([
    `${String(index + 1).padStart(2, " ")}.`,
    model.id.padEnd(46),
    `score=${model.score.toFixed(1).padStart(7, " ")}`,
    `ctx=${context}`,
    `params=${params.filter((p) => ["tools", "tool_choice", "structured_outputs", "response_format", "reasoning"].includes(p)).join(",")}`,
    `reasons=${model.reasons.slice(0, 5).join("; ")}`,
  ].join(" "));
}

if (smoke) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log("SKIP smoke missing OPENROUTER_API_KEY");
    liveProbes.push({ kind: "text", status: "skipped", reason: "missing OPENROUTER_API_KEY" });
  } else {
    const startedAt = Date.now();
    try {
      const text = await judge("openrouter/free-auto", "Reply with exactly: OK");
      const passed = /^\s*OK\s*$/i.test(text);
      console.log(`SMOKE openrouter/free-auto -> ${JSON.stringify(text.slice(0, 80))}`);
      liveProbes.push({ kind: "text", status: passed ? "passed" : "failed", requestedModel: "openrouter/free-auto", durationMs: Date.now() - startedAt, preview: text.slice(0, 80) });
      if (!passed) process.exitCode = 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`SMOKE openrouter/free-auto -> failed: ${message}`);
      liveProbes.push({ kind: "text", status: "failed", requestedModel: "openrouter/free-auto", durationMs: Date.now() - startedAt, error: message });
      process.exitCode = 1;
    }
  }
}

if (agentSmoke) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log("SKIP agent smoke missing OPENROUTER_API_KEY");
    liveProbes.push({ kind: "agent_tool", status: "skipped", reason: "missing OPENROUTER_API_KEY" });
  } else {
    const startedAt = Date.now();
    const route = model("openrouter/free-auto");
    try {
      const res = await route.next({
        system: "You are a tool-using smoke test. When asked, call the report_answer tool exactly once.",
        messages: [{ role: "user", content: "Call report_answer with value OK." }],
        tools: [{
          name: "report_answer",
          description: "Report a short answer.",
          schema: z.object({ value: z.string() }),
          execute: async () => ({ ok: true }),
        }],
      });
      const first = res.toolCalls[0];
      const passed = first?.tool === "report_answer" && String(first.args.value) === "OK";
      console.log(`AGENT_SMOKE ${route.name} -> ${first?.tool ?? "no_tool"} ${JSON.stringify(first?.args ?? {})}`);
      liveProbes.push({
        kind: "agent_tool",
        status: passed ? "passed" : "failed",
        requestedModel: "openrouter/free-auto",
        resolvedModel: route.name,
        durationMs: Date.now() - startedAt,
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
        providerCostUsd: 0,
        expectedTool: "report_answer",
        actualTool: first?.tool ?? null,
        actualArgs: first?.args ?? {},
      });
      if (!passed) process.exitCode = 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`AGENT_SMOKE ${route.name} -> failed: ${message}`);
      liveProbes.push({
        kind: "agent_tool",
        status: "failed",
        requestedModel: "openrouter/free-auto",
        resolvedModel: route.name,
        durationMs: Date.now() - startedAt,
        providerCostUsd: 0,
        error: message,
      });
      process.exitCode = 1;
    }
  }
}

if (jsonOut) {
  writeJson(jsonOut, {
    schema: 2,
    generatedAt: new Date().toISOString(),
    source: `${process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"}/models?output_modalities=text`,
    selection: {
      pricing: "free",
      mode: "agent",
      supportedParameters: ["tools"],
      limit,
    },
    modelCount: candidates.length,
    models: candidates.map((candidate, index) => ({
      rank: index + 1,
      id: candidate.id,
      name: candidate.name ?? candidate.id,
      created: candidate.created ?? 0,
      createdAt: candidate.created ? new Date(candidate.created * 1000).toISOString() : undefined,
      contextLength: candidate.context_length ?? candidate.top_provider?.context_length ?? 0,
      score: candidate.score,
      reasons: candidate.reasons,
      supportsTools: candidate.supported_parameters?.includes("tools") === true,
      supportsToolChoice: candidate.supported_parameters?.includes("tool_choice") === true,
      supportsStructuredOutputs: candidate.supported_parameters?.includes("structured_outputs") === true,
      supportedParameters: candidate.supported_parameters ?? [],
    })),
    liveProbes,
  });
  console.log(`wrote ${jsonOut}`);
}

function parseLimit(): number {
  const value = Number(optionValue("--limit") ?? 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(50, value)) : 10;
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = process.argv.indexOf(name);
  const next = process.argv[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
