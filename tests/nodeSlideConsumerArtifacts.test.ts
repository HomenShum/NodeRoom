import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNodeSlidePackedArtifacts } from "../scripts/nodeslide-consumer-artifacts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function artifactDirectory(entries: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "noderoom-nodeslide-artifacts-"));
  temporaryDirectories.push(directory);
  await Promise.all(entries.map((entry) => writeFile(join(directory, entry), entry)));
  return directory;
}

const closure = [
  "nodeslide-contracts-0.1.0.tgz",
  "nodeslide-engine-0.1.0.tgz",
  "nodeslide-backend-0.1.0.tgz",
  "nodeslide-testing-0.1.0.tgz",
] as const;

describe("NodeSlide packed consumer artifacts", () => {
  it("resolves one complete private dependency closure in dependency order", async () => {
    const directory = await artifactDirectory([...closure].reverse());

    const resolved = await resolveNodeSlidePackedArtifacts(directory);

    expect(resolved.testingArtifact).toBe(join(directory, "nodeslide-testing-0.1.0.tgz"));
    expect(resolved.installArtifacts).toEqual(closure.map((entry) => join(directory, entry)));
  });

  it("rejects a directory without the testing entrypoint", async () => {
    const directory = await artifactDirectory(closure.filter((entry) => !entry.includes("testing")));

    await expect(resolveNodeSlidePackedArtifacts(directory)).rejects.toThrow(
      /exactly one nodeslide-testing-\*\.tgz; found 0/u,
    );
  });

  it("rejects ambiguous testing artifacts", async () => {
    const directory = await artifactDirectory([
      ...closure,
      "nodeslide-testing-0.1.1.tgz",
    ]);

    await expect(resolveNodeSlidePackedArtifacts(directory)).rejects.toThrow(
      /exactly one nodeslide-testing-\*\.tgz; found 2/u,
    );
  });

  it("rejects an incomplete or mixed-version dependency closure", async () => {
    const incomplete = await artifactDirectory(
      closure.filter((entry) => !entry.includes("backend")),
    );
    await expect(resolveNodeSlidePackedArtifacts(incomplete)).rejects.toThrow(
      /exactly one nodeslide-backend-\*\.tgz; found 0/u,
    );

    const mixed = await artifactDirectory(
      closure.map((entry) => entry.replace("engine-0.1.0", "engine-0.2.0")),
    );
    await expect(resolveNodeSlidePackedArtifacts(mixed)).rejects.toThrow(
      /mixes NodeSlide package versions/u,
    );
  });

  it("preserves explicit testing-tarball input without discovering siblings", async () => {
    const directory = await artifactDirectory(closure);
    const testing = join(directory, "nodeslide-testing-0.1.0.tgz");

    await expect(resolveNodeSlidePackedArtifacts(testing)).resolves.toEqual({
      testingArtifact: testing,
      installArtifacts: [testing],
    });
    await expect(
      resolveNodeSlidePackedArtifacts(join(directory, "nodeslide-engine-0.1.0.tgz")),
    ).rejects.toThrow(/not a nodeslide-testing-\*\.tgz artifact/u);
  });
});
