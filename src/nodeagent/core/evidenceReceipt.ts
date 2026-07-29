import type { CellEvidence } from "../../engine/types";
import { stableJournalHash } from "./journal";

export type CellEvidenceVerificationStatus = "verified" | "unverified" | "tampered";

const IMMUTABLE_SOURCE_DIGEST = /^sha256:[0-9a-f]{64}$/;

export function isImmutableSourceContentDigest(value: unknown): value is string {
  return typeof value === "string" && IMMUTABLE_SOURCE_DIGEST.test(value);
}

export interface TrustedCellEvidenceReceipt {
  /** SHA-256 over the exact bytes captured by the trusted fetch/upload adapter. */
  contentDigest: string;
  /** Adapter-observed capture time, never a model-provided citation timestamp. */
  verifiedAt: number;
}

export interface TrustedFetchedSourcePresentation {
  url: string;
  title: string;
  snippet: string;
  /** Synthetic/demo presentations are never eligible for trusted receipts. */
  provenance: "network_fetch";
}

export const TRUSTED_SOURCE_RECEIPT_MAX_ENTRIES = 128;
export const TRUSTED_SOURCE_RECEIPT_MAX_BYTES = 200_000;
const TRUSTED_SOURCE_RECEIPT_MAX_AGE_MS = 10 * 60 * 1_000;
const TRUSTED_SOURCE_RECEIPT_MAX_URL_CHARS = 2_048;
const TRUSTED_SOURCE_RECEIPT_MAX_TITLE_CHARS = 160;
const TRUSTED_SOURCE_RECEIPT_MAX_SNIPPET_CHARS = 280;

type TrustedSourceReceiptEntry = TrustedFetchedSourcePresentation & {
  receipt: TrustedCellEvidenceReceipt;
  expiresAt: number;
};

function canonicalSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > TRUSTED_SOURCE_RECEIPT_MAX_URL_CHARS) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const canonical = url.toString();
    return canonical.length <= TRUSTED_SOURCE_RECEIPT_MAX_URL_CHARS ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function sourceReceiptKey(source: TrustedFetchedSourcePresentation): string {
  return `${source.url}\u0000${source.title}\u0000${source.snippet}`;
}

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.floor(value)))
    : fallback;
}

