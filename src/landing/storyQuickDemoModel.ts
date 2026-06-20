export type StoryCellRef = "B2" | "C2" | "D2" | "E2";

export type StoryAgentTurn = {
  prompt: string;
  variance: string;
  note: string;
  steps: string[];
  finalText: string;
};

const DEFAULT_Q2 = 10_000;

export function parseStoryNumber(value: string): number {
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatStoryNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function storyVariance(q3Revenue: string, q2Revenue = DEFAULT_Q2): string {
  return formatStoryNumber(parseStoryNumber(q3Revenue) - q2Revenue);
}

export function buildStoryAgentTurn(prompt: string, q3Revenue: string, q2Revenue = DEFAULT_Q2): StoryAgentTurn {
  const cleanPrompt = prompt.trim() || "Check the Q3 revenue variance and leave a review note.";
  const variance = storyVariance(q3Revenue, q2Revenue);
  const note = `CAS pass: C2 ${formatStoryNumber(parseStoryNumber(q3Revenue))}, D2 ${variance}`;

  return {
    prompt: cleanPrompt,
    variance,
    note,
    steps: [
      `Read B2 as ${formatStoryNumber(q2Revenue)} and C2 as ${formatStoryNumber(parseStoryNumber(q3Revenue))}.`,
      `Computed D2 = C2 - B2 = ${variance}.`,
      "Preserved the human edit, wrote only the derived cell, and attached the trace.",
    ],
    finalText: `Done. I kept the human C2 edit, recomputed D2 as ${variance}, and marked the review note ready.`,
  };
}
