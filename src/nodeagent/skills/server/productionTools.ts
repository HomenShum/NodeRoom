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

export const SERVER_PRODUCTION_ROOM_TOOLS = [
  ...PRODUCTION_ROOM_TOOLS,
  captureSourceFirecrawlTool,
  secFactsTool,
];

export const SERVER_PRODUCTION_TOOL_NAMES = SERVER_PRODUCTION_ROOM_TOOLS.map((tool) => tool.name);
