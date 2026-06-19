import { sanitizePlainText } from "./sanitize";

export const UNTRUSTED_DATA_OPEN = "<<<UNTRUSTED ROOM DATA>>>";
export const UNTRUSTED_DATA_CLOSE = "<<<END UNTRUSTED ROOM DATA>>>";

export type PromptInjectionSignal = {
  id: string;
  pattern: RegExp;
  severity: "low" | "medium" | "high";
};

export type PromptInjectionReport = {
  score: number;
  matches: Array<{ id: string; severity: PromptInjectionSignal["severity"]; excerpt: string }>;
};

const SIGNALS: PromptInjectionSignal[] = [
  { id: "ignore_previous", pattern: /\b(ignore|forget|disregard)\b.{0,40}\b(previous|prior|above)\b.{0,25}\b(instructions?|rules?|prompt)\b/i, severity: "high" },
  { id: "system_role_claim", pattern: /\b(system|developer)\s*:\s*/i, severity: "medium" },
  { id: "secret_exfiltration", pattern: /\b(reveal|print|exfiltrate|send)\b.{0,40}\b(secret|token|api key|password|private)\b/i, severity: "high" },
  { id: "tool_override", pattern: /\b(call|use|invoke)\b.{0,40}\btool\b.{0,40}\bwithout\b.{0,20}\bpermission\b/i, severity: "medium" },
  { id: "fence_escape", pattern: /<<<\s*(?:END\s+)?UNTRUSTED\s+ROOM\s+DATA\s*>>>/i, severity: "high" },
  { id: "role_reassignment", pattern: /\byou are now\b.{0,60}\b(agent|bot|system|developer|admin)\b/i, severity: "medium" },
];

export function neutralizeFenceDelimiters(input: string): string {
  return input
    .replaceAll(UNTRUSTED_DATA_OPEN, "[fence-stripped]")
    .replaceAll(UNTRUSTED_DATA_CLOSE, "[fence-stripped]");
}

export function fenceUntrustedData(input: unknown, label = "data"): string {
  const sanitizedLabel = sanitizePlainText(label, { maxLength: 80 }).value || "data";
  const sanitized = sanitizePlainText(input).value;
  const neutralized = neutralizeFenceDelimiters(sanitized);
  return `${UNTRUSTED_DATA_OPEN} ${sanitizedLabel}\n${neutralized}\n${UNTRUSTED_DATA_CLOSE}`;
}

export function detectPromptInjectionSignals(input: string): PromptInjectionReport {
  const matches = SIGNALS.flatMap((signal) => {
    const match = input.match(signal.pattern);
    if (!match) return [];
    return [{
      id: signal.id,
      severity: signal.severity,
      excerpt: sanitizePlainText(match[0], { maxLength: 120 }).value,
    }];
  });
  const score = matches.reduce((sum, match) => sum + severityWeight(match.severity), 0);
  return { score, matches };
}

export function isLikelyPromptInjection(input: string, threshold = 3): boolean {
  return detectPromptInjectionSignals(input).score >= threshold;
}

function severityWeight(severity: PromptInjectionSignal["severity"]): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}
