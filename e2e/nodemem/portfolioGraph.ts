/**
 * NodeMem long-context benchmark — the Mark Liu / UpScaleX accumulated-memory graph.
 *
 * WHY THIS EXISTS: the original nodemem benchmark seeded 3 tiny facts, so the ContextPack never
 * exceeded the 600-token budget (bounded ≡ full) and the task was trivially completable without
 * recall (memory off ≈ on). That measures plumbing, not value. NodeMem's value only appears when
 * memory is LARGE (budget binds → bounded must trim while full keeps more) AND the task REQUIRES
 * recalling a specific buried fact (memory-off must re-research or fail).
 *
 * This module defines a realistic VC workspace as a STRUCTURED graph, then generates fact-sentences
 * from it (compact + scalable to 10/50/200). A subset of facts are MEMORY-ONLY private-diligence
 * notes — not web-researchable — which become the recall targets: only memory-on can answer them.
 *
 * Sources for the public facts: the user's own UpScaleX research (Palo Alto, founded 2024, 4-person
 * fund; Mark Liu = AI/agentic sector lead, ex-PE; Alan Zong = co-founder, ex-Alibaba Global
 * Innovation Investments, Harvard MBA; portfolio incl. MAI, Make the Dot, Hanger, Dex, WorldEngine,
 * Daxo, BeFreed, Dimension Studios). Private-diligence notes are SYNTHETIC (clearly fictional) so the
 * recall targets are deterministic and provably absent from the public web.
 */

export type FactKind = "public" | "memory_only";

export interface SeedFact {
  /** stable id (room-scoped at seed time to avoid the global content-hash dedup) */
  id: string;
  sourceKind: string; // chat | source_capture | note | meeting
  kind: FactKind;
  /** 1 = core (always present), 2 = portfolio detail, 3 = deep graph (connections-of-connections) */
  tier: 1 | 2 | 3;
  text: string;
}

interface PortfolioCo {
  name: string;
  sector: string;
  funding: string;
  founder: string;
  founderBg: string; // public founder background
  coInvestor: string; // public co-investor on the round
  /** SYNTHETIC private diligence note — memory-only, the recall target */
  privateNote: string;
}

// ── The structured graph (public facts are real per the user's research; private notes are synthetic) ──

const UPSCALEX = {
  name: "UpScaleX",
  location: "Palo Alto",
  founded: 2024,
  size: "4-person fund/accelerator",
  thesis: "AI, agentic applications, and digital commerce at pre-seed/seed",
};

const MARK = {
  name: "Mark Liu",
  role: "Investor & AI/agentic sector lead at UpScaleX",
  background: "ex-private equity (infrastructure & energy), investment management",
};

const ALAN = {
  name: "Alan Zong",
  role: "Co-founder & Partner at UpScaleX",
  background: "former Head of Global Innovation Investments at Alibaba International (AI, blockchain, gaming, metaverse); Harvard MBA; early backer of unicorns and decacorns",
};

const PORTFOLIO: PortfolioCo[] = [
  { name: "MAI", sector: "AI performance marketing", funding: "$25M Series A", founder: "Priya Nandakumar", founderBg: "ex-Meta Ads ranking lead",
    coInvestor: "Lightspeed", privateNote: "Mark flagged MAI's blended CAC creeping to $310 in the March 2026 partner meeting; gated the follow-on on a payback-period proof." },
  { name: "Make the Dot", sector: "AI fashion design", funding: "$6M seed", founder: "Emilie Ho", founderBg: "Parsons grad, ex-Shein design systems",
    coInvestor: "Forerunner", privateNote: "Mark's note: Emilie Ho's real moat is the proprietary fit dataset from her prior Shein team, not the generator — flagged as the reason to lean in." },
  { name: "Hanger", sector: "AI dexterous robotic hands", funding: "$12M seed", founder: "Tomas Brandt", founderBg: "ex-Boston Dynamics manipulation",
    coInvestor: "Eclipse", privateNote: "Mark's diligence: Hanger's tendon actuator yield was only 40% in the Feb 2026 factory visit — the hidden risk Alan asked to monitor monthly." },
  { name: "Dex", sector: "AI learning camera for kids", funding: "$4M seed", founder: "Reni Cao", founderBg: "ex-Google AR, Stanford HCI",
    coInvestor: "Nick Carter (angel)", privateNote: "Mark's note: Dex's seed was unblocked only after Nick Carter's angel check de-risked the hardware BOM; Reni Cao agreed to a child-safety audit as a side letter." },
  { name: "WorldEngine", sector: "embodied-AI training data", funding: "$18M Series A", founder: "Yusuf Adeyemi", founderBg: "ex-Waymo simulation",
    coInvestor: "Index", privateNote: "Mark flagged WorldEngine's data-licensing exposure: 60% of training frames come from one robotics partner whose contract renews Q3 2026." },
  { name: "Daxo", sector: "AI back-office automation", funding: "$3M pre-seed", founder: "Hana Park", founderBg: "ex-Ramp ops, Wharton",
    coInvestor: "South Park Commons", privateNote: "Mark's note: Daxo's pre-seed was a relationship bet on Hana Park from the SPC network — flagged 'thin metrics, strong operator' on the deal log." },
  { name: "BeFreed", sector: "AI audio summaries", funding: "$8M seed", founder: "Leo Zhang", founderBg: "Columbia CS, 1M-user consumer app",
    coInvestor: "a16z (seed)", privateNote: "Mark's diligence: BeFreed's 1M users were 80% non-paying; the retention cohort Mark trusted was the internal 'Lighthouse' cohort Leo Zhang opened from the Columbia alumni seed channel." },
  { name: "Dimension Studios", sector: "AI content / world-building", funding: "$10M seed", founder: "Mara Velasquez", founderBg: "ex-Pixar TD, ex-Roblox",
    coInvestor: "Alan Zong led", privateNote: "Mark's note: Dimension Studios is the one deal Alan Zong personally led and reused his Alibaba metaverse co-investor relationship to fill the round." },
];

