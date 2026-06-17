/**
 * SEC EDGAR data-API lane (Convex action). Authoritative, free, structured filing facts via the
 * official data.sec.gov API — runs in-Convex (plain fetch), room-member-authed, no worker/token.
 * Persists a captureRecord so the facts render in the Trace tab alongside Firecrawl/web captures.
 */
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import { actorProofV } from "./lib";
import { fetchSecFacts } from "../src/nodeagent/capture/secFacts";

const assertMemberRef = makeFunctionReference<"query">("captures:assertMember") as any;
const recordRef = makeFunctionReference<"mutation">("captures:record") as any;

function human(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export const facts = action({
  args: { roomId: v.id("rooms"), requester: actorProofV, company: v.string(), concept: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; error?: string; recordId?: string }> => {
    await ctx.runQuery(assertMemberRef, { roomId: a.roomId, requester: a.requester }); // member-only

    const r = await fetchSecFacts({ company: a.company, concept: a.concept });
    const steps = r.ok && r.facts && r.facts.length
      ? r.facts.map((f) => ({
          phase: "SEC EDGAR",
          label: `${r.concept} FY${f.fiscalYear ?? "?"} = ${human(f.value)} ${r.unit ?? ""}`.trim(),
          status: "ok",
          detail: [f.form, f.accn ? `accession ${f.accn}` : null, f.end ? `period end ${f.end}` : null].filter(Boolean).join(" · "),
        }))
      : [{ phase: "SEC EDGAR", label: "no SEC data found", status: "warn", detail: r.error }];

    const recordId = await ctx.runMutation(recordRef, {
      roomId: a.roomId,
      url: r.sourceUrl ?? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(a.company)}`,
      goal: `${a.concept} — ${a.company}`,
      title: `SEC · ${r.company ?? a.company}`,
      ok: r.ok,
      error: r.error,
      ts: Date.now(),
      steps,
      data: r.ok ? { cik: r.cik, tag: r.tag, unit: r.unit, sourceUrl: r.sourceUrl, facts: r.facts } : { error: r.error },
    });
    return { ok: r.ok, error: r.error, recordId: recordId as string };
  },
});
