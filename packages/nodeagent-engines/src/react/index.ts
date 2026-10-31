/**
 * Shared, chat-native workspace UI for a Node agent worker. Mount
 * <NodeAgentWorkspace apiBase=".../agent-api" /> and import "./styles.css"
 * (published as "@homenshum/nodeagent-engines/react/styles.css").
 */
export { NodeAgentWorkspace, type NodeAgentWorkspaceProps } from "./NodeAgentWorkspace.js";
export { useWorkerHealth, useRunEvents, type WorkerHealthState, type RunEventsState, type StreamState } from "./hooks.js";
export { createWorkerClient, WorkerError, type WorkerClient, type TemplateSummary } from "./client.js";
export {
  reduceRunEvents,
  emptyRunView,
  buildHelperTree,
  summarizeGroup,
  groupSummaryText,
  independentChecks,
  skillStages,
  formatTokens,
  VIEW_LIMITS,
  type RunView,
  type TimelineEntry,
  type ActivityItem,
  type HelperView,
  type HelperNode,
  type ArtifactView,
} from "./eventReducer.js";
export { Markdown } from "./components/Markdown.js";
