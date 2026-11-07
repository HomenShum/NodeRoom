import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

export type SpreadsheetBenchChartVisualProbeStatus =
  | "chart_visual_grade_proven"
  | "renderer_unavailable"
  | "image_pair_missing"
  | "vlm_key_missing"
  | "vlm_report_missing"
  | "vlm_report_failed";

export type SpreadsheetBenchChartVisualCommandResult = {
  command: string;
  exitCode: number | null;
  stdoutPreview: string;
  stderrPreview: string;
  ok: boolean;
};

export type SpreadsheetBenchChartVisualProbe = {
  schema: 1;
  generatedAt?: string;
  verifier: "spreadsheetbench_chart_visual_probe";
  status: SpreadsheetBenchChartVisualProbeStatus;
  pass: boolean;
  renderer: {
    required: true;
    candidates: SpreadsheetBenchChartVisualCommandResult[];
    selected?: string;
  };
  imagePair: {
    required: true;
    candidateImage?: SpreadsheetBenchChartVisualImageEvidence;
    goldImage?: SpreadsheetBenchChartVisualImageEvidence;
    available: boolean;
  };
  vlm: {
    required: true;
    model: string;
    apiKeyPresent: boolean;
    reportPath?: string;
    reportAccepted: boolean;
  };
  warnings: string[];
};

export type SpreadsheetBenchChartVisualImageEvidence = {
  path: string;
  sha256: string;
  bytes: number;
  width?: number;
  height?: number;
};

export type SpreadsheetBenchChartVisualProbeOptions = {
  generatedAt?: string;
  candidateImagePath?: string;
  goldImagePath?: string;
  vlmReportPath?: string;
  model?: string;
  env?: Record<string, string | undefined>;
  rendererCommands?: Array<{ command: string; args: string[] }>;
  runCommand?: (command: string, args: string[]) => SpreadsheetBenchChartVisualCommandResult;
};

export function runSpreadsheetBenchChartVisualProbe(
  options: SpreadsheetBenchChartVisualProbeOptions = {},
): SpreadsheetBenchChartVisualProbe {
  const model = options.model ?? process.env.GEMINI_MEDIA_JUDGE_MODEL ?? "gemini-3.6-flash";
  const env = options.env ?? process.env;
  const runCommand = options.runCommand ?? run;
  const candidates = (options.rendererCommands ?? defaultRendererCommands()).map((candidate) =>
    runCommand(candidate.command, candidate.args),
  );
  const selected = candidates.find((candidate) => candidate.ok)?.command;
  const candidateImageAvailable = Boolean(options.candidateImagePath && existsSync(options.candidateImagePath));
  const goldImageAvailable = Boolean(options.goldImagePath && existsSync(options.goldImagePath));
  const candidateImage = options.candidateImagePath && candidateImageAvailable ? imageEvidence(options.candidateImagePath) : undefined;
  const goldImage = options.goldImagePath && goldImageAvailable ? imageEvidence(options.goldImagePath) : undefined;
  const imagePairAvailable = candidateImageAvailable && goldImageAvailable;
  const vlmReport = readVlmReport(options.vlmReportPath);
  const apiKeyPresent = Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY);
  const reportAccepted = Boolean(vlmReport.accepted);
  const status = statusFor({
    rendererAvailable: Boolean(selected),
    imagePairAvailable,
    apiKeyPresent,
    reportPath: options.vlmReportPath,
    reportAccepted,
  });
  const pass = status === "chart_visual_grade_proven";
  const warnings = [
    ...(pass ? [] : ["Rendered/VLM SpreadsheetBench V2 chart grading is not proven; official benchmark readiness must remain red."]),
    ...(selected ? [] : ["No LibreOffice/soffice renderer command is available to render workbook charts into judgeable images."]),
    ...(imagePairAvailable ? [] : ["Candidate and gold chart screenshots are not both present for visual comparison."]),
    ...(apiKeyPresent ? [] : ["GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY is missing for Gemini/VLM chart judging."]),
    ...(options.vlmReportPath
      ? reportAccepted
        ? []
        : [`VLM report ${options.vlmReportPath} is missing, invalid, or not passing.`]
      : ["No passing VLM chart-grade report is attached to this probe."]),
  ];

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    verifier: "spreadsheetbench_chart_visual_probe",
    status,
    pass,
    renderer: {
      required: true,
      candidates,
      ...(selected ? { selected } : {}),
    },
    imagePair: {
      required: true,
      ...(candidateImage ? { candidateImage } : {}),
      ...(goldImage ? { goldImage } : {}),
      available: imagePairAvailable,
    },
    vlm: {
      required: true,
      model,
      apiKeyPresent,
      ...(options.vlmReportPath ? { reportPath: options.vlmReportPath } : {}),
      reportAccepted,
    },
    warnings,
  };
}

