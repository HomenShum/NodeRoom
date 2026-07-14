/**
 * Standalone render check for the AI Elements adoption — no Convex, no app shell.
 * Proves the primitives render on-brand (terracotta tokens, both themes) and that
 * the preflight-free Tailwind layer doesn't fight the .r-* system. Reused as a dev
 * surface (ai-elements-check.html), mirroring pdf-visual-check.html.
 */
import { useState } from "react";
import { Checkpoint, CheckpointTrigger } from "@/components/ai-elements/checkpoint";
import { AgentConversation, type AgentConversationMessage } from "./AgentConversation";

const SAMPLE: AgentConversationMessage[] = [
  {
    id: "m1",
    role: "user",
    parts: [{ kind: "text", text: "Reconcile Q3 revenue against the source filings.", streaming: false }],
  },
  {
    id: "m2",
    role: "assistant",
    parts: [
      {
        kind: "reasoning",
        step: 0,
        streaming: false,
        text: "The company sheet has Q3 revenue at 4.2M. I should pull the 10-Q and confirm the figure before writing an evidence-bearing cell.",
      },
      {
        kind: "tool",
        name: "fetch_source",
        toolCallId: "t1",
        state: "output-available",
        input: { url: "https://sec.gov/…/acme-10q.pdf", pages: "1-3" },
        output: { revenueQ3: "4.19M", cited: "p.2, Condensed Statements of Operations" },
      },
      {
        kind: "text",
        streaming: false,
        text: "**Reconciled.** The 10-Q reports Q3 revenue of **$4.19M** (p.2), a $10K variance from the sheet's $4.2M — within rounding. I've written the cited figure with a source link.",
      },
    ],
  },
];

export function AiElementsShowcase() {
  const [dark, setDark] = useState(true);
  const setTheme = (isDark: boolean) => {
    setDark(isDark);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  };
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-app)", color: "var(--text-primary)", padding: 24 }}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>AI Elements — NodeRoom render check</div>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Vercel AI Elements themed with NodeRoom terracotta tokens
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTheme(!dark)}
            style={{
              border: "1px solid var(--line-strong)",
              borderRadius: 8,
              padding: "6px 12px",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {dark ? "Switch to light" : "Switch to dark"}
          </button>
        </header>

        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 14,
            background: "var(--bg-primary)",
            boxShadow: "var(--shadow-md)",
            padding: 16,
            minHeight: 360,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <AgentConversation messages={SAMPLE} />
          <div className="ai-scope" style={{ marginTop: 12 }}>
            <Checkpoint>
              <CheckpointTrigger label="Restore checkpoint" />
            </Checkpoint>
          </div>
        </div>
      </div>
    </div>
  );
}
