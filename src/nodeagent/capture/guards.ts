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
import { isIP } from "node:net";
import { isPrivateIp } from "../skills/search/fetchSource";

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

/** Validate + normalize a capture URL. Throws CaptureUrlError on anything unsafe. */
export function assertCapturableUrl(raw: string, opts: { allowHosts?: string[] } = {}): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new CaptureUrlError(`invalid URL: ${raw}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new CaptureUrlError(`unsupported protocol: ${u.protocol}`);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new CaptureUrlError(`blocked host: ${host}`);
  }
  // Only run the private-range check on IP LITERALS — isPrivateIp() blocks bare names by design
  // (names are meant to go through DNS resolution), which would reject every real domain.
  if (isIP(host) !== 0 && isPrivateIp(host)) throw new CaptureUrlError(`private address: ${host}`);
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
