/**
 * Deterministic planners for the scripted model — they drive the SAME tools the
 * real model would, so the demo/tests exercise the real runtime (context → tool
 * call → result → next decision), just with a fixed brain instead of an LLM.
 *
 * `recomputeVariancePlan` is the canonical agent behaviour. Two mechanisms,
 * deliberately separable via `lock`:
 *   - lock: true  → claim the range → read → edit → release. The LOCK prevents
 *                   others from racing you (their writes are blocked).
 *   - lock: false → read → edit (CAS only). No lock, so a concurrent write CAN
 *                   land between your read and your write; CAS then REJECTS your
 *                   stale write and the plan RE-READS + retries. This is what
 *                   proves "no silent clobber" when there's no lock to lean on.
 * If a lock is denied (someone else holds the range), the plan DRAFTS instead.
 */

import type { AgentMessage } from "./types";
import type { Planner, ScriptStep } from "../models/scripted";
import { lastVersions } from "../models/scripted";

type AnyResult = Record<string, unknown> | null;
const parse = (s: string): AnyResult => { try { return JSON.parse(s) as AnyResult; } catch { return null; } };

function lockIdFrom(msgs: AgentMessage[]): string {
  for (const m of msgs) if (m.role === "tool" && m.toolName === "propose_lock") { const r = parse(m.content); if (r && r.ok) return String(r.lockId); }
  return "";
}
function editTargetFor(msgs: AgentMessage[], toolCallId?: string): string | undefined {
  if (!toolCallId) return undefined;
  for (const m of msgs) if (m.role === "assistant" && m.toolCalls) {
    const c = m.toolCalls.find((tc) => tc.id === toolCallId && (tc.tool === "edit_cell" || tc.tool === "write_cell_result"));
    if (c) return String(c.args.elementId);
  }
  return undefined;
}
function committedCells(msgs: AgentMessage[]): Set<string> {
  const out = new Set<string>();
  for (const m of msgs) if (m.role === "tool" && (m.toolName === "edit_cell" || m.toolName === "write_cell_result")) {
    const r = parse(m.content);
    if (r && (r.ok || r.pendingApproval)) { const id = editTargetFor(msgs, m.toolCallId); if (id) out.add(id); }
  }
  return out;
}
function lastTool(msgs: AgentMessage[]): { name?: string; result: AnyResult; callId?: string } | null {
  for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (m.role === "tool") return { name: m.toolName, result: parse(m.content), callId: m.toolCallId }; }
  return null;
}
const isReleased = (msgs: AgentMessage[]) => msgs.some((m) => m.role === "tool" && m.toolName === "release_lock");
const hasDrafted = (msgs: AgentMessage[]) => msgs.some((m) => m.role === "tool" && m.toolName === "create_draft");
const hasPendingApprovals = (msgs: AgentMessage[]) => msgs.some((m) => {
  if (m.role !== "tool" || (m.toolName !== "edit_cell" && m.toolName !== "write_cell_result")) return false;
  const r = parse(m.content);
  return !!r?.pendingApproval;
});
const summarize = (t: Record<string, string>, verb = "Committed") => verb + " " + Object.entries(t).map(([id, val]) => `${id.replace("__variance", "")} ${val}`).join(", ") + ".";

/** Read-or-edit the next uncommitted cell, re-reading on a CAS conflict. null when all committed. */
function nextEditStep(msgs: AgentMessage[], ids: string[], targets: Record<string, string>, committed: Set<string>): ScriptStep | null {
  const cur = ids.find((id) => !committed.has(id));
  if (!cur) return null;
  const v = lastVersions(msgs);
  const lt = lastTool(msgs);
  const curConflicted = !!lt && lt.name === "edit_cell" && !!lt.result && lt.result.conflict === true && editTargetFor(msgs, lt.callId) === cur;
  if (curConflicted || v[cur] === undefined) return { toolCalls: [{ tool: "read_range", args: { elementIds: [cur] } }] };
  return { toolCalls: [{ tool: "edit_cell", args: { elementId: cur, value: targets[cur], baseVersion: v[cur] } }] };
}

