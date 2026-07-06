import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

export type ProofloopArtifactFile = {
  kind: "receipt" | "video" | "screenshot" | "other";
  sourcePath: string;
  handoffPath: string;
  sizeBytes: number;
  sha256: string;
};

export type ProofloopArtifactHandoffManifest = {
  schema: "proofloop-artifact-handoff-v1";
  runId: string;
  suite: string;
  generatedAt: string;
  status: "ready" | "missing_video";
  runRoot: string;
  testResultsDir: string;
  handoffDir: string;
  videos: ProofloopArtifactFile[];
  receipts: ProofloopArtifactFile[];
  screenshots: ProofloopArtifactFile[];
  otherFiles: ProofloopArtifactFile[];
  mp4Paths: string[];
  warnings: string[];
};

export type CollectProofloopArtifactHandoffOptions = {
  root: string;
  runId: string;
  suite: string;
  runRoot?: string;
  testResultsDir?: string;
  handoffDir?: string;
  convertVideo?: boolean;
  requireVideo?: boolean;
  ffmpeg?: string;
  clean?: boolean;
  now?: () => Date;
};

const RECEIPT_EXTENSIONS = new Set([".json", ".md", ".txt"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);
const SCREENSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function collectProofloopArtifactHandoff(options: CollectProofloopArtifactHandoffOptions): ProofloopArtifactHandoffManifest {
  const root = resolve(options.root);
  const runId = required(options.runId, "runId");
  const suite = required(options.suite, "suite");
  const runRoot = resolve(root, options.runRoot ?? join(".proofloop", "runs", runId));
  const testResultsDir = resolve(root, options.testResultsDir ?? "test-results");
  const handoffDir = resolve(root, options.handoffDir ?? join(".proofloop", "runs", runId, "handoff"));
  const videosDir = join(handoffDir, "videos");
  const receiptsDir = join(handoffDir, "receipts");
  const screenshotsDir = join(handoffDir, "screenshots");
  const otherDir = join(handoffDir, "other");
  const warnings: string[] = [];

  if (options.clean !== false) rmSync(handoffDir, { recursive: true, force: true });
  mkdirSync(videosDir, { recursive: true });
  mkdirSync(receiptsDir, { recursive: true });
  mkdirSync(screenshotsDir, { recursive: true });
  mkdirSync(otherDir, { recursive: true });

  const copiedVideos = collectVideos({
    root,
    testResultsDir,
    videosDir,
    convertVideo: options.convertVideo !== false,
    ffmpeg: options.ffmpeg ?? "ffmpeg",
    warnings,
  });
  const copiedRunFiles = collectRunFiles({ root, runRoot, handoffDir, receiptsDir, screenshotsDir, otherDir });

  const manifest: ProofloopArtifactHandoffManifest = {
    schema: "proofloop-artifact-handoff-v1",
    runId,
    suite,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    status: copiedVideos.length > 0 ? "ready" : "missing_video",
    runRoot: relativeOrSelf(root, runRoot),
    testResultsDir: relativeOrSelf(root, testResultsDir),
    handoffDir: relativeOrSelf(root, handoffDir),
    videos: copiedVideos,
    receipts: copiedRunFiles.filter((file) => file.kind === "receipt"),
    screenshots: copiedRunFiles.filter((file) => file.kind === "screenshot"),
    otherFiles: copiedRunFiles.filter((file) => file.kind === "other"),
    mp4Paths: copiedVideos.filter((file) => extname(file.handoffPath).toLowerCase() === ".mp4").map((file) => file.handoffPath),
    warnings,
  };

  writeFileSync(join(handoffDir, "artifact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(join(handoffDir, "HANDOFF.md"), renderProofloopArtifactHandoffMarkdown(manifest), "utf8");

  if (options.requireVideo && manifest.status !== "ready") {
    throw new Error(`proofloop artifact handoff is missing video evidence in ${relativeOrSelf(root, testResultsDir)}`);
  }
  return manifest;
}

export function renderProofloopArtifactHandoffMarkdown(manifest: ProofloopArtifactHandoffManifest): string {
  return [
    `# ProofLoop Artifact Handoff: ${manifest.suite}`,
    "",
    `Run: ${manifest.runId}`,
    `Status: ${manifest.status}`,
    `Generated: ${manifest.generatedAt}`,
    "",
    "## Video Evidence",
    "",
    manifest.videos.length
      ? manifest.videos.map((file) => `- \`${file.handoffPath}\` (${file.sizeBytes} bytes, sha256 ${file.sha256})`).join("\n")
      : "- Missing video evidence.",
    "",
    "## Receipts",
    "",
    manifest.receipts.length
      ? manifest.receipts.map((file) => `- \`${file.handoffPath}\` (${file.sizeBytes} bytes, sha256 ${file.sha256})`).join("\n")
      : "- No receipts found.",
    "",
    "## Screenshots",
    "",
    manifest.screenshots.length
      ? manifest.screenshots.map((file) => `- \`${file.handoffPath}\` (${file.sizeBytes} bytes, sha256 ${file.sha256})`).join("\n")
      : "- No screenshots found.",
    "",
    "## Warnings",
    "",
    manifest.warnings.length ? manifest.warnings.map((warning) => `- ${warning}`).join("\n") : "- none",
    "",
  ].join("\n");
}

function collectVideos(args: {
  root: string;
  testResultsDir: string;
  videosDir: string;
  convertVideo: boolean;
  ffmpeg: string;
  warnings: string[];
}): ProofloopArtifactFile[] {
  if (!existsSync(args.testResultsDir)) {
    args.warnings.push(`test results directory missing: ${relativeOrSelf(args.root, args.testResultsDir)}`);
    return [];
  }

  const files = listFiles(args.testResultsDir)
    .filter((file) => VIDEO_EXTENSIONS.has(extname(file).toLowerCase()))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const out: ProofloopArtifactFile[] = [];
  for (const source of files) {
    const safeName = uniqueName(args.videosDir, basename(source));
    const copied = join(args.videosDir, safeName);
    copyFileSync(source, copied);
    out.push(fileRecord(args.root, source, copied, "video"));

    if (args.convertVideo && extname(source).toLowerCase() === ".webm") {
      const mp4Path = join(args.videosDir, `${safeName.replace(/\.webm$/i, "")}.mp4`);
      const result = spawnSync(args.ffmpeg, [
        "-y",
        "-i",
        copied,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4Path,
      ], { encoding: "utf8", windowsHide: true });
      if (result.status === 0 && existsSync(mp4Path)) {
        out.push(fileRecord(args.root, copied, mp4Path, "video"));
      } else {
        args.warnings.push(`ffmpeg conversion failed for ${relativeOrSelf(args.root, copied)}`);
      }
    }
  }
  return out;
}

function collectRunFiles(args: {
  root: string;
  runRoot: string;
  handoffDir: string;
  receiptsDir: string;
  screenshotsDir: string;
  otherDir: string;
}): ProofloopArtifactFile[] {
  if (!existsSync(args.runRoot)) return [];
  return listFiles(args.runRoot)
    .filter((source) => !isInside(source, args.handoffDir))
    .map((source) => {
      const extension = extname(source).toLowerCase();
      const kind = SCREENSHOT_EXTENSIONS.has(extension)
        ? "screenshot"
        : RECEIPT_EXTENSIONS.has(extension)
          ? "receipt"
          : "other";
      const targetBase = kind === "screenshot" ? args.screenshotsDir : kind === "receipt" ? args.receiptsDir : args.otherDir;
      const sourceRelative = relative(args.runRoot, source);
      const target = join(targetBase, sourceRelative);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      return fileRecord(args.root, source, target, kind);
    });
}

function fileRecord(root: string, sourcePath: string, handoffPath: string, kind: ProofloopArtifactFile["kind"]): ProofloopArtifactFile {
  const bytes = readFileSync(handoffPath);
  return {
    kind,
    sourcePath: relativeOrSelf(root, sourcePath),
    handoffPath: relativeOrSelf(root, handoffPath),
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function uniqueName(dir: string, name: string): string {
  let candidate = name;
  let index = 1;
  while (existsSync(join(dir, candidate))) {
    const extension = extname(name);
    candidate = `${name.slice(0, name.length - extension.length)}-${index}${extension}`;
    index += 1;
  }
  return candidate;
}

function required(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function isInside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function relativeOrSelf(root: string, path: string): string {
  const rel = relative(root, path).replace(/\\/g, "/");
  return rel || ".";
}
