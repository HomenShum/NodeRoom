/** Type surface for preview-outbox.mjs. Keep in sync with the .mjs implementation. */

import type { OutboxRow, OutboxState } from "./outbox-shared.mjs";

export function applyTransition(options: {
  outboxPath?: string;
  key: string;
  to: OutboxState;
  extra?: Record<string, unknown>;
  now?: string | Date;
}): OutboxRow;

export function recordFailure(options: {
  outboxPath?: string;
  key: string;
  reason?: string;
  now?: string | Date;
}): OutboxRow;

export function formatOutboxTable(outboxPath?: string): string;
