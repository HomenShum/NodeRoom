import { describe, expect, it } from "vitest";
import {
  FREE_FILE_EGRESS_BLOCK_REASON,
  freeFileEgressPromotionAllowed,
  hasFileDerivedProviderEgress,
  isProviderNonRetryableError,
  isProviderPolicyBlockedError,
  providerNonRetryableReason,
  providerEgressDecision,
  providerPolicyBlockedReason,
  providerRouteDecision,
} from "../src/nodeagent/guardrails/egressPolicy";

describe("provider route policy", () => {
  it("blocks providers outside the production allowlist before any HTTP request", () => {
    const decision = providerRouteDecision({
      model: "gemini-3.5-flash",
      entrypoint: "public_ask",
      env: { NODEAGENT_ALLOWED_PROVIDERS: "openrouter" },
    });

    expect(decision).toMatchObject({
      ok: false,
      policy: "provider_route_v1",
      reason: "provider_not_allowed",
      provider: "gemini",
    });
  });

  it("fails the free entrypoint closed when it is pointed at a paid model without an explicit override", () => {
    const blocked = providerRouteDecision({
      model: "gemini-3.5-flash",
      entrypoint: "free",
      env: {},
    });
    const allowed = providerRouteDecision({
      model: "gemini-3.5-flash",
      entrypoint: "free",
      env: { FREE_AUTO_ALLOW_PAID_MODEL: "1" },
    });

    expect(blocked).toMatchObject({
      ok: false,
      reason: "free_entrypoint_requires_free_model_or_FREE_AUTO_ALLOW_PAID_MODEL",
    });
    expect(allowed).toMatchObject({
      ok: true,
      provider: "gemini",
      entrypoint: "free",
    });
  });

  it("emits auditable route receipts for allowed provider calls", () => {
    const decision = providerRouteDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      env: { OPENROUTER_REQUIRE_NO_TRAINING: "1" },
    });

    expect(decision).toMatchObject({
      ok: true,
      policy: "provider_route_v1",
      provider: "openrouter",
      noTrainingRequired: true,
    });
    expect(decision.basis.join(" ")).toContain("no_training_required:true");
  });

  it("routes OKF embedding models through the same provider allowlist", () => {
    expect(providerRouteDecision({
      model: "text-embedding-3-small",
      entrypoint: "okf_embedding",
      env: { NODEAGENT_ALLOWED_PROVIDERS: "openai" },
    })).toMatchObject({
      ok: true,
      provider: "openai",
      entrypoint: "okf_embedding",
    });

    expect(providerRouteDecision({
      model: "text-embedding-3-small",
      entrypoint: "okf_embedding",
      env: { NODEAGENT_ALLOWED_PROVIDERS: "gemini" },
    })).toMatchObject({
      ok: false,
      reason: "provider_not_allowed",
      provider: "openai",
    });
  });

  it("fails closed in production mode when no external provider allowlist is configured", () => {
    const blocked = providerRouteDecision({
      model: "gemini-3.5-flash",
      entrypoint: "public_ask",
      env: { PROVIDER_EGRESS_REQUIRE_ALLOWLIST: "1" },
    });
    const local = providerRouteDecision({
      model: "local",
      entrypoint: "public_ask",
      env: { PROVIDER_EGRESS_REQUIRE_ALLOWLIST: "1" },
    });

    expect(blocked).toMatchObject({ ok: false, reason: "provider_not_allowed", provider: "gemini" });
    expect(local).toMatchObject({ ok: true, provider: "local" });
  });

  it("blocks quarantined routes before any provider request is attempted", () => {
    const route = providerRouteDecision({
      model: "qwen/qwen3-coder:free",
      entrypoint: "free",
      env: {
        NODEAGENT_QUARANTINED_MODELS: "qwen/qwen3-coder:free=rate_limited",
        OPENROUTER_REQUIRE_NO_TRAINING: "1",
      },
    });
    const provider = providerRouteDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      env: {
        NODEAGENT_QUARANTINED_PROVIDERS: "openrouter=incident",
        OPENROUTER_REQUIRE_NO_TRAINING: "1",
      },
    });

    expect(route).toMatchObject({ ok: false, reason: "route_quarantined", provider: "openrouter" });
    expect(route.basis.join(" ")).toContain("quarantine_reason:rate_limited");
    expect(provider).toMatchObject({ ok: false, reason: "provider_quarantined", provider: "openrouter" });
  });
});

