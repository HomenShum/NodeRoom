import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

type EpisodeScene = {
  id: string;
  durationInFrames: number;
};

type EpisodeData = {
  episodeId: string;
  fps: number;
  scenes: EpisodeScene[];
};

type JudgeScore = {
  score?: number;
};

type JudgeReceipt = {
  verdict?: string;
  scores?: Record<string, JudgeScore>;
  defects?: Array<{ severity?: string; observed?: string }>;
};

const root = process.cwd();
const episodeId = process.argv[2];
if (!episodeId) {
  console.error("usage: publish-episode.ts <episodeId>");
  process.exit(1);
}

const run = async () => {
  const episodeDir = join(root, "episodes", episodeId);
  const renderDir = join(episodeDir, "renders");
  const videoPath = join(renderDir, "short.mp4");
  const gifPath = join(renderDir, "teaser.gif");
  const palettePath = join(renderDir, "teaser-palette.png");
  const storyboardPath = join(episodeDir, "storyboard.yaml");
  const judgeJsonPath = join(episodeDir, "judge.json");
  const judgeMarkdownPath = join(episodeDir, "judge.md");

  for (const path of [videoPath, storyboardPath, judgeJsonPath, judgeMarkdownPath]) {
    if (!existsSync(path)) throw new Error("missing required episode artifact: " + relative(root, path));
  }

  const data = (await import("file://" + join(root, "remotion", "episode.data.js"))).default as EpisodeData;
  if (data.episodeId !== episodeId) {
    throw new Error('staged episode.data.js is "' + data.episodeId + '", not "' + episodeId + '"');
  }

  const focalIndex = Math.max(0, data.scenes.findIndex((scene) => scene.id === "product-proof"));
  const focalStartSeconds = data.scenes
    .slice(0, focalIndex)
    .reduce((frames, scene) => frames + scene.durationInFrames, 0) / data.fps;
  const focalDurationSeconds = data.scenes[focalIndex]
    ? data.scenes[focalIndex].durationInFrames / data.fps
    : 10;
  const introTrimSeconds = Math.min(0.8, focalDurationSeconds / 4);
  const teaserStartSeconds = focalStartSeconds + introTrimSeconds;
  const teaserDurationSeconds = Math.min(12, focalDurationSeconds - introTrimSeconds);

  mkdirSync(renderDir, { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-ss", teaserStartSeconds.toFixed(3),
    "-t", teaserDurationSeconds.toFixed(3),
    "-i", videoPath,
    "-vf", "fps=10,scale=640:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff",
    palettePath,
  ], { stdio: "ignore" });
  execFileSync("ffmpeg", [
    "-y",
    "-ss", teaserStartSeconds.toFixed(3),
    "-t", teaserDurationSeconds.toFixed(3),
    "-i", videoPath,
    "-i", palettePath,
    "-lavfi", "fps=10,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
    "-loop", "0",
    gifPath,
  ], { stdio: "ignore" });

  const judge = JSON.parse(readFileSync(judgeJsonPath, "utf8")) as JudgeReceipt;
  const scoreValues = Object.values(judge.scores ?? {});
  const score = scoreValues.reduce((sum, item) => sum + finite(item.score), 0);
  const maxScore = scoreValues.length * 2 || 16;
  const defects = judge.defects ?? [];
  const priority = ["P0", "P1", "P2"].find((value) => defects.some((defect) => defect.severity === value)) ?? "none";
  const gap = defects.length
    ? defects.map((defect) => (defect.severity ?? "P2") + ": " + (defect.observed ?? "unspecified media defect")).join(" ")
    : "No unresolved visual-judge defects.";
  const judgeMarkdown = readFileSync(judgeMarkdownPath, "utf8");
  const judgeModel = judgeMarkdown.match(/\*\*Judge:\*\*\s+([^·\r\n]+)/)?.[1]?.trim() ?? "unknown";

  const probe = JSON.parse(execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:format=duration",
    "-of", "json",
    videoPath,
  ], { encoding: "utf8" })) as {
    streams?: Array<{ width?: number; height?: number; r_frame_rate?: string }>;
    format?: { duration?: string };
  };
  const stream = probe.streams?.[0] ?? {};
  const manifest = {
    schema: "feature-proof-media-manifest-v1",
    episodeId,
    generatedAt: new Date().toISOString(),
    storyboard: artifact(storyboardPath),
    video: {
      ...artifact(videoPath),
      width: finite(stream.width),
      height: finite(stream.height),
      fps: parseRate(stream.r_frame_rate),
      durationSeconds: finite(Number(probe.format?.duration)),
    },
    readmePreview: {
      ...artifact(gifPath),
      startSeconds: round(teaserStartSeconds),
      durationSeconds: round(teaserDurationSeconds),
    },
    visualJudge: {
      model: judgeModel,
      verdict: judge.verdict ?? "missing",
      score: score + "/" + maxScore,
      jsonPath: normalize(judgeJsonPath),
      jsonSha256: sha256(judgeJsonPath),
      markdownPath: normalize(judgeMarkdownPath),
      markdownSha256: sha256(judgeMarkdownPath),
      remainingPriority: priority,
      remainingGap: gap,
    },
  };

  writeFileSync(join(episodeDir, "media-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("[publish-episode] teaser " + round(teaserStartSeconds) + "s + " + round(teaserDurationSeconds) + "s -> " + normalize(gifPath));
  console.log("[publish-episode] judge " + manifest.visualJudge.verdict + " " + manifest.visualJudge.score + " -> " + normalize(join(episodeDir, "media-manifest.json")));
};

function artifact(path: string) {
  return {
    path: normalize(path),
    bytes: statSync(path).size,
    sha256: sha256(path),
  };
}

function normalize(path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseRate(value: string | undefined): number {
  if (!value) return 0;
  const [numerator, denominator = "1"] = value.split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
