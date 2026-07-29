/**
 * Real source fetch — Node only.
 *
 * This is the single network boundary used by both NodeAgent and the Convex
 * Node-runtime RoomTools adapter. Every redirect hop is DNS-resolved, every
 * answer must be globally routable, and Undici's connect lookup is pinned to
 * those exact answers so a second DNS response cannot rebind the request.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import type { SourceResult } from "../../core/types";

export const FETCH_SOURCE_TIMEOUT_MS = 5_000;
export const FETCH_SOURCE_MAX_BYTES = 200_000;
export const FETCH_SOURCE_MAX_URL_CHARS = 2_048;
const FETCH_SOURCE_MAX_REDIRECTS = 4;
const FETCH_SOURCE_MAX_DNS_ANSWERS = 32;
const FETCH_SOURCE_MAX_BODY_CHUNKS = 1_024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const META_NAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "metadata.goog",
  "instance-data",
]);

export type PublicFetchAddress = { address: string; family: 4 | 6 };
export type PublicHostResolution =
  | { ok: true; addresses: PublicFetchAddress[] }
  | { ok: false; error: string };
export type BoundedBodyRead =
  | { ok: true; text: string; bytesRead: number; exactBytes: Uint8Array }
  | { ok: false; error: "response_too_large" };
export type TrustedFetchedSourceCapture = {
  source: Extract<SourceResult, { ok: true }> & { provenance: "network_fetch" };
  exactBytes: Uint8Array;
  verifiedAt: number;
};
export type TrustedFetchedSourceCaptureConsumer = (
  capture: TrustedFetchedSourceCapture,
) => boolean | Promise<boolean>;

type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;
type BoundedResponseBody = {
  getReader(): {
    read(): Promise<ReadableStreamReadResult<Uint8Array>>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  };
  cancel(reason?: unknown): Promise<void>;
};
type ReadableResponse = {
  body: BoundedResponseBody | null;
  headers: { get(name: string): string | null };
};
type PinnedFetch =
  | { ok: true; response: FetchResponse; dispatcher: Agent }
  | { ok: false; error: string };

function isPrivateOrReservedV4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** IPv4 embedded in mapped/compatible IPv6, including Node's hex-normalized form. */
function mappedV4(host: string): string | null {
  const dotted =
    host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i) ??
    host.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];

  const hex =
    host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i) ??
    host.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function firstHextet(ip: string): number | null {
  const match = ip.match(/^([0-9a-f]{1,4})(?::|$)/i);
  return match ? Number.parseInt(match[1], 16) : null;
}

/** True means the address is not safe as an arbitrary outbound HTTP target. */
export function isPrivateIp(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  const embeddedV4 = mappedV4(normalized);
  if (embeddedV4) return isPrivateOrReservedV4(embeddedV4);
  if (isIP(normalized) === 4) return isPrivateOrReservedV4(normalized);
  if (isIP(normalized) !== 6) return true;

  if (normalized === "::" || normalized === "::1") return true;
  const first = firstHextet(normalized);
  if (first === null) return true;
  // Deny by default outside the globally-routable 2000::/3 unicast block. This
  // blocks ULA, link/site-local (including deprecated fec0::/10), multicast,
  // NAT64, discard-only, and future special-use ranges without chasing aliases.
  if (first < 0x2000 || first > 0x3fff) return true;
  const secondText = normalized.split(":")[1] || "0";
  const second = Number.parseInt(secondText, 16);
  if (!Number.isFinite(second)) return true;
  // IETF protocol assignments (2001::/23) are not arbitrary web destinations.
  if (first === 0x2001 && second <= 0x01ff) return true;
  if (first === 0x2001 && second === 0x0db8) return true; // documentation
  if (first === 0x2002) return true; // 6to4 transition
  if (first === 0x3fff) return true; // documentation block
  return false;
}

