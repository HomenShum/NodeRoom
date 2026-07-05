/** Type surface for create-gmail-drafts.mjs. Keep in sync with the .mjs implementation. */

import type { OutboxRow } from "./outbox-shared.mjs";

export const DEFAULT_FROM: string;

export function renderEml(row: OutboxRow, options?: { from?: string; date?: Date }): string;

export type CreateDraftsSummary = {
  drafted: number;
  failed: number;
  pendingRemaining: number;
  corruptLinesIgnored: number;
  draftsDir: string;
};

export function createDrafts(options?: {
  outboxPath?: string;
  draftsDir?: string;
  limit?: number | string;
  from?: string;
  now?: string | Date;
}): CreateDraftsSummary;