async function immutableDigestForBytes(bytes: Uint8Array): Promise<string> {
  const exactBytes = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", exactBytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Same-runtime proof that a model-visible source result came from a trusted
 * adapter. The registry is deliberately instance-scoped: a later action/slice
 * must fetch again instead of inheriting ambient process state.
 */
export class TrustedSourceReceiptRegistry {
  private readonly entries = new Map<string, TrustedSourceReceiptEntry>();
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;

  constructor(options: {
    maxEntries?: number;
    maxAgeMs?: number;
    now?: () => number;
  } = {}) {
    this.maxEntries = boundedPositiveInteger(
      options.maxEntries,
      TRUSTED_SOURCE_RECEIPT_MAX_ENTRIES,
      TRUSTED_SOURCE_RECEIPT_MAX_ENTRIES,
    );
    this.maxAgeMs = boundedPositiveInteger(
      options.maxAgeMs,
      TRUSTED_SOURCE_RECEIPT_MAX_AGE_MS,
      TRUSTED_SOURCE_RECEIPT_MAX_AGE_MS,
    );
    this.now = options.now ?? Date.now;
  }

  private readonly now: () => number;

  get size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  /**
   * Hashes exact bounded bytes inside the trusted adapter boundary. Only the
   * model-visible presentation is retained; raw bytes are not kept in memory.
   */
  async recordFetchedSource(args: {
    source: TrustedFetchedSourcePresentation;
    exactBytes: Uint8Array;
    verifiedAt?: number;
  }): Promise<boolean> {
    const url = canonicalSourceUrl(args.source.url);
    const title = args.source.title;
    const snippet = args.source.snippet;
    if (
      args.source.provenance !== "network_fetch"
      || !url
      || typeof title !== "string"
      || title.length === 0
      || title.length > TRUSTED_SOURCE_RECEIPT_MAX_TITLE_CHARS
      || typeof snippet !== "string"
      || snippet.length === 0
      || snippet.length > TRUSTED_SOURCE_RECEIPT_MAX_SNIPPET_CHARS
      || !(args.exactBytes instanceof Uint8Array)
      || args.exactBytes.byteLength === 0
      || args.exactBytes.byteLength > TRUSTED_SOURCE_RECEIPT_MAX_BYTES
    ) {
      return false;
    }
    const observedNow = this.now();
    const verifiedAt = args.verifiedAt ?? observedNow;
    if (
      !Number.isFinite(verifiedAt)
      || verifiedAt <= 0
      || verifiedAt <= observedNow - this.maxAgeMs
      || verifiedAt > observedNow + 60_000
    ) {
      return false;
    }
    const source = {
      url,
      title,
      snippet,
      provenance: "network_fetch" as const,
    };
    const key = sourceReceiptKey(source);
    let contentDigest: string;
    try {
      contentDigest = await immutableDigestForBytes(args.exactBytes);
    } catch {
      return false;
    }
    const receipt = { contentDigest, verifiedAt };
    this.pruneExpired(observedNow);
    this.entries.delete(key);
    this.entries.set(key, {
      ...source,
      receipt,
      expiresAt: Math.min(observedNow, verifiedAt) + this.maxAgeMs,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== "string") break;
      this.entries.delete(oldest);
    }
    return true;
  }

  /**
   * Resolve only an exact citation presentation returned by this registry's
   * adapter. Caller-supplied digest/timestamp/receipt fields are ignored.
   */
  resolve(evidence: CellEvidence): TrustedCellEvidenceReceipt | undefined {
    if (evidence.kind !== "source") return undefined;
    this.pruneExpired();
    const evidenceUrls = [evidence.url, evidence.source]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map(canonicalSourceUrl);
    if (
      evidenceUrls.length === 0
      || evidenceUrls.some((value) => value === undefined)
      || new Set(evidenceUrls).size !== 1
    ) {
      return undefined;
    }
    const url = evidenceUrls[0];
    if (typeof evidence.snippet !== "string" || evidence.snippet.length === 0) {
      return undefined;
    }
    for (const entry of [...this.entries.values()].reverse()) {
      if (entry.url !== url) continue;
      if (evidence.label !== entry.title) continue;
      if (evidence.snippet !== entry.snippet) continue;
      return { ...entry.receipt };
    }
    return undefined;
  }

  private pruneExpired(now = this.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

export function cellEvidenceReceiptCore(
  evidence: CellEvidence,
): Omit<CellEvidence, "receiptDigest"> {
  const { receiptDigest: _receiptDigest, ...core } = evidence;
  return core;
}

export function cellEvidenceReceiptDigest(evidence: CellEvidence): string {
  return stableJournalHash(cellEvidenceReceiptCore(evidence));
}

/**
 * Seals evidence produced by a trusted adapter. A source/upload becomes
 * verifiable only when the adapter supplies a SHA-256 digest of the exact
 * fetched/uploaded bytes. Citation-shaped model metadata has no such digest
 * (the model-facing schema strips receipt fields), so it remains visible but
 * cannot mint freshness or source support.
 */
export function sealCellEvidence(
  evidence: CellEvidence,
  trustedReceipt?: TrustedCellEvidenceReceipt,
): CellEvidence {
  const {
    verifiedAt: _untrustedVerifiedAt,
    contentDigest: _untrustedContentDigest,
    receiptDigest: _untrustedReceiptDigest,
    ...untrustedCore
  } = evidence;
  const sourceLike = evidence.kind === "source" || evidence.kind === "upload";
  if (sourceLike && (
    !isImmutableSourceContentDigest(trustedReceipt?.contentDigest)
    || !Number.isFinite(trustedReceipt?.verifiedAt)
    || (trustedReceipt?.verifiedAt ?? 0) <= 0
  )) {
    return untrustedCore;
  }
  const sealed: CellEvidence = {
    ...untrustedCore,
    ...(sourceLike
      ? {
          contentDigest: trustedReceipt?.contentDigest,
          verifiedAt: trustedReceipt?.verifiedAt,
        }
      : {}),
  };
  return {
    ...sealed,
    receiptDigest: cellEvidenceReceiptDigest(sealed),
  };
}

export function cellEvidenceVerificationStatus(
  evidence: CellEvidence,
): CellEvidenceVerificationStatus {
  if (!evidence.receiptDigest) return "unverified";
  if (evidence.receiptDigest !== cellEvidenceReceiptDigest(evidence)) return "tampered";
  if (
    (evidence.kind === "source" || evidence.kind === "upload") &&
    isImmutableSourceContentDigest(evidence.contentDigest) &&
    Number.isFinite(evidence.verifiedAt) &&
    (evidence.verifiedAt ?? 0) > 0
  ) {
    return "verified";
  }
  return "unverified";
}
