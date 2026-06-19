export type SanitizedText = {
  value: string;
  truncated: boolean;
  removedControlChars: number;
};

export type SanitizeTextOptions = {
  maxLength?: number;
  preserveTabs?: boolean;
};

const DEFAULT_MAX_TEXT_LENGTH = 20_000;
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const CONTROL_CHAR_WITH_TAB_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0009]/g;

export function sanitizePlainText(input: unknown, options: SanitizeTextOptions = {}): SanitizedText {
  const maxLength = Math.max(0, Math.floor(options.maxLength ?? DEFAULT_MAX_TEXT_LENGTH));
  const raw = input == null ? "" : String(input);
  const pattern = options.preserveTabs ? CONTROL_CHAR_PATTERN : CONTROL_CHAR_WITH_TAB_PATTERN;
  let removedControlChars = 0;
  const cleaned = raw.normalize("NFC").replace(pattern, () => {
    removedControlChars += 1;
    return "";
  });
  const truncated = cleaned.length > maxLength;
  return {
    value: truncated ? cleaned.slice(0, maxLength) : cleaned,
    truncated,
    removedControlChars,
  };
}

export function clampString(value: unknown, maxLength: number): string {
  return sanitizePlainText(value, { maxLength }).value;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeJsonPreview(value: unknown, maxLength = 2_000): string {
  try {
    return clampString(JSON.stringify(value), maxLength);
  } catch {
    return clampString(String(value), maxLength);
  }
}
