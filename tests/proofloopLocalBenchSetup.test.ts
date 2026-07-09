import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type AdapterJson = {
  id: string;
  verifierCommand: string;
  liveUserCommand: string;
  expectedArtifacts: string[];
};

describe("local benchmark setup recipes", () => {
  it("documents Finch, FinAuditing, and WorkstreamBench setup from adapter contracts", () => {
    const doc = readFileSync(join(process.cwd(), "docs", "eval", "LOCAL_BENCH_SETUP.md"), "utf8");

    for (const id of ["finch", "finauditing", "workstreambench"]) {
      const adapter = JSON.parse(readFileSync(join(process.cwd(), "proofloop", "benchmarks", id, "adapter.json"), "utf8")) as AdapterJson;
      expect(doc).toContain(`setup ${id}`);
      expect(doc).toContain(adapter.verifierCommand);
      expect(doc).toContain(adapter.liveUserCommand);
      for (const artifact of adapter.expectedArtifacts) expect(doc).toContain(artifact);
    }

    expect(doc).toContain("npm run proofloop -- providers setup all --strict");
    expect(doc).toContain("npm run nebius:smoke-test");
    expect(doc).toContain("npm run proofloop -- codex reprompt latest");
  });
});