function blockedHostname(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host.includes("%") || host.length > 253) return "blocked_host";
  if (
    META_NAMES.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return "blocked_private_or_metadata_host";
  }
  if (isIP(host)) {
    return isPrivateIp(host) ? "blocked_private_or_reserved_ip" : null;
  }
  return null;
}

async function lookupWithAbort(
  hostname: string,
  signal: AbortSignal,
): Promise<Array<{ address: string; family: number }>> {
  if (signal.aborted) throw new Error("timeout");
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("timeout"));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Resolve once for a request hop and reject the whole answer set if any address
 * is private, reserved, malformed, or excessive. The returned addresses are the
 * only addresses the request dispatcher is allowed to connect to.
 */
export async function resolvePublicFetchHost(
  hostname: string,
  signal: AbortSignal,
): Promise<PublicHostResolution> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const lexicalBlock = blockedHostname(host);
  if (lexicalBlock) return { ok: false, error: lexicalBlock };

  const literalFamily = isIP(host);
  if (literalFamily === 4 || literalFamily === 6) {
    return {
      ok: true,
      addresses: [{ address: host, family: literalFamily }],
    };
  }

  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await lookupWithAbort(host, signal);
  } catch (error) {
    return {
      ok: false,
      error: signal.aborted || (error instanceof Error && error.message === "timeout")
        ? "timeout"
        : "dns_resolution_failed",
    };
  }
  if (answers.length === 0) return { ok: false, error: "dns_resolution_failed" };
  if (answers.length > FETCH_SOURCE_MAX_DNS_ANSWERS) {
    return { ok: false, error: "dns_answer_limit_exceeded" };
  }

  const unique = new Map<string, PublicFetchAddress>();
  for (const answer of answers) {
    if (
      (answer.family !== 4 && answer.family !== 6) ||
      isIP(answer.address) !== answer.family ||
      isPrivateIp(answer.address)
    ) {
      return { ok: false, error: "blocked_private_or_reserved_ip" };
    }
    unique.set(`${answer.family}:${answer.address}`, {
      address: answer.address,
      family: answer.family,
    });
  }
  return {
    ok: true,
    addresses: [...unique.values()].sort(
      (left, right) => left.family - right.family || left.address.localeCompare(right.address),
    ),
  };
}

function pinnedDispatcher(addresses: PublicFetchAddress[]): Agent {
  let cursor = 0;
  return new Agent({
    allowH2: false,
    connect: {
      lookup(_hostname, options, callback) {
        const requestedFamily =
          typeof options === "object" && (options.family === 4 || options.family === 6)
            ? options.family
            : undefined;
        const candidates = requestedFamily
          ? addresses.filter((address) => address.family === requestedFamily)
          : addresses;
        if (typeof options === "object" && options.all) {
          if (candidates.length === 0) {
            callback(new Error("no_validated_address"), [] as unknown as string, 0);
          } else {
            callback(
              null,
              candidates.map(({ address, family }) => ({ address, family })) as unknown as string,
              0,
            );
          }
          return;
        }
        const next = candidates[cursor++ % candidates.length];
        if (!next) callback(new Error("no_validated_address"), "", 0);
        else callback(null, next.address, next.family);
      },
    },
  });
}

async function fetchPinned(url: URL, signal: AbortSignal): Promise<PinnedFetch> {
  const resolution = await resolvePublicFetchHost(url.hostname, signal);
  if (!resolution.ok) return resolution;

  const dispatcher = pinnedDispatcher(resolution.addresses);
  try {
    const response = await undiciFetch(url.toString(), {
      signal,
      redirect: "manual",
      headers: { "user-agent": "NodeRoom/1.0 (+research)" },
      dispatcher,
    });
    return { ok: true, response, dispatcher };
  } catch (error) {
    await dispatcher.close().catch(() => undefined);
    throw error;
  }
}

async function cancelResponseBody(response: FetchResponse): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * Read a response incrementally. It never calls text()/arrayBuffer(), never
 * retains more than the configured byte cap, and rejects rather than silently
 * presenting truncated evidence as complete.
 */