/* ── company-research plan (ParselyFi loop): per pending company → lock → read+fetch → write
   summary/source/status=complete (CAS) → release. Drives the SAME tools the live LLM uses. ── */
function callArgsFor(msgs: AgentMessage[], callId: string | undefined, tool: string): Record<string, unknown> | undefined {
  if (!callId) return undefined;
  for (const m of msgs) if (m.role === "assistant" && m.toolCalls) { const c = m.toolCalls.find((tc) => tc.id === callId && tc.tool === tool); if (c) return c.args; }
  return undefined;
}
/** companies whose `${c}__status` was successfully set to "complete". */
function completedCompanies(msgs: AgentMessage[]): Set<string> {
  const out = new Set<string>();
  for (const m of msgs) if (m.role === "tool" && (m.toolName === "edit_cell" || m.toolName === "write_cell_result")) {
    const r = parse(m.content); if (!r || (!r.ok && !r.pendingApproval)) continue;
    const args = callArgsFor(msgs, m.toolCallId, m.toolName);
    if (args && String(args.elementId).endsWith("__status") && args.value === "complete") out.add(String(args.elementId).split("__")[0]);
  }
  return out;
}
/** lock proposed (ok) but not yet released — its id + the company (row) its range covers. */
function heldLock(msgs: AgentMessage[]): { lockId: string; company: string } | null {
  const released = new Set<string>();
  for (const m of msgs) if (m.role === "assistant" && m.toolCalls) for (const c of m.toolCalls) if (c.tool === "release_lock") released.add(String(c.args.lockId));
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "tool" && m.toolName === "propose_lock") {
      const r = parse(m.content);
      if (r && r.ok && !released.has(String(r.lockId))) {
        const args = callArgsFor(msgs, m.toolCallId, "propose_lock");
        const first = String((args?.elementIds as string[] | undefined)?.[0] ?? "");
        return { lockId: String(r.lockId), company: first.split("__")[0] };
      }
    }
  }
  return null;
}
function editedVersion(msgs: AgentMessage[], elementId: string): number | undefined {
  let version: number | undefined;
  for (const m of msgs) {
    if (m.role !== "tool" || (m.toolName !== "edit_cell" && m.toolName !== "write_cell_result")) continue;
    const r = parse(m.content);
    const args = callArgsFor(msgs, m.toolCallId, m.toolName);
    if (r?.ok && args?.elementId === elementId && typeof r.version === "number") version = Number(r.version);
  }
  return version;
}
function knownVersions(msgs: AgentMessage[]): Record<string, number> {
  const out = lastVersions(msgs);
  for (const m of msgs) {
    if (m.role !== "tool" || (m.toolName !== "edit_cell" && m.toolName !== "write_cell_result")) continue;
    const r = parse(m.content);
    const args = callArgsFor(msgs, m.toolCallId, m.toolName);
    if (r?.ok && args?.elementId && typeof r.version === "number") out[String(args.elementId)] = Number(r.version);
  }
  return out;
}
function cellWasSet(msgs: AgentMessage[], elementId: string, value: unknown): boolean {
  return msgs.some((m) => {
    if (m.role !== "tool" || (m.toolName !== "edit_cell" && m.toolName !== "write_cell_result")) return false;
    const r = parse(m.content);
    const args = callArgsFor(msgs, m.toolCallId, m.toolName);
    return !!(r?.ok || r?.pendingApproval) && args?.elementId === elementId && args.value === value;
  });
}
function fetchResultsFor(msgs: AgentMessage[], urls: string[]): { title: string; url: string }[] {
  const wanted = new Set(urls.filter(Boolean));
  const out: { title: string; url: string }[] = [];
  for (const m of msgs) {
    if (m.role !== "tool" || m.toolName !== "fetch_source") continue;
    const args = callArgsFor(msgs, m.toolCallId, "fetch_source");
    if (!wanted.has(String(args?.url ?? ""))) continue;
    const r = parse(m.content);
    if (r?.ok) out.push({ title: String(r.title), url: String(r.url) });
  }
  return out;
}

