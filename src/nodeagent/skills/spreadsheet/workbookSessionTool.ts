import { z } from "zod";
import type { AgentTool, WorkbookSessionRequest } from "../../core/types";
import { validateWorkbookSessionRequest } from "./workbookSessionContract";

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const workbookSessionTool: AgentTool = {
  name: "workbook_session",
  description: "Use the job's single governed workbook patch session. read returns at most 256 A1 cells; stage persists at most 64 scalar or supported-formula edits using session revision CAS; preview shows current staged values; publish rechecks cell versions, acquires a managed lock, and routes every edit through normal room approval; discard removes pending edits. This is not a code REPL and has no SQL, filesystem, package, database, or network access.",
  schema: z.object({
    action: z.enum(["read", "stage", "preview", "publish", "discard"]),
    commandId: z.string().min(1).max(96).describe("stable idempotency key for this command"),
    expectedRevision: z.coerce.number().int().min(0).optional().describe("required for stage, publish, and discard; obtain it from preview"),
    range: z.object({
      start: z.string().describe("first A1 coordinate"),
      end: z.string().describe("last A1 coordinate; use the same value for one cell"),
    }).optional(),
    operations: z.array(z.object({
      elementId: z.string().describe("A1 coordinate in the job's workbook"),
      value: scalarSchema.describe("string, finite number, boolean, null, or supported formula string beginning with ="),
    })).max(64).optional(),
    reason: z.string().max(240).optional(),
  }),
  execute: async (raw: WorkbookSessionRequest, rt) => {
    let request: WorkbookSessionRequest;
    try {
      request = validateWorkbookSessionRequest(raw);
    } catch (error) {
      return {
        ok: false,
        action: raw.action,
        revision: Number.isInteger(raw.expectedRevision) ? raw.expectedRevision! : 0,
        reason: error instanceof Error ? error.message : "invalid_workbook_session_request",
      };
    }
    if (!rt.workbookSession) {
      return { ok: false, action: request.action, revision: request.expectedRevision ?? 0, reason: "workbook_session_unavailable" };
    }
    return rt.workbookSession(request);
  },
};
