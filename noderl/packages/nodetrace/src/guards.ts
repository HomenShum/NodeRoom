/**
 * Capture guards — the reliability floor for a pipeline that drives a REAL browser at a REAL URL.
 *
 * SSRF note: unlike fetchSource (which fetches from OUR network, so it DNS-pins to public IPs), the
 * browser substrate runs REMOTELY (Browserbase / Firecrawl). The IP-pin trick doesn't apply — the
 * remote provider resolves and fetches. So our controls here are: (1) reject obviously-internal URLs
 * (private IP literals, localhost, *.local/*.internal) as defense-in-depth, and (2) an OPTIONAL host
 * allowlist, which is the real control for a production capture surface. Full name→private protection
 * for the remote fetch is the provider's responsibility + the allowlist.
 */
/** Hard ceilings (BOUND / TIMEOUT / BOUND_READ). */
export const CAPTURE_LIMITS = {
  MAX_STEPS: 12,
  TOTAL_BUDGET_MS: 60_000,
  MAX_A11Y_CHARS: 24_000,
  MAX_SCREENSHOT_BYTES: 4_000_000,
  MAX_EXTRACT_FIELDS: 64,
} as const;

export class CaptureUrlError extends Error {
  constructor(message: string) { super(message); this.name = "CaptureUrlError"; }
}

function isIpv4Literal(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function mappedV4(host: string): string | null {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i) || host.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i) || host.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

function firstHextet(ip: string): number | null {
  const match = ip.match(/^([0-9a-f]{1,4})(?::|$)/i);
  return match ? parseInt(match[1], 16) : null;
}

function isPrivateIpLiteral(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = mappedV4(h);
  if (v4) return isPrivateV4(v4);
  if (isIpv4Literal(h)) return isPrivateV4(h);
  if (!h.includes(":")) return false;
  if (h === "::1" || h === "::") return true;
  const first = firstHextet(h);
  if (first === null) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (/^2001:db8(?::|$)/i.test(h)) return true;
  if (/^64:ff9b(?::|$)/i.test(h) || /^64:ff9b:1(?::|$)/i.test(h)) return true;
  if (/^2002(?::|$)/i.test(h)) return true;
  if (/^2001(?:::|:0(?::|$)|:0000(?::|$))/i.test(h)) return true;
  if (/^2001:2(?::|$)/i.test(h)) return true;
  if (/^2001:1[0-9a-f](?::|$)/i.test(h)) return true;
  return false;
}

/** Validate + normalize a capture URL. Throws CaptureUrlError on anything unsafe. */
export function assertCapturableUrl(raw: string, opts: { allowHosts?: string[] } = {}): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new CaptureUrlError(`invalid URL: ${raw}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new CaptureUrlError(`unsupported protocol: ${u.protocol}`);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new CaptureUrlError(`blocked host: ${host}`);
  }
  // Only run this on IP literals. Remote substrates resolve domains themselves; production callers
  // should use allowHosts when domain-level egress must be pinned.
  if ((isIpv4Literal(host) || host.includes(":")) && isPrivateIpLiteral(host)) throw new CaptureUrlError(`private address: ${host}`);
  const allow = opts.allowHosts?.filter(Boolean) ?? [];
  if (allow.length && !allow.some((h) => host === h.toLowerCase() || host.endsWith("." + h.toLowerCase()))) {
    throw new CaptureUrlError(`host not in allowlist: ${host}`);
  }
  return u;
}

/** Clip the page representation to the model's input budget (BOUND_READ). */
export function clipRepresentation(a11y: string): string {
  return a11y.length > CAPTURE_LIMITS.MAX_A11Y_CHARS
    ? a11y.slice(0, CAPTURE_LIMITS.MAX_A11Y_CHARS) + `\n…[clipped ${a11y.length - CAPTURE_LIMITS.MAX_A11Y_CHARS} chars]`
    : a11y;
}
