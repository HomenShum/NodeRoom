/**
 * Noteworthiness classifier — pure function, no side effects.
 *
 * Detects entities (companies, people) and signals (finance, research, URLs, tasks)
 * from raw text. Returns a structured finding with score, action, evidence spans,
 * and entity metadata.
 *
 * The classifier is deterministic: same input → same output. No LLM calls.
 */

/** Classifier version — pinned so taxonomy tweaks are detectable. */
export const CLASSIFIER_VERSION = "noteworthy-v1";

/** Stable signal enums — the canonical routing surface. */
export const SIGNAL = {
  ORG_CANDIDATE: "organization_candidate",
  FINANCE_SIGNAL: "finance_signal",
  PERSON_INTERACTION: "person_or_interaction",
  RESEARCH_SIGNAL: "research_signal",
  OPEN_QUESTION_OR_TASK: "open_question_or_task",
  SOURCE_URL: "source_url",
} as const;

export type Signal = (typeof SIGNAL)[keyof typeof SIGNAL];

/** Deterministic sort order so classifier output is stable regardless of detection order. */
export const SIGNAL_ORDER: Record<Signal, number> = {
  organization_candidate: 0,
  finance_signal: 1,
  person_or_interaction: 2,
  research_signal: 3,
  open_question_or_task: 4,
  source_url: 5,
};

export type EntityType = "company" | "person" | "product" | "source" | "metric" | "unknown";

export interface EntityDetection {
  type: EntityType;
  displayName: string;
  entityKey: string;
  confidence: number;
}

export interface EvidenceSpan {
  signal: Signal;
  text: string;
  confidence: number;
}

export type NoteworthyAction = "start_research_job" | "create_coach_cue" | "index_only" | "ignore";

export interface NoteworthyFinding {
  score: number;
  action: NoteworthyAction;
  signals: Signal[];
  /** Back-compat alias for signals. Same sorted stable-enum array. */
  reasons: Signal[];
  evidenceSpans: EvidenceSpan[];
  classifierVersion: string;
  facets: string[];
  entities: EntityDetection[];
}

/** First regex match's full text, or null. */
function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[0] : null;
}

/** Normalize an entity display name to a stable lowercase key. */
export function normalizeEntityKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

/** Common false-positive names to filter out. */
const STOP_NAMES = new Set([
  "Series", "Next", "The", "This", "Convex", "NodeRoom", "Need", "Follow",
  "What", "When", "Where", "Why", "How", "That", "They", "Will", "Just",
  "Have", "Been", "With", "From", "Into", "Only", "Also", "Some", "More",
  "Most", "Such", "Very", "Much", "Many", "Each", "Both", "All", "Any",
  "Met", "New", "Check", "See", "Look", "Let", "But", "And", "Or", "Not",
  "Can", "May", "Might", "Could", "Would", "Should", "Does", "Did", "Has",
  "Was", "Are", "Is", "Am", "Be", "Been", "Being", "Do", "Done", "Get",
  "Got", "Put", "Set", "Try", "Use", "Using", "Used", "Make", "Made",
  "Take", "Took", "Give", "Gave", "Find", "Found", "Tell", "Told", "Ask",
  "Said", "Went", "Came", "Left", "Right", "Now", "Then", "Here", "There",
  "Today", "Yesterday", "Tomorrow", "Last", "First", "Best", "Worst",
  "About", "Above", "Below", "After", "Before", "Between", "Through",
  "During", "Since", "Until", "Within", "Without", "Against", "During",
  "Talked", "Palo", "Alto",
]);

/**
 * Classify text for noteworthy entities and signals.
 *
 * Scoring:
 * - Base: 0.18 per detected signal (max 6 signals → 1.08, clamped to 1.0)
 * - Thresholds:
 *   - ≥ 0.70 → start_research_job (4+ signals)
 *   - ≥ 0.50 → create_coach_cue (2+ signals)
 *   - ≥ 0.35 → index_only (1+ signal)
 *   - < 0.35 → ignore
 */