export type CompanyResearchTarget = {
  rowId: string;
  summary: string;
  sourceUrl: string;
  source2Url?: string;
  funding?: string;
  headcount?: string;
  recentSignal?: string;
  researchedAt?: string;
};

export function companyResearchPlan(companies: CompanyResearchTarget[]): Planner {
  const cellIds = (c: string) => [
    `${c}__status`, `${c}__summary`, `${c}__funding`, `${c}__headcount`, `${c}__recent_signal`,
    `${c}__source`, `${c}__source2`, `${c}__last_researched`,
  ];
  const targetFor = (c: string) => companies.find((x) => x.rowId === c);
  const urlsFor = (c: string) => {
    const t = targetFor(c);
    return [t?.sourceUrl ?? "", t?.source2Url ?? ""].filter(Boolean);
  };
  return ({ messages }) => {
    const held = heldLock(messages);
    if (held) {
      const c = held.company;
      const target = targetFor(c);
      if (!target) return { toolCalls: [{ tool: "release_lock", args: { lockId: held.lockId } }] };
      const v = knownVersions(messages);
      const ids = cellIds(c);
      const lt = lastTool(messages);
      const conflicted = (lt?.name === "edit_cell" || lt?.name === "write_cell_result") && !!lt.result && lt.result.conflict === true && String(editTargetFor(messages, lt.callId) ?? "").startsWith(`${c}__`);
      if (conflicted || ids.some((id) => v[id] === undefined)) return { toolCalls: [{ tool: "read_range", args: { elementIds: ids } }] };

      if (!cellWasSet(messages, `${c}__status`, "running")) {
        return {
          say: `${c}: fetching two sources and marking the row running.`,
          toolCalls: [
            { tool: "write_cell_result", args: { elementId: `${c}__status`, value: "running", baseVersion: v[`${c}__status`], status: "running", confidence: 1, evidence: [{ kind: "manual", label: `Agent started research for ${c}`, confidence: 1 }] } },
            ...urlsFor(c).map((url) => ({ tool: "fetch_source", args: { url } })),
          ],
        };
      }

      const fetched = fetchResultsFor(messages, urlsFor(c));
      const source = fetched[0] ? `${fetched[0].title} - ${fetched[0].url}` : target.sourceUrl;
      const source2 = fetched[1] ? `${fetched[1].title} - ${fetched[1].url}` : target.source2Url ?? "";
      const researchedAt = target.researchedAt ?? "2026-06-07";
      const fields: Array<[string, unknown]> = [
        [`${c}__summary`, target.summary],
        [`${c}__funding`, target.funding ?? "Funding signal captured from sourced research."],
        [`${c}__headcount`, target.headcount ?? "Headcount signal captured from sourced research."],
        [`${c}__recent_signal`, target.recentSignal ?? "Recent signal captured from sourced research."],
        [`${c}__source`, source],
        [`${c}__source2`, source2],
        [`${c}__last_researched`, researchedAt],
        [`${c}__status`, "complete"],
      ];
      const evidence = fetched.length
        ? fetched.map((f, idx) => ({ kind: "source", label: f.title, url: f.url, source: f.url, confidence: idx === 0 ? 0.92 : 0.86 }))
        : urlsFor(c).map((url) => ({ kind: "source", label: url, url, source: url, confidence: 0.55 }));
      const calls = fields
        .filter(([id, value]) => !cellWasSet(messages, id, value))
        .map(([id, value]) => ({ tool: "write_cell_result", args: { elementId: id, value, baseVersion: v[id] ?? editedVersion(messages, id) ?? 0, status: "complete", confidence: id.endsWith("__source") || id.endsWith("__source2") ? 1 : 0.88, evidence } }));
      if (calls.length) return { say: `${c}: writing structured fields from ${fetched.length || urlsFor(c).length} source(s).`, toolCalls: calls };
      return { toolCalls: [{ tool: "release_lock", args: { lockId: held.lockId } }] };
    }

    const done = completedCompanies(messages);
    const cur = companies.find((c) => !done.has(c.rowId));
    if (!cur) return { say: `Researched ${companies.length} ${companies.length === 1 ? "company" : "companies"} with structured fields, two sources, and freshness timestamps.`, done: true };
    return { say: `Researching ${cur.rowId} - claiming its row.`, toolCalls: [{ tool: "propose_lock", args: { elementIds: cellIds(cur.rowId), reason: `research ${cur.rowId}` } }] };
  };
}

