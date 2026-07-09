import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const input = optionValue("--input");
const mode = optionValue("--mode") ?? "readable";
const outArg = optionValue("--out");
const dryRun = hasFlag("--dry-run");

if (!input) throw new Error("Pass --input <video>");
if (!["readable", "review"].includes(mode)) throw new Error("--mode must be readable or review");

const inputPath = joinOrAbsolute(input);
if (!existsSync(inputPath)) throw new Error(`Input video not found: ${input}`);

const suffix = mode === "review" ? "review" : "720p";
const outputPath = outArg ? joinOrAbsolute(outArg) : join(ROOT, "docs", "seo", "journey-artifacts", `${basename(inputPath, extname(inputPath))}.${suffix}.mp4`);
mkdirSync(dirname(outputPath), { recursive: true });

const vf = mode === "review"
  ? "fps=6,scale='min(960,iw)':-2"
  : "fps=15,scale='min(1280,iw)':-2";
const crf = mode === "review" ? "34" : "26";
const argsForFfmpeg = [
  "-y",
  "-i", inputPath,
  "-vf", vf,
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", crf,
  "-movflags", "+faststart",
  "-an",
  outputPath,
];

if (dryRun) {
  console.log(`ffmpeg ${argsForFfmpeg.map(quote).join(" ")}`);
  process.exit(0);
}

try {
  execFileSync("ffmpeg", argsForFfmpeg, { stdio: "inherit" });
} catch (error) {
  throw new Error(`ffmpeg compression failed. Install ffmpeg or pass --dry-run to inspect the command. ${error instanceof Error ? error.message : String(error)}`);
}

const inputSize = statSync(inputPath).size;
const outputSize = statSync(outputPath).size;
console.log(JSON.stringify({
  input: slash(relative(ROOT, inputPath)),
  output: slash(relative(ROOT, outputPath)),
  mode,
  inputBytes: inputSize,
  outputBytes: outputSize,
  ratio: Number((outputSize / Math.max(1, inputSize)).toFixed(3)),
}, null, 2));

function joinOrAbsolute(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") ? path : join(ROOT, path);
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (inline !== undefined) return inline;
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function quote(value: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

function slash(path: string): string {
  return path.replace(/\\/g, "/");
}
