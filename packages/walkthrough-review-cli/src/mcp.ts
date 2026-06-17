import { createInterface } from "node:readline";

import { runWalkthroughReview, type WalkthroughRunInput } from "./core.js";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

type ToolCallParams = {
  name?: string;
  arguments?: Record<string, unknown>;
};

const configPath = optionValue(process.argv.slice(2), "--config");

const tools = [{
  name: "walkthrough_review_run",
  description: "Run a browser walkthrough capture/render/model-assisted UX review using the configured project commands.",
  inputSchema: {
    type: "object",
    properties: {
      features: { type: "array", items: { type: "string" } },
      base: { type: "string" },
      model: { type: "string" },
      runId: { type: "string" },
      media: { type: "string" },
      uiReview: { type: "boolean" },
      skipCapture: { type: "boolean" },
      skipRender: { type: "boolean" },
      skipGemini: { type: "boolean" },
      allowSkipped: { type: "boolean" },
      dryRun: { type: "boolean" },
    },
    additionalProperties: false,
  },
}];

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line) as JsonRpcRequest;
  } catch (error) {
    respond(null, undefined, rpcError(-32700, error instanceof Error ? error.message : String(error)));
    return;
  }
  await handle(req);
});

async function handle(req: JsonRpcRequest) {
  try {
    if (req.method === "initialize") {
      respond(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "walkthrough-review", version: "0.1.0" },
      });
      return;
    }
    if (req.method === "tools/list") {
      respond(req.id, { tools });
      return;
    }
    if (req.method === "tools/call") {
      const params = req.params as ToolCallParams | undefined;
      if (params?.name !== "walkthrough_review_run") {
        respond(req.id, undefined, rpcError(-32602, `Unknown tool: ${String(params?.name)}`));
        return;
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const result = await runWalkthroughReview({
        ...coerceInput(args),
        configPath,
        streamLogs: false,
        logger: (message) => process.stderr.write(`${message}\n`),
      });
      respond(req.id, {
        content: [{
          type: "text",
          text: [
            `Walkthrough review complete: ${result.readmePath}`,
            `Run id: ${result.runId}`,
            `Media: ${result.media}`,
            result.mediaJudge ? `Media judge: ${result.mediaJudge}` : undefined,
            result.uiReview ? `UI review: ${result.uiReview}` : undefined,
          ].filter(Boolean).join("\n"),
        }],
        structuredContent: result,
      });
      return;
    }
    if (req.method.startsWith("notifications/")) return;
    respond(req.id, undefined, rpcError(-32601, `Method not found: ${req.method}`));
  } catch (error) {
    respond(req.id, undefined, rpcError(-32000, error instanceof Error ? error.message : String(error)));
  }
}

function coerceInput(args: Record<string, unknown>): WalkthroughRunInput {
  return {
    features: Array.isArray(args.features) ? args.features.map(String) : undefined,
    base: stringArg(args.base),
    model: stringArg(args.model),
    runId: stringArg(args.runId),
    media: stringArg(args.media),
    uiReview: booleanArg(args.uiReview),
    skipCapture: booleanArg(args.skipCapture),
    skipRender: booleanArg(args.skipRender),
    skipGemini: booleanArg(args.skipGemini),
    allowSkipped: booleanArg(args.allowSkipped),
    dryRun: booleanArg(args.dryRun),
  };
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function booleanArg(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function respond(id: JsonRpcRequest["id"], result?: unknown, error?: { code: number; message: string }) {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result })}\n`);
}

function rpcError(code: number, message: string) {
  return { code, message };
}
