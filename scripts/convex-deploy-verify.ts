/**
 * Deploy self-verification guard - closes the "silent clobber" failure mode
 * discovered live on 2026-07-06/07: a concurrent `npx convex deploy` from a
 * different local tree (this repo is developed by more than one Claude/Codex
 * session against the SAME shared prod target, zealous-goshawk-766) silently
 * overwrote a just-deployed function. The overwrite was undetectable except by
 * accident - the function vanished from the deployed function-spec with no
 * error, no warning, nothing. This script closes that gap: it's wired into
 * `npm run convex:deploy` and fails loudly, immediately, if what's actually
 * live doesn't match what this working tree just tried to deploy - instead of
 * discovering it 15 minutes later during a live agent run.
 *
 * Pure diff/scan logic lives in src/eval/convexDeployVerify.ts (unit tested);
 * this file is just the fs + CLI I/O shell around it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { diffDeployState, expectedIdentifiersFromSource } from "../src/eval/convexDeployVerify";

function main() {
  const prod = process.argv.includes("--prod");
  const deployment = option("--deployment");
  const convexDir = join(process.cwd(), "convex");
  const files = readdirSync(convexDir).filter((name) => name.endsWith(".ts") && !name.startsWith("_"));
  const expected = files.flatMap((name) => expectedIdentifiersFromSource(readFileSync(join(convexDir, name), "utf8"), basename(name, ".ts")));

  const specArgs = [
    "convex",
    "function-spec",
    ...(deployment ? ["--deployment", deployment] : prod ? ["--prod"] : ["--env-file", ".env.local"]),
  ];
  const result = spawnSync("npx", specArgs, {
    encoding: "utf8",
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error("[deploy-verify] could not fetch function-spec - is the deploy actually reachable?");
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }

  let spec: { functions?: Array<{ identifier?: string }> };
  try {
    spec = JSON.parse(result.stdout);
  } catch {
    console.error("[deploy-verify] function-spec did not return parseable JSON - cannot verify deploy state");
    process.exit(1);
  }
  const deployed = (spec.functions ?? []).map((f) => f.identifier).filter((id): id is string => typeof id === "string");

  const diff = diffDeployState(expected, deployed);

  if (diff.extra.length > 0) {
    console.warn(`[deploy-verify] ${diff.extra.length} deployed function(s) not found in this working tree's source - informational only (framework-component exports like workflow.define()/syncApi() destructuring don't match this scanner's plain query/mutation/action shape, or the deployed target is genuinely ahead of local):`);
    for (const id of diff.extra.slice(0, 20)) console.warn(`  + ${id}`);
    if (diff.extra.length > 20) console.warn(`  ...and ${diff.extra.length - 20} more`);
  }

  if (!diff.ok) {
    console.error(`[deploy-verify] FAIL - ${diff.missing.length} function(s) this working tree defines are NOT in the deployed function-spec:`);
    for (const id of diff.missing) console.error(`  - ${id}`);
    console.error("");
    console.error("This is the exact 'silent clobber' failure mode: a concurrent deploy from a");
    console.error("different tree overwrote what you just pushed. Re-run `npm run convex:deploy`");
    console.error("immediately, then re-run this check. If it keeps happening, coordinate before");
    console.error("deploying - check `npx convex run agentJobs:workpoolStatus` for concurrent");
    console.error("activity, and confirm no one else is mid-deploy before pushing to shared prod.");
    process.exit(1);
  }

  const target = deployment ? `deployment ${deployment}` : prod ? "production" : "development";
  console.log(`[deploy-verify] OK - all ${expected.length} exported convex functions in this working tree are live in the ${target} function-spec.`);
}

function option(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  return index >= 0 && value && !value.startsWith("--") ? value : undefined;
}

main();
