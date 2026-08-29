/* ============================================================================
   NodeAgent Mobile — bottom sheets (Work Plan · Evidence · Coach)
   Ported from the design prototype (na-sheets.jsx).
   ============================================================================ */
import * as React from "react";
import { Ico } from "./MobileIcons";
import type { IconName } from "./MobileIcons";
import { Pill, riStyle } from "./MobileScreens";
import * as D from "./mobileData";
import type { Tone } from "./mobileData";
import type { MobileCtx } from "./mobileTypes";

const { useEffect, useState } = React;

/** SheetHead reads optional back/close affordances the controller may provide. */
// MobileCtx already provides canBack / backSheet / openSource with their real
// signatures, so SheetHead just takes the full ctx.
type SheetHeadCtx = MobileCtx;

function SheetHead({
  title,
  sub,
  ctx,
  onClose,
}: {
  title: string;
  sub: string;
  ctx?: SheetHeadCtx;
  onClose?: () => void;
}): React.ReactElement {
  const close = onClose || (ctx && ctx.closeSheet);
  const canBack = ctx && ctx.canBack;
  return React.createElement(
    "div",
    { className: "na-sheet-head" },
    canBack
      ? React.createElement(
          "button",
          { className: "na-headback", onClick: ctx && ctx.backSheet, "aria-label": "Back" },
          Ico("chevL"),
        )
      : null,
    React.createElement("div", { className: "st" }, React.createElement("strong", null, title), React.createElement("span", null, sub)),
    React.createElement("button", { className: "na-close", onClick: close, "aria-label": "Close" }, Ico("x")),
  );
}

type ScopeLane = { variant: "will" | "wont" | "create"; label: string; icon: IconName; mark: IconName; items: string[] };

function scopeTable(P: D.Plan): React.ReactElement {
  const lanes: ScopeLane[] = [
    { variant: "will", label: "Will read", icon: "eye", mark: "check", items: P.willRead },
    { variant: "wont", label: "Will not read", icon: "lock", mark: "x", items: P.wontRead },
    { variant: "create", label: "Will create", icon: "plus", mark: "check", items: P.willCreate },
  ];
  return React.createElement(
    "div",
    { className: "na-scope-table" },
    lanes.map((ln) =>
      React.createElement(
        "div",
        { key: ln.variant, className: "na-scope-group", "data-variant": ln.variant },
        React.createElement(
          "div",
          { className: "na-scope-grouphead" },
          React.createElement("span", { className: "lh-tag " + ln.variant }, Ico(ln.icon), ln.label),
          React.createElement("span", { className: "lh-count" }, ln.items.length),
        ),
        React.createElement(
          "ul",
          { className: "na-scope-items" },
          ln.items.map((it, i) =>
            React.createElement(
              "li",
              { key: i },
              React.createElement("span", { className: "sm " + ln.variant }, Ico(ln.mark)),
              React.createElement("span", { className: "st" }, it),
            ),
          ),
        ),
      ),
    ),
  );
}

