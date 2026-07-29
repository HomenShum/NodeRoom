import { lstat, readFile } from "node:fs/promises";
import path, { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadBuildEnvironment, resolveBuildSha } from "../vite.config";

export const BUILD_PROVENANCE_HTML_ENTRIES = [
  "index.html",
  "ai-elements-check.html",
] as const;

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`NodeRoom build provenance verification failed: ${message}`);
}

function readAttribute(tag: string, attribute: string): string | undefined {
  const match = tag.match(new RegExp(
    `\\b${attribute}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>]+))`,
    "iu",
  ));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

async function readBoundedHtml(file: string, entry: string): Promise<string> {
  const metadata = await lstat(file);
  invariant(metadata.isFile() && !metadata.isSymbolicLink(), `${entry} must be a regular file`);
  invariant(metadata.size <= MAX_HTML_BYTES, `${entry} exceeds ${MAX_HTML_BYTES} bytes`);
  return readFile(file, "utf8");
}

export async function verifyBuildProvenanceOutput(options: Readonly<{
  expectedSha: string;
  outputRoot: string;
}>): Promise<{
  entries: string[];
  expectedSha: string;
}> {
  const expectedSha = options.expectedSha.trim().toLowerCase();
  invariant(SHA_PATTERN.test(expectedSha), "expected SHA is malformed");
  const outputRoot = resolve(options.outputRoot);

  for (const entry of BUILD_PROVENANCE_HTML_ENTRIES) {
    const html = await readBoundedHtml(path.join(outputRoot, entry), entry);
    const provenanceTags = (html.match(/<meta\b[^>]*>/giu) ?? [])
      .filter((tag) => readAttribute(tag, "name") === "noderoom-build-sha");
    invariant(
      provenanceTags.length === 1,
      `${entry} must contain exactly one noderoom-build-sha meta tag`,
    );
    const [tag] = provenanceTags;
    invariant(
      readAttribute(tag, "content") === expectedSha,
      `${entry} build SHA does not match the verified checkout`,
    );
    invariant(
      readAttribute(tag, "data-provenance") === "commit",
      `${entry} provenance status must be commit`,
    );
  }

  return {
    entries: [...BUILD_PROVENANCE_HTML_ENTRIES],
    expectedSha,
  };
}

async function main(): Promise<void> {
  const expectedSha = resolveBuildSha(loadBuildEnvironment("production"), { strict: true });
  const result = await verifyBuildProvenanceOutput({
    expectedSha,
    outputRoot: resolve("dist"),
  });
  process.stdout.write(`${JSON.stringify({
    status: "pass",
    ...result,
  })}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
