import { describe, expect, it } from "vitest";
import { routeModelTask } from "../src/lib/models/modelRouter";
import { extractNebiusMessageText, hasNebiusReasoningTrace } from "../src/lib/models/providers/nebius";

describe("SEO model router", () => {
  it("uses Nebius first for text/JSON SEO judging when the key is available", () => {
    const decision = routeModelTask({
      task: "seo_judge",
      env: {
        NEBIUS_API_KEY: "test-nebius-key",
        GOOGLE_GENERATIVE_AI_API_KEY: "test-google-key",
      } as NodeJS.ProcessEnv,
    });

    expect(decision.provider).toBe("nebius");
    expect(decision.model).toMatch(/^nebius\//);
    expect(decision.available).toBe(true);
  });

  it("uses Gemini first for video judging and records Nebius as a fallback only when vision is enabled", () => {
    const decision = routeModelTask({
      task: "visual_video_judge",
      env: {
        NEBIUS_API_KEY: "test-nebius-key",
        GOOGLE_GENERATIVE_AI_API_KEY: "test-google-key",
        NEBIUS_ENABLE_VISION_JUDGE: "0",
      } as NodeJS.ProcessEnv,
    });

    expect(decision.provider).toBe("gemini");
    expect(decision.model).toMatch(/^gemini-/);
    expect(decision.available).toBe(true);
    expect(decision.fallbacks.find((item) => item.provider === "nebius")?.available).toBe(false);
  });

  it("reports the preferred provider as unavailable instead of silently hiding missing keys", () => {
    const decision = routeModelTask({
      task: "landing_copy",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(decision.provider).toBe("nebius");
    expect(decision.available).toBe(false);
    expect(decision.reason).toContain("NEBIUS_API_KEY");
  });

  it("parses Nebius reasoning model responses without treating hidden reasoning as user text", () => {
    const response = {
      choices: [{
        finish_reason: "stop",
        message: {
          content: "\n\nOK_NODEROOM_SMOKE",
          reasoning: "Internal chain of thought stayed separate from the content field.",
        },
      }],
    };

    expect(extractNebiusMessageText(response)).toBe("OK_NODEROOM_SMOKE");
    expect(hasNebiusReasoningTrace(response)).toBe(true);
  });
});
