/**
 * sec_facts — agent tool. Authoritative SEC EDGAR financial facts via the official data API (free,
 * structured, no scraping; past EDGAR's HTML 403). Persists a captureRecord so the facts render in the
 * Trace tab with their SEC source URL + accession as provenance. The reliable lane for SEC numbers.
 */
import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";
import { fetchSecFacts } from "../../capture/secFacts";

const schema = z.object({
  company: z.string().describe("ticker (e.g. AAPL) or CIK"),
  concept: z.string().describe("e.g. revenue, net income, assets, EPS, or an exact us-gaap tag"),
});

export const secFactsTool: AgentTool = {
  name: "sec_facts",
  description:
    "Look up authoritative financial facts from SEC EDGAR's official data API (data.sec.gov) by ticker/CIK + concept " +
    "(revenue, net income, assets, EPS, …). Free, structured, no scraping — prefer this over capture_source/fetch_source for SEC-reported numbers.",
  schema,
  async execute(args: z.infer<typeof schema>, rt: RoomTools) {
    const r = await fetchSecFacts({ company: args.company, concept: args.concept });
    if (r.ok && r.facts) {
      await rt.recordCapture?.({
        url: r.sourceUrl!,
        goal: `${args.concept} — ${args.company}`,
        ok: true,
        title: `SEC · ${r.company ?? args.company}`,
        data: { cik: r.cik, tag: r.tag, unit: r.unit, sourceUrl: r.sourceUrl, facts: r.facts },
        steps: r.facts.map((f) => ({
          phase: "SEC EDGAR",
          label: `${r.concept} FY${f.fiscalYear ?? "?"} = ${f.value} ${r.unit ?? ""}`.trim(),
          status: "ok",
          detail: [f.form, f.accn ? `accession ${f.accn}` : null].filter(Boolean).join(" · "),
        })),
      });
    }
    return r;
  },
};