// ── WORK PLAN / APPROVAL (z.ai-style chat — actions via composer, no big buttons) ──
export function PlanSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const P = ctx.livePlan ?? D.PLAN;
  const run = ctx.runState; // 'plan' | 'running' | 'done'
  const effectiveRun = ctx.isLive ? "plan" : run;
  const [thread, setThread] = useState<Array<{ role: "user" | "agent" | "status"; text: string }>>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const scope = [
    ...P.willRead.map((t) => ({ st: effectiveRun === "plan" ? "todo" : effectiveRun === "running" ? "running" : "done", tx: t, kind: "read" })),
    ...P.willCreate.map((t) => ({ st: effectiveRun === "done" ? "done" : "todo", tx: t, kind: "create" })),
  ];
  const mark = (s: { st: string; tx: string; kind: string }) =>
    s.kind === "create"
      ? React.createElement(
          "span",
          { className: "na-todo-mark" + (s.st === "done" ? " done" : ""), "data-create": true },
          s.st === "done" ? Ico("check") : Ico("plus"),
        )
      : s.st === "done"
        ? React.createElement("span", { className: "na-todo-mark done" }, Ico("check"))
        : s.st === "running"
          ? React.createElement("span", { className: "na-todo-mark running" }, React.createElement("i", { className: "spin" }))
          : React.createElement("span", { className: "na-todo-mark" });
  const doneN = scope.filter((s) => s.st === "done").length;

  const reply = (q: string): string => {
    const s = q.toLowerCase();
    if (/scope|edit|add|remove|change/.test(s)) return "Tell me what to add or drop and I’ll re-scope before locking the plan hash — e.g. “also read the pitch deck” or “don’t touch the sheet”.";
    if (/cost|price|cheap|budget/.test(s)) return "Estimated at " + ((P.stats.find((x) => x.mono) || ({} as Partial<D.Stat>)).v) + ". I can route to a cheaper model if you want to trade depth for spend.";
    if (/safe|write|overwrite|private/.test(s)) return "Read-only — I propose every change as a diff and never write a cell or note until you approve. Your private notes stay out of scope.";
    return "I’ll keep this read-only and propose a diff. Tap Approve to run, or tell me how to adjust the scope.";
  };
  const ask = (q: string): void => {
    if (!ctx.isLive) {
      setThread((t) => [...t, { role: "user", text: q }, { role: "agent", text: reply(q) }]);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setThread((t) => [...t, { role: "user", text: q }, { role: "status", text: "Submitting this scope through the live room agent..." }]);
    const goal = [
      `Review the proposed mobile work plan for ${P.entity}.`,
      `User request: ${q}`,
      `Allowed reads: ${P.willRead.join(", ") || "none listed"}.`,
      `Proposed outputs: ${P.willCreate.join(", ") || "none listed"}.`,
      "Keep the run review-first, source-backed, and trace-linked. Do not write without the room policy's approval path.",
    ].join("\n");
    const request = ctx.requestRoomAgent?.(goal) ?? Promise.resolve({ ok: false, reason: "room_agent_unavailable" });
    void request.then((result) => {
      setSubmitting(false);
      setThread((t) => [...t, {
        role: "status",
        text: result.ok
          ? "Live request accepted. Follow its progress in Agent jobs and review any proposed write in Inbox."
          : `The live request was not accepted: ${result.reason ?? "try again"}`,
      }]);
    });
  };
  const send = () => {
    const q = draft.trim();
    if (!q) return;
    ask(q);
    setDraft("");
  };

  const chips: Array<{ label: string; icon: IconName; primary?: boolean; onClick: () => void }> =
    ctx.isLive
      ? [
          { label: "Run with NodeAgent", icon: "bolt", primary: true, onClick: () => ask("Run this plan as a governed room-agent job") },
          { label: "Edit scope", icon: "pen", onClick: () => ask("Edit scope") },
        ]
      : run === "plan"
      ? [
          { label: "Approve research", icon: "bolt", primary: true, onClick: ctx.approveResearch },
          { label: "Run read-only", icon: "eye", onClick: ctx.runReadOnly },
          { label: "Edit scope", icon: "pen", onClick: () => ask("Edit scope") },
        ]
      : run === "done"
        ? [{ label: "Review evidence", icon: "file", primary: true, onClick: () => ctx.openSheet("evidence") }]
        : [];

  return React.createElement(
    React.Fragment,
    null,
    <SheetHead title="Agent work plan" sub={"Chat · " + P.entity + " · read-only first"} ctx={ctx} />,
    React.createElement(
      "div",
      { className: "na-sheet-body" },
      React.createElement(
        "div",
        { className: "na-zchat" },
        React.createElement("div", { className: "na-zmsg user" }, "Research " + P.entity + " and propose a row + evidence — don’t write anything yet."),
        React.createElement(
          "div",
          { className: "na-zmsg agent" },
          React.createElement(
            "div",
            { className: "na-zhead" },
            React.createElement("span", { className: "av" }, Ico("sparkles")),
            "NodeAgent",
            React.createElement(
              "span",
              { className: "na-zstatus", "data-run": effectiveRun },
              ctx.isLive ? "live scope preview" : run === "plan" ? "ready for approval" : run === "running" ? "working…" : "read-only run complete",
            ),
          ),
          React.createElement(
            "p",
            { className: "na-ztext" },
            !ctx.isLive && run === "done"
              ? "Done — I stayed read-only and attached evidence. Review the diff before anything is written."
              : ctx.isLive
                ? "This preview is derived from the live room. Submitting it creates a governed room-agent job; completion is shown only by live jobs, proposals, and traces."
                : "Here’s the scope. I’ll only read these sources and propose changes as a diff — nothing is written until you approve.",
          ),
          React.createElement(
            "div",
            { className: "na-todos" },
            React.createElement("div", { className: "na-todos-head" }, Ico("check"), "Plan", React.createElement("span", { className: "c" }, doneN + " / " + scope.length)),
            scope.map((s, i) => React.createElement("div", { key: i, className: "na-todo", "data-st": s.st }, mark(s), React.createElement("span", { className: "tx" }, s.tx))),
          ),
          effectiveRun === "plan" &&
            React.createElement(
              "div",
              { className: "na-zstats" },
              P.stats.map((s, i) => React.createElement("span", { key: i, className: "na-zstat" + (s.mono ? " mono" : "") }, React.createElement("b", null, s.v), s.l)),
            ),
          React.createElement("div", { className: "na-guard" }, Ico("shield"), ctx.isLive
            ? "Submitting this preview uses the live room-agent policy and produces job, proposal, and trace receipts."
            : "Plan hash " + P.hash + " locks scope + cost before the job runs."),
        ),
        !ctx.isLive && run === "running" &&
          React.createElement(
            "div",
            { className: "na-zmsg agent" },
            React.createElement("div", { className: "na-skel" }, React.createElement("i", null), React.createElement("i", { className: "s" })),
          ),
        thread.map((m, i) =>
          m.role === "user"
            ? React.createElement("div", { key: i, className: "na-zmsg user" }, m.text)
            : React.createElement(
                "div",
                { key: i, className: "na-zmsg agent" },
                React.createElement("div", { className: "na-zhead" }, React.createElement("span", { className: "av" }, Ico(m.role === "status" ? "shield" : "sparkles")), m.role === "status" ? "NodeRoom" : "NodeAgent"),
                React.createElement("p", { className: "na-ztext" }, m.text),
              ),
        ),
      ),
    ),

    React.createElement(
      "div",
      { className: "na-sheet-foot" },
      chips.length
        ? React.createElement(
            "div",
            { className: "na-quickchips" },
            chips.map((c, i) => React.createElement("button", { key: i, className: "na-quickchip" + (c.primary ? " primary" : ""), onClick: c.onClick }, Ico(c.icon), c.label)),
          )
        : null,
      React.createElement(
        "div",
        { className: "na-zcompose" },
        React.createElement("span", { className: "mk" }, Ico("sparkles")),
        React.createElement("input", {
          className: "na-zinput",
          value: draft,
          type: "text",
          placeholder: submitting ? "Submitting to the live room agent..." : run === "running" ? "Working inside approved scope…" : "Adjust the plan or ask before approving…",
          disabled: submitting || (!ctx.isLive && run === "running"),
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          },
        }),
        React.createElement("button", { className: "na-zsend", disabled: !draft.trim() || submitting || (!ctx.isLive && run === "running"), onClick: send, "aria-label": "Send" }, Ico("arrowUp")),
      ),
    ),
  );
}