/** Scripted notebook parse: read the notebook's blocks, then persist a
 *  structured report through the governed outline lane. Includes one
 *  UNEVIDENCED claim on purpose so the demo shows the honesty gate (the
 *  bullet lands flagged needs_review, never silently complete). */
export function notebookOutlinePlan(artifactId: string): Planner {
  return ({ step }) => {
    if (step === 0) {
      return {
        say: "Reading the notebook blocks first, so the report anchors to what members actually wrote.",
        toolCalls: [{ tool: "read_notebook", args: { artifactId } }],
      };
    }
    if (step === 1) {
      return {
        say: "Structuring the notes into a report under the agent section — evidence-tagged where I have a source, flagged needs_review where I don't.",
        toolCalls: [{
          tool: "append_notebook_outline",
          args: {
            artifactId,
            title: "Report: Notebook summary",
            mode: "merge",
            sections: [
              {
                title: "Decisions",
                bullets: [
                  { text: "Proceed to partner review once runway is verified", claim: true, evidence: [{ kind: "manual", label: "stated in captured notes" }] },
                ],
              },
              {
                title: "Risks",
                bullets: [
                  // Deliberately unevidenced: demonstrates the needs_review downgrade.
                  { text: "Founder-quoted runway of 14 months is unverified", claim: true },
                ],
              },
              { title: "Follow-ups", bullets: ["Request the bank statement backing the cash position", "Confirm the Series B lead before the partner meeting"] },
            ],
          },
        }],
      };
    }
    return { say: "Report written under “Agent notes” — evidence-tagged bullets are clean, the unverified runway claim is flagged needs_review for a human check.", done: true };
  };
}

export function recomputeVariancePlan(targets: Record<string, string>, opts: { reason?: string; lock?: boolean } = {}): Planner {
  const useLock = opts.lock !== false;
  const ids = Object.keys(targets);
  return ({ messages }) => {
    if (isReleased(messages)) return { say: hasPendingApprovals(messages) ? summarize(targets, "Proposed") + " Waiting for host approval." : summarize(targets) + " Lock released.", done: true };
    if (hasDrafted(messages)) return { say: "Drafted — it will smart-merge when the lock releases.", done: true };
    const committed = committedCells(messages);

    // no-lock path: pure CAS (read → edit → retry on conflict)
    if (!useLock) {
      const step = nextEditStep(messages, ids, targets, committed);
      return step ?? { say: summarize(targets) + " (CAS, no lock held.)", done: true };
    }

    // lock path: claim → edit → release (or draft if the range is already held)
    const lockId = lockIdFrom(messages);
    if (!lockId) {
      const lt = lastTool(messages);
      if (lt?.name === "propose_lock" && lt.result && lt.result.ok === false) {
        const v = lastVersions(messages);
        if (!ids.every((id) => v[id] !== undefined)) return { toolCalls: [{ tool: "read_range", args: { elementIds: ids } }] };
        const blockedByLockId = String((lt.result as { lockId?: string }).lockId ?? "");
        return {
          say: "That range is locked — I'll draft my changes to merge when it frees.",
          toolCalls: [{ tool: "create_draft", args: { ops: ids.map((id) => ({ elementId: id, value: targets[id], baseVersion: v[id] })), blockedByLockId, note: summarize(targets) } }],
        };
      }
      return { say: "On it — claiming the cells I need.", toolCalls: [{ tool: "propose_lock", args: { elementIds: ids, reason: opts.reason ?? "recompute variance" } }] };
    }
    const step = nextEditStep(messages, ids, targets, committed);
    if (!step) return { say: summarize(targets), toolCalls: [{ tool: "release_lock", args: { lockId } }] };
    return step;
  };
}
