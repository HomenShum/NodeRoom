// #workspace — the shared Node agent workspace, mounted in NodeRoom's dark theme.
// Talks only to the Node agent worker through the Vite proxy (/agent-api ->
// worker /api). No room store, no memory engine, no Convex on this route.
import { NodeAgentWorkspace } from "../../../packages/nodeagent-engines/src/react/index.js";
import "../../../packages/nodeagent-engines/src/react/styles.css";
import "./agentWorkspace.css";

export function AgentWorkspaceRoute() {
  return (
    <div className="nr-agent-workspace" data-theme="dark">
      <NodeAgentWorkspace
        apiBase="/agent-api"
        title="NodeRoom Agent Workspace"
        brand={
          <a className="nr-aw-brand" href="#" aria-label="NodeRoom home">
            <span className="r-mark" aria-hidden="true">N</span>
            <span>NodeRoom</span>
          </a>
        }
      />
    </div>
  );
}
