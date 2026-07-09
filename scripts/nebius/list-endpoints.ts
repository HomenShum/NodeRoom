import "../benchmark/loadEnv";

import { listNebiusEndpoints, sanitizeNebiusError } from "../../src/lib/models/providers/nebius";

try {
  const endpoints = await listNebiusEndpoints();
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: endpoints.length,
    endpoints,
  }, null, 2));
} catch (error) {
  console.error(sanitizeNebiusError(error));
  process.exitCode = 1;
}
