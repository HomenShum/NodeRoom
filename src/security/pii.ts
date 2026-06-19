export type PiiKind = "email" | "phone" | "ssn" | "credit_card" | "ipv4";

export type PiiFinding = {
  kind: PiiKind;
  value: string;
  start: number;
  end: number;
  confidence: "low" | "medium" | "high";
};

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const CREDIT_CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;

export function detectPii(input: string): PiiFinding[] {
  const findings: PiiFinding[] = [
    ...collectRegexFindings(input, EMAIL_RE, "email", "high"),
    ...collectRegexFindings(input, PHONE_RE, "phone", "medium"),
    ...collectRegexFindings(input, SSN_RE, "ssn", "high"),
    ...collectRegexFindings(input, IPV4_RE, "ipv4", "low"),
  ];

  for (const match of input.matchAll(CREDIT_CARD_RE)) {
    const value = match[0];
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      findings.push({
        kind: "credit_card",
        value,
        start: match.index ?? 0,
        end: (match.index ?? 0) + value.length,
        confidence: "high",
      });
    }
  }

  return nonOverlapping(findings);
}

export function containsPii(input: string, kinds?: PiiKind[]): boolean {
  const allowed = kinds ? new Set(kinds) : null;
  return detectPii(input).some((finding) => !allowed || allowed.has(finding.kind));
}

function collectRegexFindings(
  input: string,
  regex: RegExp,
  kind: PiiKind,
  confidence: PiiFinding["confidence"],
): PiiFinding[] {
  return Array.from(input.matchAll(regex), (match) => ({
    kind,
    value: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    confidence,
  }));
}

function nonOverlapping(findings: PiiFinding[]): PiiFinding[] {
  const ordered = [...findings].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: PiiFinding[] = [];
  let cursor = -1;
  for (const finding of ordered) {
    if (finding.start < cursor) continue;
    kept.push(finding);
    cursor = finding.end;
  }
  return kept;
}

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (doubleDigit) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubleDigit = !doubleDigit;
  }
  return sum > 0 && sum % 10 === 0;
}
