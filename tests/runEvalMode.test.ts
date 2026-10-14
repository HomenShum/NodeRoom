import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOLDEN } from "../evals/cases";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { anthropicModel, runAgent, scriptedModel } from "../src/nodeagent/index";

vi.mock("../src/engine/demoRoom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/engine/demoRoom")>();
  return { ...actual, buildDemoRoom: vi.fn(actual.buildDemoRoom) };
});

vi.mock("../src/nodeagent/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/nodeagent/index")>();
  return {
    ...actual,
    anthropicModel: vi.fn(() => ({
      name: "local-route-interceptor",
      async next() { return { done: true, text: "Local routing probe only.", toolCalls: [] }; },
    })),
    scriptedModel: vi.fn(actual.scriptedModel),
    runAgent: vi.fn(actual.runAgent),
  };
});

const root = fileURLToPath(new URL("../", import.meta.url));
const fakeKey = "local-routing-test-only";
const expectedGoals = GOLDEN.flatMap((c) => c.turns
  ? c.turns.map((turn) => turn.goal)
  : Array.from({ length: c.property?.iterations ?? 1 }, () => c.goal));
const denyFetch = "data:text/javascript," + encodeURIComponent(
  "globalThis.fetch = () => { console.error('EVAL_TEST_EGRESS_BLOCKED'); throw new Error('EVAL_TEST_EGRESS_BLOCKED'); };",
);

function runCli(real: boolean, key?: string) {
  // Inherit only OS plumbing; never forward developer credentials or Node preloads.
  const osNames = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOMEDRIVE|HOMEPATH|COMSPEC)$/i;
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => osNames.test(name)));
  env.NODE_ENV = "test";
  if (key !== undefined) env.ANTHROPIC_API_KEY = key;
  return new Promise<{ code: number | string; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, ["--import", denyFetch, "--import", "tsx", "evals/runEval.ts", ...(real ? ["--real"] : [])],
      { cwd: root, env, timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ code: error ? error.code ?? "execution-failed" : 0, stdout, stderr });
      });
  });
}

describe("RequestedEvalMode-v1: maintainer can tell what actually ran", () => {
  let argv: string[];
  let exitCode: typeof process.exitCode;
  let output: string[];
  let errors: string[];

  beforeEach(() => {
    argv = process.argv;
    exitCode = process.exitCode;
    output = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { output.push(args.join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args.join(" ")); });
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("EVAL_TEST_EGRESS_BLOCKED"); }));
  });

  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function runEntry(real: boolean, key?: string) {
    vi.resetModules();
    vi.clearAllMocks();
    output.length = 0;
    errors.length = 0;
    process.exitCode = undefined;
    process.argv = [process.execPath, "evals/runEval.ts", ...(real ? ["--real"] : [])];
    vi.stubEnv("ANTHROPIC_API_KEY", key);
    await import("../evals/runEval");
    await vi.waitFor(() => {
      expect(output.some((line) => line.startsWith("SCORE:")) || vi.mocked(process.exit).mock.calls.length > 0).toBe(true);
    });
    expect(fetch).not.toHaveBeenCalled();
  }

  it.each([
    ["absent", undefined], ["empty", ""], ["whitespace-only", " \t\n "],
  ] as const)("rejects a maintainer's real run with an %s key before any case or model", async (_label, key) => {
    await runEntry(true, key);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(errors.join("\n")).toContain("ANTHROPIC_API_KEY");
    expect(output).toEqual([]);
    expect(buildDemoRoom).not.toHaveBeenCalled();
    expect(anthropicModel).not.toHaveBeenCalled();
    expect(scriptedModel).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();

    const cli = await runCli(true, key);
    expect(cli.code).toBe(1);
    expect(cli.stderr).toContain("ANTHROPIC_API_KEY");
    expect(cli.stderr).toContain("npm run eval");
    expect(cli.stderr).not.toContain("EVAL_TEST_EGRESS_BLOCKED");
    expect(cli.stdout).not.toMatch(/AGENT EVAL|PASS|FAIL|SCORE:/);
  }, 40_000);

  it("keeps deliberate offline replay scripted even when credentials are configured", async () => {
    await runEntry(false, fakeKey);
    expect(output.join("\n")).toContain("scripted (deterministic)");
    expect(output.join("\n")).not.toContain("anthropic (real)");
    expect(output.join("\n")).toContain("SCORE: 6/6 passed");
    for (const c of GOLDEN) expect(output.some((line) => line.includes(`PASS  ${c.id}`))).toBe(true);
    expect(anthropicModel).not.toHaveBeenCalled();
    expect(scriptedModel).toHaveBeenCalledTimes(expectedGoals.length);
    expect(process.exitCode).toBeUndefined();
  });

  it("routes single, multi-turn and property runs through the intercepted real model without awarding it scripted success", async () => {
    await runEntry(true, fakeKey);
    expect(anthropicModel).toHaveBeenCalledTimes(expectedGoals.length);
    expect(scriptedModel).not.toHaveBeenCalled();
    expect(vi.mocked(runAgent).mock.calls.map(([options]) => options.goal)).toEqual(expectedGoals);
    for (const [options] of vi.mocked(runAgent).mock.calls) expect(options.model.name).toBe("local-route-interceptor");
    expect(output.join("\n")).toContain("anthropic (real)");
    expect(output.join("\n")).toContain("SCORE: 0/6 passed");
    expect(process.exitCode).toBe(1);
    expect(output.join("\n") + errors.join("\n")).not.toContain(fakeKey);
  });

  it("reports a local model-construction failure without a success score or scripted fallback", async () => {
    vi.mocked(anthropicModel).mockImplementationOnce(() => { throw new Error("LOCAL_MODEL_UNAVAILABLE"); });
    await runEntry(true, fakeKey);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(errors.join("\n")).toContain("LOCAL_MODEL_UNAVAILABLE");
    expect(output.join("\n")).not.toContain("SCORE:");
    expect(scriptedModel).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("does not accumulate mode or room state across repeated maintainer retries and offline replays", async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await runEntry(true, attempt % 2 ? " \t " : undefined);
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(buildDemoRoom).not.toHaveBeenCalled();
      expect(output).toEqual([]);
      await runEntry(false, fakeKey);
      expect(output.filter((line) => line.startsWith("SCORE:"))).toEqual(["SCORE: 6/6 passed"]);
      expect(anthropicModel).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    }
  });

  it("isolates a concurrent burst of offline jobs and misconfigured real jobs at the actual CLI", async () => {
    const jobs = [false, true, false, true];
    const results = await Promise.all(jobs.map((real) => runCli(real)));
    results.forEach((result, i) => {
      expect(result.stderr).not.toContain("EVAL_TEST_EGRESS_BLOCKED");
      expect(result.code).toBe(jobs[i] ? 1 : 0);
      if (jobs[i]) {
        expect(result.stdout).not.toMatch(/AGENT EVAL|PASS|FAIL|SCORE:/);
        expect(result.stderr).toContain("ANTHROPIC_API_KEY");
      } else {
        expect(result.stdout).toContain("scripted (deterministic)");
        expect(result.stdout).toContain("SCORE: 6/6 passed");
      }
    });
  }, 40_000);
});
