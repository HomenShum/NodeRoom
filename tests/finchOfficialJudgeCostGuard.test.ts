import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Finch official judge cost guard", () => {
  it("keeps Azure optional and uses direct OpenAI only at the canonical certification boundary", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["benchmark:finch:canonical-judge"]).toContain("--provider openai");
    expect(packageJson.scripts["benchmark:finch:canonical-judge"]).not.toContain("azure_openai");
    expect(packageJson.scripts["benchmark:finch:shadow-judge"]).toContain("--provider openrouter");
    expect(packageJson.scripts["benchmark:finch:shadow-judge"]).toContain("--judge-model openrouter/free");
  });

  it("charges failed and retried provider attempts against both call and reserve ceilings", () => {
    const source = String.raw`
import argparse
import importlib.util
import json
from pathlib import Path

path = Path("scripts/finch-official-judge.py").resolve()
spec = importlib.util.spec_from_file_location("finch_official_judge", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
args = argparse.Namespace(
    max_call_reserve_usd=0.5,
    input_usd_per_1m=1.0,
    output_usd_per_1m=2.0,
    max_calls=5,
    max_retries=3,
    max_provider_cost_usd=2.0,
)
failed = {
    "provider_call": True,
    "provider_call_attempts": 3,
    "unpriced_call_attempts": 3,
    "input_tokens": 0,
    "output_tokens": 0,
}
priced_after_retry = {
    "provider_call": True,
    "provider_call_attempts": 2,
    "unpriced_call_attempts": 1,
    "input_tokens": 1_000_000,
    "output_tokens": 500_000,
}
failed_accounting = module.provider_accounting([failed], args)
print(json.dumps({
    "failed": failed_accounting,
    "attemptBudget": module.available_attempt_budget(failed_accounting, args),
    "combined": module.provider_accounting([failed, priced_after_retry], args),
    "legacyAttempts": module.record_provider_attempts({"provider_call": True}),
    "legacyUnpriced": module.record_unpriced_call_attempts({"provider_call": True}),
}))
`;
    const result = spawnSync("python", ["-c", source], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as {
      failed: Record<string, number>;
      attemptBudget: number;
      combined: Record<string, number>;
      legacyAttempts: number;
      legacyUnpriced: number;
    };
    expect(output.failed).toMatchObject({
      provider_call_attempts: 3,
      unpriced_call_attempts: 3,
      reserved_unpriced_cost_usd: 1.5,
      accounted_provider_cost_usd: 1.5,
    });
    expect(output.attemptBudget).toBe(1);
    expect(output.combined).toMatchObject({
      provider_call_attempts: 5,
      unpriced_call_attempts: 4,
      estimated_provider_cost_usd: 2,
      reserved_unpriced_cost_usd: 2,
      accounted_provider_cost_usd: 4,
    });
    expect(output.legacyAttempts).toBe(1);
    expect(output.legacyUnpriced).toBe(1);
  });

  it("accepts only prompt-matched canonical GPT-5-mini records on the direct transport", () => {
    const source = String.raw`
import importlib.util
import json
from pathlib import Path

path = Path("scripts/finch-official-judge.py").resolve()
spec = importlib.util.spec_from_file_location("finch_official_judge_contract", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
base = {
    "provider_call": True,
    "judge_provider": "openai",
    "judge_model": "gpt-5-mini",
    "judge_contract": "finch-gpt5mini-canonical-v1",
    "content_record_sha256": "prompt-a",
    "score": 1,
}
print(json.dumps({
    "shadowLimit": module.parser().parse_args(["--max-provider-cost-usd", "1"]).shadow_max_completion_tokens,
    "snapshot": module.complete_record({**base, "resolved_judge_model": "gpt-5-mini-2025-08-07"}, "openai", "gpt-5-mini", "prompt-a"),
    "alias": module.complete_record({**base, "resolved_judge_model": "gpt-5-mini"}, "openai", "gpt-5-mini", "prompt-a"),
    "frontier": module.complete_record({**base, "resolved_judge_model": "gpt-5.4-mini"}, "openai", "gpt-5-mini", "prompt-a"),
    "freeRouter": module.complete_record({**base, "judge_provider": "openrouter", "resolved_judge_model": "gpt-5-mini"}, "openai", "gpt-5-mini", "prompt-a"),
    "parseError": module.complete_record({**base, "resolved_judge_model": "gpt-5-mini", "error": "invalid_json"}, "openai", "gpt-5-mini", "prompt-a"),
    "stalePrompt": module.complete_record({**base, "resolved_judge_model": "gpt-5-mini"}, "openai", "gpt-5-mini", "prompt-b"),
}))
`;
    const result = spawnSync("python", ["-c", source], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      shadowLimit: 8192,
      snapshot: true,
      alias: true,
      frontier: false,
      freeRouter: false,
      parseError: false,
      stalePrompt: false,
    });
  });
});
