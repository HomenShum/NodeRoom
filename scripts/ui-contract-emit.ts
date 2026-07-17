/**
 * Emits the agent-native UI contract to public/.well-known/agent-ui.json so the
 * built app SERVES its own drivability contract (Vite copies public/ into dist;
 * Vercel serves it at https://noderoom.live/.well-known/agent-ui.json).
 *
 *   npm run ui:contract:emit          rewrite the emitted JSON from src/design/uiContract.ts
 *   npm run ui:contract:check         fail (exit 1) if the emitted JSON is stale — wired
 *                                     into design:audit so contract edits cannot land
 *                                     without re-emitting (same pattern as codegen checks)
 *
 * The emitted file is deterministic (no timestamps) so check mode is a pure diff.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { uiContract } from "../src/design/uiContract";

const OUT = resolve("public/.well-known/agent-ui.json");
const next = `${JSON.stringify(uiContract, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== next) {
    console.error("ui-contract check: FAIL — public/.well-known/agent-ui.json is stale.");
    console.error("Run `npm run ui:contract:emit` and commit the result.");
    process.exit(1);
  }
  console.log(`ui-contract check: pass (${uiContract.elements.length} elements, ${uiContract.invariants.length} invariants, v${uiContract.contractVersion})`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, next, "utf8");
console.log(`ui-contract emit: wrote ${OUT} (${uiContract.elements.length} elements, ${uiContract.journeys.length} journeys, v${uiContract.contractVersion})`);
