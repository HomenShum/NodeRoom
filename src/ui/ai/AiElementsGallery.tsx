/**
 * Gallery of the AI Elements primitives adopted for NodeRoom, each themed with the
 * terracotta tokens. Rendered under the flagship conversation on ai-elements-check.html
 * so every primitive has a screenshotable, on-brand reference for docs/design/UI_CONTRACT.md.
 * No Convex, no app shell — pure render proof.
 */
import { Task, TaskTrigger, TaskContent, TaskItem, TaskItemFile } from "@/components/ai-elements/task";
import { Sources, SourcesTrigger, SourcesContent, Source } from "@/components/ai-elements/sources";
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion";
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationActions,
  ConfirmationAction,
} from "@/components/ai-elements/confirmation";
import {
  InlineCitation,
  InlineCitationText,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationSource,
  InlineCitationQuote,
} from "@/components/ai-elements/inline-citation";
import { Terminal, TerminalHeader, TerminalTitle, TerminalContent } from "@/components/ai-elements/terminal";
import { Agent, AgentHeader, AgentContent, AgentInstructions } from "@/components/ai-elements/agent";
import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactDescription,
  ArtifactContent,
} from "@/components/ai-elements/artifact";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { Shimmer } from "@/components/ai-elements/shimmer";

function GalleryCard({ label, status, children }: { label: string; status: "live" | "scaffolded"; children: React.ReactNode }) {
  return (
    <div
      data-testid={`ai-gallery-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--bg-primary)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>{label}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".02em",
            textTransform: "uppercase",
            padding: "2px 7px",
            borderRadius: 6,
            border: "1px solid var(--line)",
            color: status === "live" ? "var(--accent)" : "var(--text-muted)",
            background: "var(--bg-secondary)",
          }}
        >
          {status === "live" ? "live in chat" : "scaffolded"}
        </span>
      </div>
      <div className="ai-scope">{children}</div>
    </div>
  );
}

export function AiElementsGallery() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
      <GalleryCard label="Task" status="scaffolded">
        <Task defaultOpen>
          <TaskTrigger title="Reconcile Q3 revenue" />
          <TaskContent>
            <TaskItem>Pulled the 10-Q for ACME Corp</TaskItem>
            <TaskItem>
              Cross-checked the figure in <TaskItemFile>acme-10q.pdf</TaskItemFile>
            </TaskItem>
          </TaskContent>
        </Task>
      </GalleryCard>

      <GalleryCard label="Sources" status="scaffolded">
        <Sources>
          <SourcesTrigger count={2} />
          <SourcesContent>
            <Source href="https://sec.gov/acme-10q.pdf" title="ACME 10-Q (Q3)" />
            <Source href="https://sec.gov/acme-8k.pdf" title="ACME 8-K" />
          </SourcesContent>
        </Sources>
      </GalleryCard>

      <GalleryCard label="Suggestions" status="scaffolded">
        <Suggestions>
          <Suggestion suggestion="Reconcile Q3 revenue" />
          <Suggestion suggestion="Draft the diligence memo" />
          <Suggestion suggestion="Chart the funding rounds" />
        </Suggestions>
      </GalleryCard>

      <GalleryCard label="Confirmation" status="scaffolded">
        <Confirmation state="approval-requested" approval={{ id: "appr-1" }}>
          <ConfirmationTitle>Write cited cell to the shared sheet?</ConfirmationTitle>
          <ConfirmationRequest>
            The agent wants to write <strong>$4.19M</strong> into Q3 revenue with a source link.
          </ConfirmationRequest>
          <ConfirmationActions>
            <ConfirmationAction>Approve</ConfirmationAction>
            <ConfirmationAction variant="outline">Reject</ConfirmationAction>
          </ConfirmationActions>
        </Confirmation>
      </GalleryCard>

      <GalleryCard label="Inline citation" status="scaffolded">
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          Q3 revenue reconciled to $4.19M{" "}
          <InlineCitation>
            <InlineCitationText>per the 10-Q</InlineCitationText>
            <InlineCitationCard>
              <InlineCitationCardTrigger sources={["https://sec.gov/acme-10q.pdf"]} />
              <InlineCitationCardBody>
                <InlineCitationSource title="ACME 10-Q" url="https://sec.gov/acme-10q.pdf" />
                <InlineCitationQuote>Condensed Statements of Operations, p.2</InlineCitationQuote>
              </InlineCitationCardBody>
            </InlineCitationCard>
          </InlineCitation>
        </p>
      </GalleryCard>

      <GalleryCard label="Terminal" status="scaffolded">
        <Terminal output={"$ npm run floor\n✓ 2125 tests passed"}>
          <TerminalHeader>
            <TerminalTitle>bash</TerminalTitle>
          </TerminalHeader>
          <TerminalContent />
        </Terminal>
      </GalleryCard>

      <GalleryCard label="Agent" status="scaffolded">
        <Agent>
          <AgentHeader name="NodeAgent" />
          <AgentContent>
            <AgentInstructions>Reconcile figures against source filings and write evidence-bearing cells.</AgentInstructions>
          </AgentContent>
        </Agent>
      </GalleryCard>

      <GalleryCard label="Artifact" status="scaffolded">
        <Artifact>
          <ArtifactHeader>
            <div>
              <ArtifactTitle>Company research</ArtifactTitle>
              <ArtifactDescription>1 company · 5 columns</ArtifactDescription>
            </div>
          </ArtifactHeader>
          <ArtifactContent>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>CardioNova — Series B — $4.19M Q3 revenue</div>
          </ArtifactContent>
        </Artifact>
      </GalleryCard>

      <GalleryCard label="Chain of thought" status="scaffolded">
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>Reasoning trace</ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep label="Read the sheet's Q3 figure" status="complete" />
            <ChainOfThoughtStep label="Fetch the 10-Q" status="complete" />
            <ChainOfThoughtStep label="Write the cited cell" status="active" />
          </ChainOfThoughtContent>
        </ChainOfThought>
      </GalleryCard>

      <GalleryCard label="Shimmer" status="scaffolded">
        <Shimmer>Thinking through the variance…</Shimmer>
      </GalleryCard>
    </div>
  );
}
