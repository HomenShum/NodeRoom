/**
 * Real source fetch — Node only. Hardened SSRF guard:
 *   - https-only
 *   - canonical IP block (incl IPv4-mapped IPv6 like Node's normalized ::ffff:7f00:1,
 *     CGNAT 100.64/10, IPv6 local/multicast/documentation/transition ranges) — string regexes were bypassable
 *   - DNS resolve-and-reject-private: names are resolved and EVERY address validated,
 *     which closes name→private (localtest.me) and cloud-metadata (metadata.google.internal)
 *   - connect-time DNS pinning: fetch uses an undici dispatcher whose lookup can only
 *     return the prevalidated addresses for that redirect hop
 *   - per-redirect-hop host re-validation
 *   - ONE 5 s total budget across DNS validation, redirects, and the body read
 *   - 200 KB read cap
 *
 * Shared by the Convex action's RoomTools and the benchmark; the browser
 * InMemoryRoomTools keeps a stub instead.
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import type { SourceResult } from "../../core/types";

const META_NAMES = new Set(["localhost", "metadata.google.internal", "metadata", "metadata.goog", "instance-data"]);
const TIMEOUT_MS = 5000, MAX_BYTES = 200_000, MAX_REDIRECTS = 4;
type PublicAddress = { address: string; family: 4 | 6 };
type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;
type PinnedFetch = { res: FetchResponse; dispatcher: Agent };

function isPrivateV4(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → block
  const [a, b] = o;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
/** IPv4 embedded in an IPv4-mapped/compat IPv6 (incl Node's hex-normalized ::ffff:7f00:1). */
function mappedV4(h: string): string | null {
  const dotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i) || h.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) { const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16); return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`; }
  const compatHex = h.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (compatHex) { const hi = parseInt(compatHex[1], 16), lo = parseInt(compatHex[2], 16); return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`; }
  return null;
}
function firstHextet(ip: string): number | null {
  const match = ip.match(/^([0-9a-f]{1,4})(?::|$)/i);
  return match ? parseInt(match[1], 16) : null;
}
export function isPrivateIp(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = mappedV4(h);
  if (v4) return isPrivateV4(v4);
  if (isIP(h) === 4) return isPrivateV4(h);
  if (isIP(h) === 6) {
    if (h === "::1" || h === "::") return true;
    const first = firstHextet(h);
    if (first === null) return true;
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (/^2001:db8(?::|$)/i.test(h)) return true; // documentation
    if (/^64:ff9b(?::|$)/i.test(h) || /^64:ff9b:1(?::|$)/i.test(h)) return true; // NAT64
    if (/^2002(?::|$)/i.test(h)) return true; // 6to4
    if (/^2001(?:::|:0(?::|$)|:0000(?::|$))/i.test(h)) return true; // Teredo 2001::/32
    if (/^2001:2(?::|$)/i.test(h)) return true; // benchmarking 2001:2::/48
    if (/^2001:1[0-9a-f](?::|$)/i.test(h)) return true; // ORCHID/ORCHIDv2 special-use range
    return false;
  }
  return true; // not a recognizable IP literal → block by default (names go through resolve)
}
/** Resolve a host once, reject private answers, then pin fetch's connect lookup to those answers. */
async function resolvePublicHost(hostname: string, signal: AbortSignal): Promise<PublicAddress[] | null> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (META_NAMES.has(h)) return null;
  const literalFamily = isIP(h);
  if (literalFamily) return isPrivateIp(h) ? null : [{ address: h, family: literalFamily as 4 | 6 }];
  try {
    const addrs = (await lookupWithAbort(h, signal)).map((a) => ({ address: a.address, family: a.family as 4 | 6 }));
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address)) ? addrs : null;
  } catch {
    return null;
  }
}

