import "../benchmark/loadEnv";

import { buildNebiusEndpointPlan, listNebiusEndpoints, sanitizeNebiusError } from "../../src/lib/models/providers/nebius";

const args = process.argv.slice(2);
const model = optionValue("--model") ?? process.env.NEBIUS_ENDPOINT_MODEL ?? "nebius/MiniMaxAI/MiniMax-M2.5";
const endpointName = optionValue("--endpoint-name");
const allowCreate = hasFlag("--allow-create") || process.env.NEBIUS_ALLOW_ENDPOINT_CREATE === "1";

try {
  const endpoints = await listNebiusEndpoints();
  const match = endpoints.find((endpoint) => {
    const name = String(endpoint.name ?? endpoint.id ?? "");
    const endpointModel = String(endpoint.model ?? "");
    return (endpointName && name === endpointName) || endpointModel === model || endpointModel === model.replace(/^nebius\//i, "");
  });
  if (match) {
    console.log(JSON.stringify({
      status: "exists",
      generatedAt: new Date().toISOString(),
      model,
      endpoint: match,
    }, null, 2));
  } else {
    const plan = buildNebiusEndpointPlan({ model, endpointName, createAllowed: allowCreate });
    console.log(JSON.stringify({
      status: allowCreate ? "creation_not_implemented" : "plan_only",
      generatedAt: new Date().toISOString(),
      plan,
      note: "Dedicated endpoint creation is intentionally not automatic. Configure NEBIUS_CONTROL_BASE_URL/NEBIUS_ENDPOINTS_URL for the current control-plane API and implement the create call after reviewing cost, region, GPU, and teardown policy.",
    }, null, 2));
    if (allowCreate) process.exitCode = 2;
  }
} catch (error) {
  console.error(sanitizeNebiusError(error));
  process.exitCode = 1;
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (inline !== undefined) return inline;
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}