function defaultRendererCommands(): Array<{ command: string; args: string[] }> {
  const commands = [
    { command: "soffice", args: ["--version"] },
    { command: "libreoffice", args: ["--version"] },
    { command: "soffice.exe", args: ["--version"] },
  ];
  if (process.platform === "win32") {
    for (const command of [
      "C:\\Program Files\\LibreOffice\\program\\soffice.com",
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ]) {
      if (existsSync(command)) commands.push({ command, args: ["--headless", "--version"] });
    }
  }
  return commands;
}

function imageEvidence(path: string): SpreadsheetBenchChartVisualImageEvidence {
  const content = readFileSync(path);
  const dimensions = pngDimensions(content);
  return {
    path: basename(path),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: statSync(path).size,
    ...dimensions,
  };
}

function pngDimensions(content: Buffer): { width?: number; height?: number } {
  const pngSignature = "89504e470d0a1a0a";
  if (content.length < 24 || content.subarray(0, 8).toString("hex") !== pngSignature) return {};
  if (content.subarray(12, 16).toString("ascii") !== "IHDR") return {};
  return {
    width: content.readUInt32BE(16),
    height: content.readUInt32BE(20),
  };
}

function statusFor(args: {
  rendererAvailable: boolean;
  imagePairAvailable: boolean;
  apiKeyPresent: boolean;
  reportPath?: string;
  reportAccepted: boolean;
}): SpreadsheetBenchChartVisualProbeStatus {
  if (!args.rendererAvailable) return "renderer_unavailable";
  if (!args.imagePairAvailable) return "image_pair_missing";
  if (!args.apiKeyPresent) return "vlm_key_missing";
  if (!args.reportPath) return "vlm_report_missing";
  if (!args.reportAccepted) return "vlm_report_failed";
  return "chart_visual_grade_proven";
}

function readVlmReport(path: string | undefined): { accepted: boolean } {
  if (!path || !existsSync(path)) return { accepted: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      pass?: unknown;
      verifier?: unknown;
      status?: unknown;
      verdict?: unknown;
    };
    const verifier = typeof parsed.verifier === "string" ? parsed.verifier : "";
    const status = typeof parsed.status === "string" ? parsed.status : "";
    const verdict = typeof parsed.verdict === "string" ? parsed.verdict : "";
    const accepted =
      parsed.pass === true &&
      /vlm|gemini|visual/i.test(verifier) &&
      !/fail|error/i.test(status) &&
      !/rework|fix-then-publish/i.test(verdict);
    return { accepted };
  } catch {
    return { accepted: false };
  }
}

function run(command: string, args: string[]): SpreadsheetBenchChartVisualCommandResult {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    shell: false,
  });
  return {
    command: [command, ...args].join(" "),
    exitCode: result.status,
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr || result.error?.message),
    ok: result.status === 0,
  };
}

function preview(value: string | Buffer | Error | null | undefined): string {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : value?.toString("utf8") ?? "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}