async function lookupWithAbort(hostname: string, signal: AbortSignal) {
  if (signal.aborted) throw new Error("timeout");
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("timeout"));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function pinnedDispatcher(addresses: PublicAddress[]): Agent {
  let i = 0;
  return new Agent({
    allowH2: false,
    connect: {
      lookup(_hostname, options, callback) {
        const family = typeof options === "object" && (options.family === 4 || options.family === 6) ? options.family : undefined;
        const candidates = family ? addresses.filter((a) => a.family === family) : addresses;
        if (typeof options === "object" && options.all) {
          if (candidates.length === 0) callback(new Error("no validated address"), [] as unknown as string, 0);
          else callback(null, candidates.map((a) => ({ address: a.address, family: a.family })) as unknown as string, 0);
          return;
        }
        const next = candidates[i++ % candidates.length];
        if (!next) callback(new Error("no validated address"), "", 0);
        else callback(null, next.address, next.family);
      },
    },
  });
}

async function closeDispatcher(dispatcher: Agent): Promise<void> {
  await dispatcher.close();
}

async function fetchPinned(url: URL, signal: AbortSignal): Promise<PinnedFetch | null> {
  const addresses = await resolvePublicHost(url.hostname, signal);
  if (!addresses) return null;
  const dispatcher = pinnedDispatcher(addresses);
  const init = {
    signal,
    redirect: "manual" as const,
    headers: { "user-agent": "NodeRoom/1.0 (+research)" },
    dispatcher,
  };
  try {
    const res = await undiciFetch(url.toString(), init);
    return { res, dispatcher };
  } catch (error) {
    await closeDispatcher(dispatcher);
    throw error;
  }
}

export async function fetchSourceReal(url: string): Promise<SourceResult> {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, error: "invalid url" }; }
  if (u.protocol !== "https:") return { ok: false, error: "blocked protocol" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS); // ONE total budget: DNS + redirects + body
  try {
    const fetched = await fetchWithSafeRedirects(u, ctl.signal);
    if (!fetched) return { ok: false, error: "blocked host (SSRF)" };
    const { res, dispatcher } = fetched;
    try {
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        const finalUrl = new URL(res.url || u.toString());
        return {
          ok: true,
          title: finalUrl.hostname,
          snippet: `Text fetch unavailable with HTTP ${res.status}. Use capture_source for browser-rendered evidence or choose an unauthenticated source endpoint.`,
          url: finalUrl.toString(),
        };
      }
      if (!res.ok) return { ok: false, error: `http ${res.status}` };
      const finalUrl = new URL(res.url || u.toString());
      if (finalUrl.protocol !== "https:") return { ok: false, error: "blocked redirect" };
      const text = await readCapped(res, MAX_BYTES);
      const title = (text.match(/<title[^>]*>([^<]{0,160})<\/title>/i)?.[1] ?? finalUrl.hostname).trim();
      const snippet = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 280);
      return { ok: true, title, snippet, url: finalUrl.toString() };
    } finally {
      await closeDispatcher(dispatcher);
    }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "fetch failed" }; }
  finally { clearTimeout(timer); }
}

async function fetchWithSafeRedirects(start: URL, signal: AbortSignal): Promise<PinnedFetch | null> {
  let cur = start;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const fetched = await fetchPinned(cur, signal);
    if (!fetched) return i === 0 ? null : Promise.reject(new Error("blocked redirect"));
    const { res, dispatcher } = fetched;
    if (![301, 302, 303, 307, 308].includes(res.status)) return fetched;
    const loc = res.headers.get("location");
    if (!loc) return fetched;
    const next = new URL(loc, cur);
    if (next.protocol !== "https:") {
      await res.body?.cancel();
      await closeDispatcher(dispatcher);
      throw new Error("blocked redirect");
    }
    await res.body?.cancel();
    await closeDispatcher(dispatcher);
    cur = next;
  }
  throw new Error("too many redirects");
}

async function readCapped(res: FetchResponse, cap: number): Promise<string> {
  if (!res.body) return new TextDecoder().decode((await res.arrayBuffer()).slice(0, cap));
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < cap) {
      const { done, value } = await reader.read(); // throws if the shared signal aborts (total-budget timeout) → caught upstream
      if (done || !value) break;
      const take = value.slice(0, Math.max(0, cap - total));
      chunks.push(take); total += take.byteLength;
      if (value.byteLength > take.byteLength) break;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const out = new Uint8Array(total); let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(out);
}
