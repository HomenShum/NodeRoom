import { describe, expect, it } from "vitest";
import {
  extractProviderExtractionWithFallback,
  providerFileCacheId,
  providerParserModelCandidates,
  runLiveProviderParser,
  sanitizeProviderError,
} from "../src/nodeagent/models/providerParserLive";
import type { CanonicalFileRef } from "../src/app/providerParserAdapter";

const file: CanonicalFileRef = {
  storageId: "convex-storage-123",
  artifactId: "artifact-raw",
  fileName: "diligence.pdf",
  mimeType: "application/pdf",
  size: 42_000,
};

describe("live provider parser helpers", () => {
  it("keeps provider cache ids separate from Convex storage ids", () => {
    const providerFileId = providerFileCacheId("openrouter", file, { text: "ARR $12M" });
    expect(providerFileId).toMatch(/^openrouter:inline:/);
    expect(providerFileId).not.toBe(file.storageId);
    expect(providerFileId).not.toContain(file.storageId);
  });

  it("prefers explicit and env models before defaults without duplicates", () => {
    // Defaults were [3.5-flash, 3-flash-preview, 2.5-flash, 2.0-flash]; 2.5 expires on OpenRouter 2026-10-20 and 2.0 is
    // shut down, so the defaults are [3.8-flash, 3.6-flash]. The preferred id (3.8) and the env id (3.6) are BOTH
    // defaults, so this still proves de-duplication: each appears once, preferred first, then env, then the rest.
    const candidates = providerParserModelCandidates("gemini", "gemini-3.8-flash", {
      PROVIDER_PARSER_GEMINI_MODEL: "gemini-3.6-flash",
    });
    expect(candidates).toEqual(["gemini-3.8-flash", "gemini-3.6-flash"]);
  });

  it("redacts API key values from provider errors", () => {
    const message = sanitizeProviderError(new Error("bad key sk-live-secret-token-value"), {
      OPENAI_API_KEY: "sk-live-secret-token-value",
    });
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("sk-live-secret-token-value");
  });

  it("keeps the text JSON fallback load-bearing when native structured output fails", async () => {
    const extraction = await extractProviderExtractionWithFallback({
      structured: async () => {
        throw new Error("google structured output failed with key sk-live-secret-token-value");
      },
      text: async () => JSON.stringify({
        tables: [{ title: "KPIs", columns: ["Metric", "Value"], rows: [["ARR", "$12M"]], confidence: 0.9 }],
        evidence: [{
          label: "KPI table",
          snippet: "ARR $12M",
          table: "KPIs",
          row: 1,
          column: "Value",
          page: 2,
          bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1, unit: "normalized" },
          confidence: 0.9,
        }],
      }),
      describeStructuredError: (error) => sanitizeProviderError(error, {
        GOOGLE_GENERATIVE_AI_API_KEY: "sk-live-secret-token-value",
      }),
    });

    expect(extraction.tables?.[0]?.rows).toEqual([["ARR", "$12M"]]);
    expect(extraction.evidence?.[0]?.bbox).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.1, unit: "normalized" });
    expect(extraction.warnings?.[0]).toContain("Structured output fallback used");
    expect(extraction.warnings?.[0]).not.toContain("sk-live-secret-token-value");
  });

  it("blocks live provider parsing of file-derived content until egress is explicitly allowed", async () => {
    const previous = process.env.PROVIDER_PARSER_ALLOW_FILE_EGRESS;
    delete process.env.PROVIDER_PARSER_ALLOW_FILE_EGRESS;
    try {
      await expect(runLiveProviderParser({
        provider: "openai",
        file,
        source: { text: "ARR $12M" },
      })).rejects.toThrow(/provider_egress_blocked:provider_parser_file_egress_requires_PROVIDER_PARSER_ALLOW_FILE_EGRESS/);
    } finally {
      if (previous === undefined) delete process.env.PROVIDER_PARSER_ALLOW_FILE_EGRESS;
      else process.env.PROVIDER_PARSER_ALLOW_FILE_EGRESS = previous;
    }
  });
});
