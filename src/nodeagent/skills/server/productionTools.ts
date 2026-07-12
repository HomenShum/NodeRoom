/**
 * Server-only production NodeAgent tools.
 *
 * Keep `PRODUCTION_ROOM_TOOLS` in spreadsheet/cellMutator browser-safe: the app imports that module
 * for memory-mode demos. Convex/worker agent runners import this registry, which may include
 * server-only tools such as capture_source.
 */
import { PRODUCTION_ROOM_TOOLS } from "../spreadsheet/cellMutator";
import { workbookSessionTool } from "../spreadsheet/workbookSessionTool";
import { captureSourceFirecrawlTool } from "../search/captureSourceFirecrawlTool";
import { secFactsTool } from "../search/secFactsTool";
import { citeInFileTool } from "../search/citeInFileTool";
import { createBtbDeliverablePackageTool } from "../bankerCoach/btbPackageTool";
import { apifyFounderProfileTool } from "../search/apifyFounderProfileTool";
import { githubProfileTool } from "../search/githubProfileTool";
import { youComSearchTool } from "../search/youComSearchTool";
import { youComResearchTool } from "../search/youComResearchTool";
import { youComFinanceResearchTool } from "../search/youComFinanceResearchTool";
import { tavilySearchTool } from "../search/tavilySearchTool";
import { SKILL_SEARCH_TOOLS, LOAD_SKILL_TOOLS } from "../../tools";
import { PLAN_AND_DISPATCH_TOOL } from "../../core/subagentDispatcher";
import { launchAdmissionModeFromEnv } from "../../../launch/budgetPolicy";

export const SERVER_PRODUCTION_ROOM_TOOLS = [
  ...PRODUCTION_ROOM_TOOLS,
  workbookSessionTool,
  captureSourceFirecrawlTool,
  secFactsTool,
  citeInFileTool,
  createBtbDeliverablePackageTool,
  apifyFounderProfileTool,
  githubProfileTool,
  youComSearchTool,
  youComResearchTool,
  youComFinanceResearchTool,
  tavilySearchTool,
  // Skill RAG (server-only: local fs read + SSRF-guarded fetch). Discover skills, load one on demand.
  ...SKILL_SEARCH_TOOLS,
  ...LOAD_SKILL_TOOLS,
  // Dynamic subagent dispatch (runtime-native: intercepted by runtime.ts, not executed normally)
  PLAN_AND_DISPATCH_TOOL,
];

export const SERVER_PRODUCTION_TOOL_NAMES = SERVER_PRODUCTION_ROOM_TOOLS.map((tool) => tool.name);

/** These tools can create provider charges that are not yet included in the parent run's durable
 * settlement. They remain available in development/benchmark, but launch postures fail closed by
 * omitting them until aggregate per-attempt/tool metering is implemented and certified. */
export const LAUNCH_UNMETERED_PROVIDER_TOOL_NAMES = new Set([
  "capture_source",
  "founder_profile",
  "you_search",
  "you_research",
  "you_finance_research",
  "tavily_search",
  "okf_semantic_search",
  "plan_and_dispatch",
]);

export function serverProductionRoomToolsForEnv(env: Record<string, string | undefined>) {
  const mode = launchAdmissionModeFromEnv(env);
  if (mode !== "private_pilot" && mode !== "public_launch") return SERVER_PRODUCTION_ROOM_TOOLS;
  return SERVER_PRODUCTION_ROOM_TOOLS.filter((tool) => !LAUNCH_UNMETERED_PROVIDER_TOOL_NAMES.has(tool.name));
}
