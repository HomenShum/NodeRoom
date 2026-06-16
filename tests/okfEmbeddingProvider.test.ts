import { afterEach, describe, expect, it, vi } from "vitest";
import { embedOkfText } from "../convex/okfEmbeddingProvider";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OKF embedding provider egress", () => {
  it("falls back to local hashing instead of sending private OKF text to a provider", async () => {
    process.env.OKF_EMBED_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-openai-key";
    process.env.NODEAGENT_ALLOWED_PROVIDERS = "openai";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedOkfText("private board memo", "RETRIEVAL_DOCUMENT", {
      artifacts: [{ title: "Private OKF concept", visibility: "private", source: "generated" }],
      env: process.env,
    });

    expect(result).toMatchObject({ provider: "local", model: "hashing-v1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to local hashing when provider allowlist blocks the embedding model", async () => {
    process.env.OKF_EMBED_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-openai-key";
    process.env.NODEAGENT_ALLOWED_PROVIDERS = "gemini";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedOkfText("public concept", "RETRIEVAL_DOCUMENT", {
      artifacts: [{ title: "Public OKF concept", visibility: "public", source: "generated" }],
      env: process.env,
    });

    expect(result).toMatchObject({ provider: "local", model: "hashing-v1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
