/**
 * Server-only production NodeAgent tools.
 *
 * Keep `PRODUCTION_ROOM_TOOLS` in spreadsheet/cellMutator browser-safe: the app imports that module
 * for memory-mode demos. Convex/worker agent runners import this registry, which may include
 * server-only tools such as capture_source.
 */
import { PRODUCTION_ROOM_TOOLS } from "../spreadsheet/cellMutator";
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

export const SERVER_PRODUCTION_ROOM_TOOLS = [
  ...PRODUCTION_ROOM_TOOLS,
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