// Alan's Alibaba-era deals (public framing; the cross-link to Dimension Studios is the deep recall target)
const ALAN_ALIBABA = [
  { company: "Lazada Ventures AI", note: "Alan led an AI-commerce bet at Alibaba International before founding UpScaleX." },
  { company: "MetaForge", note: "Alan backed MetaForge (metaverse infra) at Alibaba; its lead co-investor later joined the Dimension Studios round at Alan's invitation." },
  { company: "ChainPlay", note: "Alan's Alibaba blockchain-gaming bet ChainPlay reached unicorn status in 2023." },
];

// Connections-of-connections (tier 3): founders' prior colleagues + shared co-investors
const DEEP_CONNECTIONS = [
  "Priya Nandakumar (MAI) and Yusuf Adeyemi (WorldEngine) both report being recruited from the same ex-Meta ranking cohort.",
  "Lightspeed co-invested in both MAI and a competing perf-marketing startup, a conflict Mark logged.",
  "Emilie Ho (Make the Dot) sources fabric data from a supplier also used by a Forerunner portfolio company.",
  "Tomas Brandt (Hanger) and the Eclipse partner on the deal overlapped at Boston Dynamics.",
  "Reni Cao (Dex) advised BeFreed on its child-mode camera feature, linking two portfolio cos.",
  "Leo Zhang (BeFreed) and Mara Velasquez (Dimension Studios) co-presented at the UpScaleX demo day.",
  "Hana Park (Daxo) was introduced to UpScaleX through the same South Park Commons partner who knows Reni Cao.",
  "The MetaForge lead co-investor that Alan reused on Dimension Studios also sits on the ChainPlay board.",
];

const EVENTS = [
  "UpScaleX hosted 'Beyond the Horizon: AI & Digital Commerce' where MAI and Dimension Studios demoed.",
  "Mark Liu attended the Cookiy AI Builders Social and logged three new pre-seed leads.",
  "Alan Zong spoke at an Ugly Talk session on cross-border AI commerce.",
  "UpScaleX's Q1 2026 demo day featured Dex, BeFreed, and Hanger to LPs.",
];

// ── Fact generation: emit sentences from the structured graph, tiered + scalable ──

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

