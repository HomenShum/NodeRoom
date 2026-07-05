/** Type surface for enqueue-digest.mjs. Keep in sync with the .mjs implementation. */

export function parseArgs(argv: string[]): Record<string, string | undefined>;
export function deriveSubject(roomTitle: string, briefMarkdown: string, briefKey: string): string;
export function buildLinks(
  roomSlug: string,
  subscriptionId: string
): { view: string; manage: string; unsubscribe: string };

export type EnqueueSummary = {
  enqueued: number;
  skipped: number;
  alreadyQueued: number;
  invalid: number;
  corruptLinesIgnored: number;
  outbox: string;
  briefKey: string;
  subject: string;
};

export function enqueueDigest(options: {
  roomSlug: string;
  briefPath: string;
  subscribersPath: string;
  outboxPath?: string;
  briefKey?: string;
  roomTitle?: string;
  cadence?: string;
}): EnqueueSummary;
