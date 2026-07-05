import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProofloopPackageManifest,
  writeProofloopPackage,
} from "../src/eval/proofloopMultiRepoPackaging";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Proof Loop multi-repo packaging", () => {
  it("builds a public core manifest without generated/private evidence paths", () => {
    const manifest = buildProofloopPackageManifest("public-core", {
      root: process.cwd(),
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(manifest.schema).toBe("proofloop-multi-repo-package-v1");
    expect(manifest.repoName).toBe("proofloop");
    expect(manifest.visibility).toBe("public");
    expect(manifest.files).toContain("scripts/proofloop-cli.ts");
    expect(manifest.files).toContain("scripts/proofloop-buyer-validation.ts");
    expect(manifest.files).toContain("scripts/proofloop-package.ts");
    expect(manifest.files).toContain("src/eval/proofloopAgentFriendlyCli.ts");
    expect(manifest.files).toContain("src/eval/proofloopAgentFriendlyProject.ts");
    expect(manifest.files).toContain("src/eval/proofloopBuyerValidation.ts");
    expect(manifest.files).toContain("src/eval/proofloopMultiRepoPackaging.ts");
    expect(manifest.files).toContain("docs/PROOFLOOP_BUYER_VALIDATION.md");
    expect(manifest.files).toContain("docs/PROOFLOOP_MULTI_REPO_PACKAGING.md");
    expect(manifest.files.some((file) => file.startsWith(".proofloop/"))).toBe(false);
    expect(manifest.files.some((file) => file.startsWith("docs/eval/fresh-room/"))).toBe(false);
    expect(manifest.publishCommands.join("\n")).toContain("--public");
    expect(manifest.publishCommands.join("\n")).toContain("git -C .proofloop/packages/public-core/repo init -b main");
    expect(manifest.publishCommands.join("\n")).toContain("--push");
  });

  it("builds a private hosted manifest that records missing hosted components", () => {
    const manifest = buildProofloopPackageManifest("private-hosted", {
      root: process.cwd(),
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(manifest.repoName).toBe("proofloop-hosted");
    expect(manifest.visibility).toBe("private");
    expect(manifest.purpose.toLowerCase()).toContain("verification");
    expect(manifest.purpose.toLowerCase()).not.toContain("certification");
    expect(manifest.requiredMissingComponents).toContain("managed judge fleet API");
    expect(manifest.requiredMissingComponents).toContain("tenant-isolated Postgres schema");
    expect(manifest.files).toContain("docs/eval/bankertoolbench-official-contract.json");
    expect(manifest.publishCommands.join("\n")).toContain("--private");
  });

  it("writes package manifest receipts and exposes the npm package script", () => {
    const outDir = tempRoot();
    const manifest = buildProofloopPackageManifest("public-core", {
      root: process.cwd(),
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });
    const result = writeProofloopPackage(manifest, { root: process.cwd(), outDir });

    const manifestPath = join(outDir, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    expect(result.manifestPath).toContain("manifest.json");
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).target).toBe("public-core");

    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(packageJson.scripts["proofloop:package"]).toBe("tsx scripts/proofloop-package.ts");
    expect(packageJson.scripts["proofloop:buyer-validation"]).toBe("tsx scripts/proofloop-buyer-validation.ts");
  });

  it("clears stale copied files before rewriting a package repo", () => {
    const outDir = tempRoot();
    const manifest = buildProofloopPackageManifest("public-core", {
      root: process.cwd(),
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });

    writeProofloopPackage(manifest, { root: process.cwd(), outDir, copyFiles: true });
    const stalePath = join(outDir, "repo", "stale-from-old-manifest.txt");
    writeFileSync(stalePath, "old package file\n", "utf8");
    expect(existsSync(stalePath)).toBe(true);

    writeProofloopPackage(manifest, { root: process.cwd(), outDir, copyFiles: true });

    expect(existsSync(stalePath)).toBe(false);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-package-"));
  tempRoots.push(root);
  return root;
}