export function buildFacts(): SeedFact[] {
  const facts: SeedFact[] = [];
  let i = 0;
  const add = (sourceKind: string, kind: FactKind, tier: 1 | 2 | 3, text: string) =>
    facts.push({ id: `fact_${pad(i++)}`, sourceKind, kind, tier, text });

  // Tier 1 — core identity (always present)
  add("note", "public", 1, `${UPSCALEX.name} is a ${UPSCALEX.size} in ${UPSCALEX.location}, founded ${UPSCALEX.founded}, focused on ${UPSCALEX.thesis}.`);
  add("note", "public", 1, `${MARK.name} is ${MARK.role}; background: ${MARK.background}.`);
  add("note", "public", 1, `${ALAN.name} is ${ALAN.role}; background: ${ALAN.background}.`);
  for (const co of PORTFOLIO) {
    add("source_capture", "public", 1, `${co.name} (${co.sector}) raised ${co.funding}; founder ${co.founder}.`);
  }

  // Tier 2 — portfolio detail + private diligence notes (the primary recall targets)
  for (const co of PORTFOLIO) {
    add("source_capture", "public", 2, `${co.name}'s founder ${co.founder} background: ${co.founderBg}. Lead co-investor: ${co.coInvestor}.`);
    add("meeting", "memory_only", 2, co.privateNote);
  }
  for (const d of ALAN_ALIBABA) {
    add("source_capture", "public", 2, `${d.company}: ${d.note}`);
  }

  // Tier 3 — deep graph: connections-of-connections + events (the cross-link recall target lives here)
  for (const c of DEEP_CONNECTIONS) add("chat", "memory_only", 3, c);
  for (const e of EVENTS) add("chat", "public", 3, e);

  // Tier 3 synthetic VOLUME — realistic accumulated tracking notes that bury the signal facts in noise.
  // This is the point of the large tier: retrieval must surface the relevant buried fact among cruft,
  // and the bounded budget must TRIM (dropping some of these) while full keeps more. ~22 notes/company.
  for (const co of PORTFOLIO) {
    for (let week = 1; week <= 22; week++) {
      add(
        "meeting",
        "memory_only",
        3,
        `${co.name} 2026-W${pad(week)} tracking note (Mark): pipeline and headcount reviewed; no material change beyond the logged risk; next check-in scheduled.`,
      );
    }
  }

  return facts;
}

/** Return the N-fact subset for a given memory size, lowest tier first (core always included). */
export function factsForSize(size: number): SeedFact[] {
  const all = buildFacts().sort((a, b) => a.tier - b.tier);
  return all.slice(0, size);
}

/**
 * Recall targets — diligence-spreadsheet cells whose CORRECT value is a memory-only buried fact.
 * `mustContain` are the discriminating tokens the grader checks for in the agent's cell value.
 * These are deliberately NOT web-researchable (synthetic private notes), so memory-off cannot answer
 * them — it must mark needs_review or guess wrong, while memory-on recalls them.
 */
export interface RecallTarget {
  cell: string; // human label of what the cell should contain
  prompt: string; // the question posed to the agent for this row
  mustContain: string[]; // discriminating ground-truth tokens (case-insensitive; ANY match = recalled)
  tierNeeded: 1 | 2 | 3; // which memory size first makes this answerable
}

// NOTE: labels + question text must NOT contain any `mustContain` token — the chat echoes the prompt,
// and the grader reads chat, so a leaked token would score as a recall for EVERY variant (incl. bare).
// Tokens are SPECIFIC + synthetic (a bare agent with no memory and no web cannot produce them).
export const RECALL_TARGETS: RecallTarget[] = [
  { cell: "MAI flagged metric",
    prompt: "What exact blended-CAC dollar figure did Mark flag for the MAI follow-on?",
    mustContain: ["$310", "310"], tierNeeded: 2 },
  { cell: "Fashion-co real moat",
    prompt: "Per Mark's notes, what proprietary data asset is the real moat behind the AI-fashion company?",
    mustContain: ["fit dataset"], tierNeeded: 2 },
  { cell: "Robotics hidden risk",
    prompt: "What component-yield risk did Mark's robotic-hands diligence surface for Alan to monitor monthly?",
    mustContain: ["tendon actuator"], tierNeeded: 2 },
  { cell: "Reused co-investor source",
    prompt: "Which prior Alibaba-era portfolio name's co-investor did Alan reuse to fill the one round he personally led?",
    mustContain: ["MetaForge"], tierNeeded: 2 },
  { cell: "Audio-co retention cohort",
    prompt: "What named retention cohort did Mark trust for the AI-audio company's user base?",
    mustContain: ["Lighthouse"], tierNeeded: 2 },
  { cell: "Board cross-link",
    prompt: "That reused co-investor also sits on which other portfolio company's board?",
    mustContain: ["ChainPlay"], tierNeeded: 3 },
];

/**
 * A recall target is "answerable" at a given memory size ONLY if a memory-only fact that supports it
 * is within the seeded subset. This makes size=10 (tier-1 public only) a clean control: no buried
 * facts are in memory, so the denominator is 0 and a non-zero recall would be a hallucination (the
 * synthetic discriminating tokens cannot be web-sourced). The grader divides by this count.
 */
export function targetAnswerableAtSize(target: RecallTarget, size: number): boolean {
  const subset = factsForSize(size);
  return subset.some(
    (f) =>
      f.kind === "memory_only" &&
      target.mustContain.some((tok) => f.text.toLowerCase().includes(tok.toLowerCase())),
  );
}
