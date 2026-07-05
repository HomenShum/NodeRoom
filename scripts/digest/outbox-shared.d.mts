/**
 * Type surface for outbox-shared.mjs (plain-node bootstrap runner).
 * Keep in sync with the .mjs implementation; the contract-mirrored subset is
 * pinned to convex/alwaysOnCore.ts and drift-tested in tests/digestRunner.test.ts.
 */

export type OutboxState =
  | "pending_draft"
  | "draft_created"
  | "approved"
  | "sent"
  | "failed"
  | "skipped";

export type OutboxRow = {
  idempotencyKey: string;
  state: OutboxState;
  roomSlug?: string;
  briefKey?: string;
  cadence?: string;
  to?: string;
  subject?: string;
  markdownBody?: string;
  links?: { view: string; manage: string; unsubscribe: string };
  providerRef?: string;
  providerLane?: string;
  sentRef?: string;
  reason?: string;
  error?: string;
  retryCount?: number;
  createdAt?: string;
  draftedAt?: string;
  failedAt?: string;
  updatedAt?: string;
  approvedBy?: string;
  [key: string]: unknown;
};

export const OUTBOX_STATES: OutboxState[];
export const OUTBOX_TRANSITIONS: Record<OutboxState, OutboxState[]>;
export function canTransition(from: string, to: string): boolean;
export function canRecordFailure(from: string): boolean;
export function buildIdempotencyKey(parts: {
  roomSlug: string;
  briefKey: string;
  subscriptionId: string;
  cadence: string;
}): string;

export const MAX_OUTBOX_BYTES: number;
export const MAX_OUTBOX_LINES: number;
export const MAX_SUBSCRIBERS: number;
export const MAX_BRIEF_BYTES: number;
export const DAILY_DRAFT_CAP: number;
export const DEFAULT_DRAFT_LIMIT: number;
export const DEFAULT_OUTBOX_PATH: string;
export const DEFAULT_DRAFTS_DIR: string;

export function sanitizeHeaderValue(value: unknown): string;
export function isValidEmail(email: unknown): boolean;
export function loadOutbox(outboxPath: string): {
  rows: Map<string, OutboxRow>;
  corruptLines: number;
  endsWithNewline: boolean;
  exists: boolean;
};
export function appendOutboxRows(
  outboxPath: string,
  newRows: OutboxRow[],
  options?: { endsWithNewline?: boolean }
): void;
export function safeFileName(key: string): string;
export function mimeBoundary(idempotencyKey: string): string;
export function utcDay(isoString: string): string;
export function escapeHtml(text: unknown): string;
export function markdownToBasicHtml(markdown: string): string;
export function renderFooterLinks(links: { view: string; manage: string; unsubscribe: string }): string;