export async function readBoundedFetchBody(
  response: ReadableResponse,
): Promise<BoundedBodyRead> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > FETCH_SOURCE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, error: "response_too_large" };
  }
  if (!response.body) {
    return { ok: true, text: "", bytesRead: 0, exactBytes: new Uint8Array() };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let chunkCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount += 1;
      if (chunkCount > FETCH_SOURCE_MAX_BODY_CHUNKS) {
        return { ok: false, error: "response_too_large" };
      }
      if (!value || value.byteLength === 0) continue;
      if (value.byteLength > FETCH_SOURCE_MAX_BYTES - total) {
        return { ok: false, error: "response_too_large" };
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    ok: true,
    text: new TextDecoder().decode(bytes),
    bytesRead: total,
    exactBytes: bytes,
  };
}

function sourceResultError(error: unknown, signal: AbortSignal): SourceResult {
  if (signal.aborted) return { ok: false, error: "timeout" };
  if (error instanceof Error) {
    if (
      error.message === "too_many_redirects" ||
      error.message === "invalid_redirect_url" ||
      error.message === "https_required"
    ) {
      return { ok: false, error: error.message };
    }
  }
  return { ok: false, error: "fetch_failed" };
}

export async function fetchSourceReal(
  url: string,
  onTrustedCapture?: TrustedFetchedSourceCaptureConsumer,
): Promise<SourceResult> {
  if (typeof url !== "string" || url.length === 0 || url.length > FETCH_SOURCE_MAX_URL_CHARS) {
    return { ok: false, error: "invalid_url" };
  }
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (current.toString().length > FETCH_SOURCE_MAX_URL_CHARS) {
    return { ok: false, error: "invalid_url" };
  }
  if (current.protocol !== "https:") return { ok: false, error: "https_required" };
  if (current.username || current.password) {
    return { ok: false, error: "url_credentials_forbidden" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_SOURCE_TIMEOUT_MS);
  try {
    let redirectCount = 0;
    while (true) {
      const fetched = await fetchPinned(current, controller.signal);
      if (!fetched.ok) return { ok: false, error: fetched.error };
      const { response, dispatcher } = fetched;
      try {
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          if (!location) return { ok: false, error: "redirect_missing_location" };
          if (redirectCount >= FETCH_SOURCE_MAX_REDIRECTS) {
            return { ok: false, error: "too_many_redirects" };
          }
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            return { ok: false, error: "invalid_redirect_url" };
          }
          if (next.toString().length > FETCH_SOURCE_MAX_URL_CHARS) {
            return { ok: false, error: "invalid_redirect_url" };
          }
          if (next.protocol !== "https:") return { ok: false, error: "https_required" };
          if (next.username || next.password) {
            return { ok: false, error: "url_credentials_forbidden" };
          }
          current = next;
          redirectCount += 1;
          continue;
        }

        if (!response.ok) return { ok: false, error: `http_${response.status}` };
        const body = await readBoundedFetchBody(response);
        if (!body.ok) return body;
        const title =
          body.text
            .match(/<title[^>]*>([^<]{0,160})<\/title>/i)?.[1]
            ?.replace(/\s+/g, " ")
            .trim() || current.hostname;
        const snippet = body.text
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 280);
        const source = {
          ok: true as const,
          title,
          snippet,
          url: current.toString(),
          provenance: "network_fetch" as const,
        };
        if (onTrustedCapture) {
          const recorded = await onTrustedCapture({
            source,
            exactBytes: body.exactBytes,
            verifiedAt: Date.now(),
          });
          if (!recorded) return { ok: false, error: "receipt_registration_failed" };
        }
        return source;
      } finally {
        await cancelResponseBody(response);
        await dispatcher.close().catch(() => undefined);
      }
    }
  } catch (error) {
    return sourceResultError(error, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