// ── EVIDENCE PREVIEW (private chat — sourced answer + follow-up) ──────────
type EvidenceCite = { kind: "cite"; n: string; text: string; host?: string; verified: boolean };
type EvidenceGap = { kind: "gap"; text: string };
type EvidenceFollowup = { match: string[]; text: string };

export function EvidenceSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const E = (ctx.liveEvidence ?? D.EVIDENCE) as D.Evidence & { followups?: EvidenceFollowup[]; fallback?: string };
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<Array<{ role: "user" | "agent" | "status"; text: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const cites = E.support.filter((s): s is EvidenceCite => s.kind === "cite") as EvidenceCite[];
  const gaps = E.support.filter((s): s is EvidenceGap => s.kind === "gap") as EvidenceGap[];
  const reply = (q: string): string => {
    const s = q.toLowerCase();
    const hit = (E.followups || []).find((f) => f.match.some((m) => s.includes(m)));
    return hit ? hit.text : (E.fallback as string);
  };
  const ask = (q: string): void => {
    if (!ctx.isLive) {
      setThread((t) => [...t, { role: "user", text: q }, { role: "agent", text: reply(q) }]);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setThread((t) => [...t, { role: "user", text: q }, { role: "status", text: "Submitting this evidence question through the live room agent..." }]);
    const goal = [
      `Answer a mobile evidence follow-up for this live claim: ${E.claim}.`,
      `Question: ${q}`,
      "Use only source artifacts and trace evidence already available to the room. State unresolved gaps and do not invent an answer.",
    ].join("\n");
    const request = ctx.requestRoomAgent?.(goal) ?? Promise.resolve({ ok: false, reason: "room_agent_unavailable" });
    void request.then((result) => {
      setSubmitting(false);
      setThread((t) => [...t, {
        role: "status",
        text: result.ok
          ? "Live request accepted. Read the answer in the Agent tab and use its trace receipt for verification."
          : `The live request was not accepted: ${result.reason ?? "try again"}`,
      }]);
    });
  };
  const send = () => {
    const q = draft.trim();
    if (!q) return;
    ask(q);
    setDraft("");
  };
  const quick = ctx.isLive ? [
    { label: "What supports this?", q: "What live room sources support this claim?" },
    { label: "What remains open?", q: "What evidence gaps remain unresolved?" },
    { label: "What source is needed?", q: "What primary source would close the largest gap?" },
  ] : [
    { label: "What’s the round size?", q: "round size" },
    { label: "Who’s the lead?", q: "lead investor" },
    { label: "How do I close the gap?", q: "close the gap" },
  ];
  return React.createElement(
    React.Fragment,
    null,
    <SheetHead title="Evidence" sub={"Chat · " + E.claim} ctx={ctx} />,
    React.createElement(
      "div",
      { className: "na-sheet-body" },
      React.createElement(
        "div",
        { className: "na-zchat" },
        // opening agent answer with sources
        React.createElement(
          "div",
          { className: "na-zmsg agent" },
          React.createElement(
            "div",
            { className: "na-zhead" },
            React.createElement("span", { className: "av" }, Ico("sparkles")),
            "NodeAgent",
            React.createElement("span", { className: "na-zstatus", "data-run": "plan" }, "needs_review"),
          ),
          React.createElement(
            "div",
            { className: "na-srclist", style: { marginTop: 0, marginBottom: 12 } },
            cites.map((s) =>
              React.createElement(
                "button",
                { key: s.n, className: "na-srcrow", onClick: () => (ctx as SheetHeadCtx).openSource && (ctx as SheetHeadCtx).openSource!(s) },
                React.createElement("span", { className: "n" }, s.n),
                React.createElement(
                  "span",
                  { className: "na-srctext" },
                  React.createElement("strong", null, s.text),
                  React.createElement("span", { className: "h" }, s.host),
                ),
                React.createElement("span", { className: "na-srcv", "data-v": s.verified }, Ico(s.verified ? "checkCircle" : "clock")),
                React.createElement("span", { className: "na-srcopen" }, Ico("extlink")),
              ),
            ),
          ),
          React.createElement(
            "p",
            { className: "na-ztext" },
            E.answer || `${cites.length} supporting source${cites.length === 1 ? "" : "s"} are attached to this claim.`,
          ),
          gaps.map((g, i) => React.createElement("div", { key: i, className: "na-srcgap", style: { marginTop: 10 } }, Ico("gap"), g.text)),
        ),
        thread.map((m, i) =>
          m.role === "user"
            ? React.createElement("div", { key: i, className: "na-zmsg user" }, m.text)
            : React.createElement(
                "div",
                { key: i, className: "na-zmsg agent" },
                React.createElement("div", { className: "na-zhead" }, React.createElement("span", { className: "av" }, Ico(m.role === "status" ? "shield" : "sparkles")), m.role === "status" ? "NodeRoom" : "NodeAgent"),
                React.createElement("p", { className: "na-ztext" }, m.text),
              ),
        ),
      ),
    ),

    React.createElement(
      "div",
      { className: "na-sheet-foot" },
      !thread.length &&
        React.createElement(
          "div",
          { className: "na-quickchips" },
          quick.map((q, i) => React.createElement("button", { key: i, className: "na-quickchip", onClick: () => ask(q.q) }, q.label)),
        ),
      React.createElement(
        "div",
        { className: "na-zcompose" },
        React.createElement("span", { className: "mk" }, Ico("sparkles")),
        React.createElement("input", {
          className: "na-zinput",
          value: draft,
          type: "text",
          placeholder: "Ask about this claim…",
          disabled: submitting,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          },
        }),
        React.createElement("button", { className: "na-zsend", disabled: !draft.trim() || submitting, onClick: send, "aria-label": "Send" }, Ico("arrowUp")),
      ),
    ),
  );
}