describe("provider artifact egress policy", () => {
  it("blocks private-agent context when any included artifact is local-only or sensitive", () => {
    expect(providerEgressDecision({
      model: "gemini-3.5-flash",
      entrypoint: "private_agent",
      artifacts: [{ title: "Board pack", meta: { privacy: { egress: "local_only" } } }],
      env: {},
    })).toMatchObject({ ok: false, reason: "explicit_local_only" });

    expect(providerEgressDecision({
      model: "gemini-3.5-flash",
      entrypoint: "private_agent",
      artifacts: [{ title: "Comp plan", meta: { classification: "restricted" } }],
      env: {},
    })).toMatchObject({ ok: false, reason: "sensitive_artifact" });
  });

  it("blocks artifacts marked private even when metadata is otherwise sparse", () => {
    expect(providerEgressDecision({
      model: "gemini-3.5-flash",
      entrypoint: "public_ask",
      artifacts: [{ title: "Founder call", visibility: "private" }],
      env: {},
    })).toMatchObject({ ok: false, reason: "sensitive_artifact", artifactTitle: "Founder call" });
  });

  it("blocks free-route file-derived and provider-derived artifacts unless the required policy flags are set", () => {
    const fileDerived = { title: "Uploaded OCR", meta: { document: { status: "server_parser_required" } } };
    const providerDerived = { title: "Gemini parse", meta: { providerParse: { providerFileId: "file-1" } } };
    const sourceMarkedUpload = { title: "Raw upload", source: "upload" };

    expect(providerEgressDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      artifacts: [fileDerived],
      env: {},
    })).toMatchObject({ ok: false, reason: "free_file_egress_requires_OPENROUTER_FREE_ALLOW_FILE_EGRESS" });

    expect(providerEgressDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      artifacts: [providerDerived],
      env: { OPENROUTER_FREE_ALLOW_FILE_EGRESS: "1" },
    })).toMatchObject({ ok: false, reason: "free_provider_parse_requires_OPENROUTER_REQUIRE_NO_TRAINING" });

    expect(providerEgressDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      artifacts: [providerDerived],
      env: { OPENROUTER_FREE_ALLOW_FILE_EGRESS: "1", OPENROUTER_REQUIRE_NO_TRAINING: "1" },
    })).toMatchObject({ ok: true });

    expect(providerEgressDecision({
      model: "openrouter/free-auto",
      entrypoint: "free",
      artifacts: [sourceMarkedUpload],
      env: {},
    })).toMatchObject({ ok: false, reason: "free_file_egress_requires_OPENROUTER_FREE_ALLOW_FILE_EGRESS" });
  });

  it("requires explicit file-egress approval for live provider parser calls", () => {
    const uploadedFile = { title: "diligence.pdf", meta: { upload: { fileName: "diligence.pdf", mimeType: "application/pdf", size: 1000 } } };

    expect(providerEgressDecision({
      model: "gpt-5.4-mini",
      entrypoint: "provider_parser",
      artifacts: [uploadedFile],
      env: {},
    })).toMatchObject({
      ok: false,
      reason: "provider_parser_file_egress_requires_PROVIDER_PARSER_ALLOW_FILE_EGRESS",
    });

    expect(providerEgressDecision({
      model: "gpt-5.4-mini",
      entrypoint: "provider_parser",
      artifacts: [uploadedFile],
      env: { PROVIDER_PARSER_ALLOW_FILE_EGRESS: "1" },
    })).toMatchObject({ ok: true });
  });

  it("exposes deterministic helpers for file-egress route promotion and non-retry failures", () => {
    expect(hasFileDerivedProviderEgress([
      { title: "Manual note", source: "manual" },
      { title: "source_financials.csv", meta: { upload: { fileName: "source_financials.csv" } } },
    ])).toBe(true);
    expect(providerPolicyBlockedReason(new Error(`provider_egress_blocked:${FREE_FILE_EGRESS_BLOCK_REASON}`))).toBe(FREE_FILE_EGRESS_BLOCK_REASON);
    expect(isProviderPolicyBlockedError(new Error("provider_route_blocked:provider_not_allowed"))).toBe(true);
    expect(isProviderPolicyBlockedError(new Error("rate_limit_retryable"))).toBe(false);
    expect(providerNonRetryableReason(new Error('Provider request failed 402: {"error":{"message":"Insufficient credits"}}'))).toBe("provider_insufficient_credits");
    expect(isProviderNonRetryableError(new Error("Provider request failed 401: Unauthorized"))).toBe(true);
    expect(isProviderNonRetryableError(new Error("Provider request failed 429: rate limited"))).toBe(false);
    expect(providerNonRetryableReason(new Error('Provider request failed 429: {"error":{"message":"Rate limit exceeded: free-models-per-day-high-balance","metadata":{"headers":{"X-RateLimit-Remaining":"0"}}}}'))).toBe("provider_free_quota_exhausted");
    expect(isProviderNonRetryableError(new Error('Provider stream failed 429: X-RateLimit-Remaining: "0"'))).toBe(true);
    expect(freeFileEgressPromotionAllowed({ FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION: "0" })).toBe(false);
    expect(freeFileEgressPromotionAllowed({ FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION: "1" })).toBe(true);
  });
});
