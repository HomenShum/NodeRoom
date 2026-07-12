import { makeFunctionReference } from "convex/server";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { embedOkfText, okfEmbeddingPlan, OKF_EMBEDDING_DIMENSION } from "./okfEmbeddingProvider";
import { beginProviderSpend, completeProviderSpend, type ProviderSpendAdmission } from "./providerSpend";

const claimOutboxRef = makeFunctionReference<"mutation">("okf:claimOutbox") as any;
const completeOutboxRef = makeFunctionReference<"mutation">("okf:completeOutbox") as any;
const failOutboxRef = makeFunctionReference<"mutation">("okf:failOutbox") as any;

export const drainBatch = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const leaseId = crypto.randomUUID();
    const jobs = await ctx.runMutation(claimOutboxRef, { leaseId, leaseMs: 2 * 60_000, limit: Math.max(1, Math.min(a.limit ?? 5, 20)) });
    let completed = 0;
    let failed = 0;
    for (const job of jobs as Array<{ jobId: string; roomId: string; conceptId: string; contentHash: string; text: string; visibility: "public" | "private" | "redacted"; ownerId?: string; attempts?: number }>) {
      let providerSpend: ProviderSpendAdmission | undefined;
      let providerModel = "okf-embedding";
      try {
        const embeddingOptions = {
          artifacts: [{ title: job.conceptId, visibility: job.visibility, source: "generated" as const }],
        };
        const embeddingPlan = okfEmbeddingPlan(embeddingOptions);
        providerModel = `${embeddingPlan.provider}/${embeddingPlan.model}`;
        if (embeddingPlan.provider !== "local") {
          providerSpend = await beginProviderSpend(ctx, {
            roomId: job.roomId as never,
            requesterId: job.ownerId ?? "system:okf",
            route: "embedding",
            metering: "unavailable",
            creditMode: "quick",
            goal: `Index ${job.conceptId}`,
            modelHint: providerModel,
            reservationKey: `okf:${job.jobId}:attempt:${Math.max(1, job.attempts ?? 1)}`,
          });
          if (!providerSpend.execute) throw new Error(`provider_spend_duplicate:${providerSpend.duplicateReason}`);
        }
        const parts = splitChunks(job.text);
        const chunks = [];
        for (let i = 0; i < parts.length; i++) {
          const embedded = await embedOkfText(parts[i], "RETRIEVAL_DOCUMENT", embeddingOptions);
          providerModel = `${embedded.provider}/${embedded.model}`;
          chunks.push({
            chunkId: `${job.conceptId}#${i}`,
            chunkIndex: i,
            text: parts[i],
            embedding: embedded.vector,
            embeddingProvider: embedded.provider,
            embeddingModel: embedded.model,
            embeddingDimension: OKF_EMBEDDING_DIMENSION,
            visibility: job.visibility,
            ownerId: job.ownerId,
          });
        }
        if (providerSpend) await completeProviderSpend(ctx, providerSpend, { model: providerModel, success: true });
        await ctx.runMutation(completeOutboxRef, { jobId: job.jobId, roomId: job.roomId, conceptId: job.conceptId, contentHash: job.contentHash, chunks });
        completed++;
      } catch (error) {
        failed++;
        if (providerSpend) {
          await completeProviderSpend(ctx, providerSpend, {
            model: providerModel,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
        }
        await ctx.runMutation(failOutboxRef, { jobId: job.jobId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { claimed: (jobs as unknown[]).length, completed, failed };
  },
});

function splitChunks(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return ["empty"];
  const max = 1800;
  const chunks: string[] = [];
  for (let i = 0; i < normalized.length; i += max) chunks.push(normalized.slice(i, i + max));
  return chunks.slice(0, 8);
}
