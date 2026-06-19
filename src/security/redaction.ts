import { detectPii, type PiiKind } from "./pii";

export type RedactionPolicy = {
  kinds?: PiiKind[];
  preserveEmailDomain?: boolean;
};

export type Redaction = {
  kind: PiiKind;
  start: number;
  end: number;
  replacement: string;
};

export type RedactionResult = {
  text: string;
  redactions: Redaction[];
};

export function redactText(input: string, policy: RedactionPolicy = {}): RedactionResult {
  const allowedKinds = policy.kinds ? new Set(policy.kinds) : null;
  const findings = detectPii(input).filter((finding) => !allowedKinds || allowedKinds.has(finding.kind));
  let text = "";
  let cursor = 0;
  const redactions: Redaction[] = [];

  for (const finding of findings) {
    if (finding.start < cursor) continue;
    const replacement = replacementFor(finding.kind, finding.value, policy);
    text += input.slice(cursor, finding.start);
    text += replacement;
    redactions.push({ kind: finding.kind, start: finding.start, end: finding.end, replacement });
    cursor = finding.end;
  }

  text += input.slice(cursor);
  return { text, redactions };
}

export function redactForPublicPreview(input: string): string {
  return redactText(input, { preserveEmailDomain: false }).text;
}

function replacementFor(kind: PiiKind, value: string, policy: RedactionPolicy): string {
  if (kind === "email" && policy.preserveEmailDomain) {
    const domain = value.split("@")[1];
    return domain ? `[redacted-email@${domain.toLowerCase()}]` : "[redacted-email]";
  }
  return `[redacted-${kind.replace("_", "-")}]`;
}
