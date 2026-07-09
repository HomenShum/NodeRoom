import "../benchmark/loadEnv";

import { listNebiusModels, sanitizeNebiusError } from "../../src/lib/models/providers/nebius";

try {
  const models = await listNebiusModels();
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: models.length,
    models,
  }, null, 2));
} catch (error) {
  console.error(sanitizeNebiusError(error));
  process.exitCode = 1;
}