export function classifyNoteworthy(text: string): NoteworthyFinding {
  const lower = text.toLowerCase();
  const signals = new Set<Signal>();
  const evidenceSpans: EvidenceSpan[] = [];
  const facets = new Set<string>();

  const add = (signal: Signal, span: string, confidence: number) => {
    if (!signals.has(signal)) {
      signals.add(signal);
      evidenceSpans.push({ signal, text: span.slice(0, 200), confidence });
    }
  };

  // Organization candidate — suffix match (Inc, Labs, Bio, etc.) or capitalized multi-word.
  const suffixSpan = firstMatch(
    text,
    /\b\w+\s+(inc|corp|labs|llc|ltd|health|bio|ai|technologies|systems|capital|ventures|bank|medical|therapeutics)\b/i,
  );
  if (suffixSpan) add(SIGNAL.ORG_CANDIDATE, suffixSpan, 0.9);

  const candidates = [...text.matchAll(/\b([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3})\b/g)]
    .map((m) => m[1])
    .filter((name) => {
      if (STOP_NAMES.has(name)) return false;
      const firstWord = name.split(/\s+/)[0];
      if (STOP_NAMES.has(firstWord)) return false;
      return true;
    });

  if (candidates.length && !signals.has(SIGNAL.ORG_CANDIDATE)) {
    add(SIGNAL.ORG_CANDIDATE, candidates[0], 0.7);
  }

  // Person or interaction.
  const personSpan = firstMatch(text, /\b(met|spoke|talked|call|founder|ceo|cfo|contact|intro|emailed)\b/i);
  if (personSpan) add(SIGNAL.PERSON_INTERACTION, personSpan, 0.8);

  // Finance signal.
  const financeSpan = firstMatch(
    text,
    /\b(series\s+[a-z]|seed|funding|raise|runway|burn|arr|revenue|ebitda|margin|cash)\b/i,
  );
  if (financeSpan) {
    add(SIGNAL.FINANCE_SIGNAL, financeSpan, 0.85);
    facets.add("funding");
    facets.add("runway_inputs");
  }

  // Research signal.
  const researchSpan = firstMatch(
    text,
    /\b(product|launch|announced|customer|pilot|hospital|pricing|competitor|headwind|market|news)\b/i,
  );
  if (researchSpan) {
    add(SIGNAL.RESEARCH_SIGNAL, researchSpan, 0.8);
    facets.add("product_news");
    facets.add("recent_signal");
  }

  // Open question or task.
  const taskSpan = firstMatch(
    text,
    /\b(verify|source|follow\s*up|ask|research|find|confirm|todo|next step|backlink|reference)\b/i,
  );
  if (taskSpan) {
    add(SIGNAL.OPEN_QUESTION_OR_TASK, taskSpan, 0.75);
    facets.add("source_validation");
  }

  // Source URL.
  const urlSpan = firstMatch(text, /https:\/\/\S+/i);
  if (urlSpan) add(SIGNAL.SOURCE_URL, urlSpan, 0.9);

  const sortedSignals = [...signals].sort((a, b) => SIGNAL_ORDER[a] - SIGNAL_ORDER[b]);
  const displayName = candidates[0] ?? "unknown";
  const entityType: EntityType =
    lower.includes("founder") || lower.includes("ceo") || lower.includes("cfo") ? "person" : "company";

  const score = Math.min(1, 0.18 + sortedSignals.length * 0.18);

  return {
    score,
    action:
      score >= 0.70
        ? "start_research_job"
        : score >= 0.50
          ? "create_coach_cue"
          : score >= 0.35
            ? "index_only"
            : "ignore",
    signals: sortedSignals,
    reasons: sortedSignals,
    evidenceSpans,
    classifierVersion: CLASSIFIER_VERSION,
    facets: [...facets],
    entities: candidates.length
      ? [
          {
            type: entityType,
            displayName,
            entityKey: normalizeEntityKey(displayName),
            confidence: Math.min(0.95, 0.55 + sortedSignals.length * 0.1),
          },
        ]
      : [],
  };
}
