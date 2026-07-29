import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProvenanceMeta,
  loadBuildEnvironment,
  readCheckoutSha,
  requiresStrictBuildProvenance,
  resolveBuildSha,
  UNAVAILABLE_BUILD_SHA,
} from "../vite.config";
import {
  BUILD_PROVENANCE_HTML_ENTRIES,
  verifyBuildProvenanceOutput,
} from "../scripts/verify-build-provenance";

const checkoutSha = "6d3bd7a913d41f4ffb773087164585389454cb15";
const conflictingSha = "b007e700da82ab2ae0956919b67b265d3d4e368f";
const temporaryDirectories: string[] = [];

async function createOutput(entries: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "noderoom-build-provenance-"));
  temporaryDirectories.push(root);
  await Promise.all(
    Object.entries(entries).map(([file, html]) => writeFile(path.join(root, file), html, "utf8")),
  );
  return root;
}

function htmlWithProvenance(sha: string): string {
  return `<!doctype html><html><head><meta data-provenance="commit" content="${sha}" name="noderoom-build-sha"></head><body></body></html>`;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { force: true, recursive: true }),
  ));
});

describe("build provenance identity", () => {
  it("enforces strict provenance for every production build and CI execution", () => {
    expect(requiresStrictBuildProvenance("build", "development", {})).toBe(true);
    expect(requiresStrictBuildProvenance("serve", "production", {})).toBe(true);
    expect(requiresStrictBuildProvenance("serve", "test", { CI: "true" })).toBe(true);
    expect(requiresStrictBuildProvenance("serve", "development", {})).toBe(false);
  });

  it("binds matching Vercel, GitHub, and explicit signals to the actual checkout", () => {
    expect(resolveBuildSha({
      VERCEL_GIT_COMMIT_SHA: checkoutSha.toUpperCase(),
      GITHUB_SHA: ` ${checkoutSha} `,
      VITE_GIT_SHA: checkoutSha,
    }, {
      checkoutSha,
      strict: true,
    })).toBe(checkoutSha);
  });

  it("loads an explicit SHA from Vite production env files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "noderoom-build-env-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, ".env.production"), `VITE_GIT_SHA=${checkoutSha}\n`, "utf8");
    const previousExplicitSha = process.env.VITE_GIT_SHA;
    delete process.env.VITE_GIT_SHA;
    try {
      expect(loadBuildEnvironment("production", root, {}).VITE_GIT_SHA).toBe(checkoutSha);
    } finally {
      if (previousExplicitSha === undefined) delete process.env.VITE_GIT_SHA;
      else process.env.VITE_GIT_SHA = previousExplicitSha;
    }
  });

  it("keeps deployment process variables authoritative over env-file defaults", () => {
    expect(loadBuildEnvironment("production", process.cwd(), {
      VITE_GIT_SHA: checkoutSha,
    }).VITE_GIT_SHA).toBe(checkoutSha);
  });

  it("uses the actual checkout when a local production build has no provider signal", () => {
    expect(resolveBuildSha({}, {
      checkoutSha,
      strict: true,
    })).toBe(checkoutSha);
  });

  it("fails a production build when checkout identity is absent", () => {
    expect(() => resolveBuildSha({}, {
      checkoutSha: null,
      strict: true,
    })).toThrow(/actual Git checkout SHA is unavailable/);
  });

  it("fails a production build instead of falling through malformed provider data", () => {
    expect(() => resolveBuildSha({
      VERCEL_GIT_COMMIT_SHA: "not-a-commit",
      GITHUB_SHA: checkoutSha,
    }, {
      checkoutSha,
      strict: true,
    })).toThrow(/malformed build SHA signal: VERCEL_GIT_COMMIT_SHA/);
  });

  it("fails a production build when otherwise valid signals conflict", () => {
    expect(() => resolveBuildSha({
      GITHUB_SHA: checkoutSha,
      VITE_GIT_SHA: conflictingSha,
    }, {
      checkoutSha,
      strict: true,
    })).toThrow(/conflicting build SHA signals: GITHUB_SHA, VITE_GIT_SHA/);
  });

  it("fails a production build when a provider signal does not match the checkout", () => {
    expect(() => resolveBuildSha({
      VERCEL_GIT_COMMIT_SHA: conflictingSha,
    }, {
      checkoutSha,
      strict: true,
    })).toThrow(/build SHA signal does not match the actual Git checkout/);
  });

  it("binds GitHub pull-request provenance to the checked-out merge commit", () => {
    expect(resolveBuildSha({
      GITHUB_SHA: checkoutSha,
    }, {
      checkoutSha,
      strict: true,
    })).toBe(checkoutSha);
    expect(() => resolveBuildSha({
      GITHUB_SHA: conflictingSha,
    }, {
      checkoutSha,
      strict: true,
    })).toThrow(/build SHA signal does not match the actual Git checkout/);
  });

  it("permits unavailable metadata only for non-production development", () => {
    expect(resolveBuildSha({}, {
      checkoutSha: null,
      strict: false,
    })).toBe(UNAVAILABLE_BUILD_SHA);
    expect(buildProvenanceMeta({}, {
      checkoutSha: null,
      strict: false,
    })).toEqual({
      tag: "meta",
      attrs: {
        name: "noderoom-build-sha",
        content: UNAVAILABLE_BUILD_SHA,
        "data-provenance": "unavailable",
      },
      injectTo: "head",
    });
  });

  it("does not reflect an attacker-controlled pseudo SHA into development HTML", () => {
    const hostile = `deadbeef"><script>alert("release")</script>`;
    expect(resolveBuildSha({
      VITE_GIT_SHA: hostile,
    }, {
      checkoutSha,
      strict: false,
    })).toBe(UNAVAILABLE_BUILD_SHA);
    expect(JSON.stringify(buildProvenanceMeta({
      VITE_GIT_SHA: hostile,
    }, {
      checkoutSha,
      strict: false,
    }))).not.toContain("<script>");
  });

  it("supports a full-length SHA-256 Git object identity", () => {
    const sha256 = "a".repeat(64);
    expect(resolveBuildSha({
      GITHUB_SHA: sha256,
    }, {
      checkoutSha: sha256,
      strict: true,
    })).toBe(sha256);
  });

  it("resolves this repository's real checkout for the production config", () => {
    const actualCheckout = readCheckoutSha();
    expect(actualCheckout).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
    expect(resolveBuildSha({}, {
      checkoutSha: actualCheckout,
      strict: true,
    })).toBe(actualCheckout);
  });
});