// ── COACH ──────────────────────────────────────────────────────────────────
type CoachTopic = {
  id: string;
  label?: string;
  gen?: boolean;
  question: string;
  howto: string[];
  feedback: { well: string; missed: string; cite: string; wording: string };
};

export function CoachSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const coach = (ctx.liveCoach ?? D.COACH) as unknown as { entity?: string; topics: CoachTopic[] };
  const sourceTopics = coach.topics.length
    ? coach.topics
    : ctx.isLive
      ? []
      : (D.COACH as unknown as { topics: CoachTopic[] }).topics;
  const [topics, setTopics] = useState<CoachTopic[]>(sourceTopics);
  const [topicIdx, setTopicIdx] = useState(0);
  const [newTopic, setNewTopic] = useState("");
  const C = topics[topicIdx];
  const [tab, setTab] = useState("howto");
  const [answer, setAnswer] = useState("");
  const [graded, setGraded] = useState(false);
  useEffect(() => {
    setTopics(sourceTopics);
    setTopicIdx(0);
    setTab("howto");
    setAnswer("");
    setGraded(false);
  }, [sourceTopics]);
  if (!C) {
    return (
      <>
        <SheetHead title="Coach" sub="Local practice" ctx={ctx} />
        <div className="na-sheet-body" data-testid="mobile-live-coach-empty">
          <div className="na-empty">
            <div className="eico">{Ico("coach")}</div>
            <strong>No live coaching topics</strong>
            <span>Add a source-backed finding before starting a local practice session.</span>
          </div>
        </div>
      </>
    );
  }
  const pickTopic = (i: number) => {
    setTopicIdx(i);
    setTab("howto");
    setAnswer("");
    setGraded(false);
  };
  const genTopic = () => {
    const label = newTopic.trim();
    if (!label) return;
    const topic: CoachTopic = {
      id: "gen_" + Date.now(),
      label,
      gen: true,
      question: "Explain " + label + " — state the claim, the evidence you have, what’s missing, and the action that closes the gap.",
      howto: [
        "Name the claim and its current status.",
        "Cite the strongest source you have.",
        "State the missing primary source precisely.",
        "Say what action would verify it.",
      ],
      feedback: {
        well: "You framed " + label + " as a claim with a clear status.",
        missed: "Tie it to a specific primary source, not a general reference.",
        cite: "Attach the document that would move " + label + " to verified.",
        wording: label + " is needs_review until a primary source is attached and the evidence check re-runs.",
      },
    };
    setTopics((t) => [...t, topic]);
    setTopicIdx(topics.length);
    setTab("howto");
    setAnswer("");
    setGraded(false);
    setNewTopic("");
    ctx.toast("Coaching on “" + label + "”");
  };

  function fbRow(icon: IconName, tone: Tone, title: string, body: string): React.ReactElement {
    return React.createElement(
      "div",
      { className: "na-card" },
      React.createElement(
        "div",
        { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
        React.createElement(
          "div",
          { style: { display: "flex", gap: 10, alignItems: "flex-start" } },
          React.createElement("span", { className: "ri", style: riStyle(tone) }, Ico(icon)),
          React.createElement(
            "div",
            { style: { minWidth: 0 } },
            React.createElement("div", { style: { fontSize: 12.5, fontWeight: 700, marginBottom: 3 } }, title),
            React.createElement("p", { className: "na-prose", style: { margin: 0, fontSize: 13 } }, body),
          ),
        ),
      ),
    );
  }

  return React.createElement(
    React.Fragment,
    null,
    <SheetHead title="Coach" sub={ctx.isLive ? `Local practice · ${coach.entity ?? "room evidence"}` : "Review readiness · CardioNova"} ctx={ctx} />,
    React.createElement(
      "div",
      { className: "na-sheet-body" },
      // topic switcher — pick or generate what to coach on
      React.createElement(
        "div",
        { className: "na-coach-topics" },
        topics.map((tp, i) =>
          React.createElement(
            "button",
            { key: tp.id, className: "na-coach-topic", "data-active": i === topicIdx, onClick: () => pickTopic(i) },
            Ico(tp.gen ? "sparkles" : "coach"),
            tp.label,
          ),
        ),
      ),
      React.createElement(
        "div",
        { className: "na-coach-gen" },
        React.createElement("span", { className: "mk" }, Ico("sparkles")),
        React.createElement("input", {
          className: "na-zinput",
          value: newTopic,
          type: "text",
          placeholder: "Coach me on something else…  e.g. “paid pilot revenue”",
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewTopic(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              genTopic();
            }
          },
        }),
        React.createElement("button", { className: "na-zsend", disabled: !newTopic.trim(), onClick: genTopic, "aria-label": "Generate topic" }, Ico("arrowUp")),
      ),

      React.createElement(
        "div",
        { className: "na-card", "data-accent-rule": "priv" },
        React.createElement(
          "div",
          { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
          React.createElement("p", { className: "na-prose", style: { margin: 0 } }, C.question),
        ),
      ),

      React.createElement(
        "div",
        { className: "na-tabs" },
        ([["howto", "How to answer"], ["answer", "Your answer"], ["feedback", "Feedback"]] as Array<[string, string]>).map(([id, lab]) =>
          React.createElement("button", { key: id, className: "na-tab", "data-active": tab === id, onClick: () => setTab(id) }, lab),
        ),
      ),

      tab === "howto" &&
        React.createElement(
          "div",
          { className: "na-card" },
          React.createElement(
            "div",
            { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
            C.howto.map((h, i) =>
              React.createElement(
                "div",
                { key: i, className: "na-row" },
                React.createElement(
                  "span",
                  { className: "ri", style: { fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--na-accent)", background: "var(--na-accent-bg)" } },
                  i + 1,
                ),
                React.createElement("span", { className: "rm" }, React.createElement("strong", { style: { whiteSpace: "normal" } }, h)),
                React.createElement("span", null),
              ),
            ),
          ),
        ),

      tab === "answer" &&
        React.createElement(
          React.Fragment,
          null,
          React.createElement("textarea", {
            className: "na-field",
            value: answer,
            placeholder: "Explain it in your own words…",
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setAnswer(e.target.value),
          }),
          React.createElement(
            "button",
            {
              className: "na-btn primary full",
              disabled: !answer.trim(),
              onClick: () => {
                setGraded(true);
                setTab("feedback");
              },
            },
            Ico("checkCircle"),
            "Get feedback",
          ),
        ),

      tab === "feedback" &&
        (graded
          ? React.createElement(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 8 } },
              fbRow("checkCircle", "ok", "What went well", C.feedback.well),
              fbRow("target", "warn", "What you missed", C.feedback.missed),
              fbRow("link", "accent", "Source to cite", C.feedback.cite),
              React.createElement(
                "div",
                { className: "na-card", "data-accent-rule": "priv" },
                React.createElement(
                  "div",
                  { className: "na-card-head accent" },
                  React.createElement("div", { className: "na-card-title" }, React.createElement("strong", null, "Suggested wording")),
                  React.createElement(Pill, { tone: "priv", icon: "quote" }, "model"),
                ),
                React.createElement(
                  "div",
                  { className: "na-card-body accent" },
                  React.createElement("p", { className: "na-prose", style: { margin: 0, fontStyle: "italic" } }, "“" + C.feedback.wording + "”"),
                ),
              ),
            )
          : React.createElement(
              "div",
              { className: "na-empty" },
              React.createElement("div", { className: "eico" }, Ico("coach")),
              React.createElement("strong", null, "Write an answer first"),
              React.createElement("span", null, "Feedback compares your answer to the evidence on file."),
            )),
    ),
  );
}