describe("raw build provenance output", () => {
  it("verifies the exact checkout identity in both generated HTML entries", async () => {
    const outputRoot = await createOutput(Object.fromEntries(
      BUILD_PROVENANCE_HTML_ENTRIES.map((entry) => [entry, htmlWithProvenance(checkoutSha)]),
    ));

    await expect(verifyBuildProvenanceOutput({
      expectedSha: checkoutSha,
      outputRoot,
    })).resolves.toEqual({
      entries: [...BUILD_PROVENANCE_HTML_ENTRIES],
      expectedSha: checkoutSha,
    });
  });

  it("fails when the secondary HTML entry carries a different commit", async () => {
    const outputRoot = await createOutput({
      "index.html": htmlWithProvenance(checkoutSha),
      "ai-elements-check.html": htmlWithProvenance(conflictingSha),
    });

    await expect(verifyBuildProvenanceOutput({
      expectedSha: checkoutSha,
      outputRoot,
    })).rejects.toThrow(/ai-elements-check\.html build SHA does not match/);
  });

  it("fails when either raw HTML entry is missing its single provenance tag", async () => {
    const outputRoot = await createOutput({
      "index.html": htmlWithProvenance(checkoutSha),
      "ai-elements-check.html": "<!doctype html><html><head></head><body></body></html>",
    });

    await expect(verifyBuildProvenanceOutput({
      expectedSha: checkoutSha,
      outputRoot,
    })).rejects.toThrow(/ai-elements-check\.html must contain exactly one/);
  });

  it("fails when an unquoted duplicate provenance tag is appended", async () => {
    const duplicate = `<meta name=noderoom-build-sha content=${checkoutSha} data-provenance=commit>`;
    const outputRoot = await createOutput({
      "index.html": htmlWithProvenance(checkoutSha),
      "ai-elements-check.html": htmlWithProvenance(checkoutSha).replace("</head>", `${duplicate}</head>`),
    });

    await expect(verifyBuildProvenanceOutput({
      expectedSha: checkoutSha,
      outputRoot,
    })).rejects.toThrow(/ai-elements-check\.html must contain exactly one/);
  });
});
