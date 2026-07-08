import type { DataframeColumn } from "../engine/types";

export const HACKWITHBAY_ROOM_TITLE = "HackwithBay 3.0 - BTB Graph Agent";

export const HACKWITHBAY_REQUIRED_TECH = [
  "Butterbase",
  "Neo4j Aura",
  "RocketRide Cloud",
  "Nebius AI Studio",
  "Daytona",
  "Cognee OSS",
  "Opsera",
] as const;

export const HACKWITHBAY_BRIEF_NOTE = `
<h1>HackwithBay 3.0 demo map</h1>
<p><b>Demo claim:</b> NodeRoom can turn a BankerToolBench task into a graph-aware agent workflow: upload the task bundle, ingest it into memory, run the agent, execute code in a sandbox, and present source-backed artifacts, traces, and graph relationships in the room UI.</p>
<p><b>Core product loop:</b> user uploads a BTB task bundle in chat -> RocketRide Cloud runs ingestion and graph-sync pipeline -> Butterbase stores users, projects, file metadata, payment state, and model gateway configuration -> Neo4j stores the property graph -> Cognee stores long-term AI memory over the same evidence -> Nebius hosts the NodeAgent model route -> Daytona executes generated code and tests -> NodeRoom shows chat, artifacts, trace, and graph.</p>
<p><b>BTB task focus:</b> start from <code>btb-067cb834</code>, the existing NodeRoom BankerToolBench evidence lane. Keep the demo explicitly synthetic and evaluation-only; do not frame outputs as real financial, legal, lending, or investment advice.</p>
<p><b>Opsera stance:</b> use only if setup is fast enough. The strongest role is DevOps evidence: CI/CD run, deployment approval, release status, and post-demo compliance receipts. If it blocks, keep it as an optional observability lane and do not let it slow the mandatory Butterbase, Neo4j, and RocketRide integrations.</p>
`;

export const HACKWITHBAY_GRAPH_COLUMNS: DataframeColumn[] = [
  { id: "entity", label: "Entity", order: 0, type: "text" },
  { id: "category", label: "Category", order: 1, type: "text" },
  { id: "role", label: "Role", order: 2, type: "text" },
  { id: "owner", label: "Owner", order: 3, type: "text" },
  { id: "source", label: "Source", order: 4, type: "text" },
  { id: "demo", label: "Demo moment", order: 5, type: "text" },
  { id: "facts", label: "Key facts", order: 6, type: "text" },
];

export const HACKWITHBAY_GRAPH_ROWS = [
  {
    id: "noderoom",
    entity: "NodeRoom BTB graph agent",
    category: "Project",
    role: "Room UI for upload, chat, artifacts, trace, and graph presentation",
    owner: "Homen",
    source: "#/hackwithbay",
    demo: "Open the hackathon room and run the banker task from the public chat lane",
    facts: "Reuses RoomShell, Chat upload, TraceSurface, KnowledgeGraph, and BTB seed evidence.",
  },
  {
    id: "btb-task",
    entity: "BankerToolBench task btb-067cb834",
    category: "Project",
    role: "Synthetic benchmark task package and evaluation target",
    owner: "Room NodeAgent",
    source: "#/btb",
    demo: "Run a known BTB task through the same room UX used for normal analyst work",
    facts: "Existing seed includes task note, run matrix, artifacts, receipts, trace events, and live ledger panel.",
  },
  {
    id: "upload-ingest",
    entity: "Upload and ingest lane",
    category: "Tool",
    role: "Accept task files, parse office/PDF/source bundles, and attach artifacts to the agent prompt",
    owner: "Room NodeAgent",
    source: "src/ui/Chat.tsx",
    demo: "Drop a BTB bundle in chat and watch it become room artifacts before the agent runs",
    facts: "Chat upload calls parseUploadedFiles and store.uploadArtifact with room/private visibility.",
  },
  {
    id: "butterbase",
    entity: "Butterbase",
    category: "Tool",
    role: "Backend for auth, project database, storage metadata, payment gate, and AI gateway settings",
    owner: "Backend lead",
    source: "https://dashboard.butterbase.ai",
    demo: "Persist user session, project, uploaded file records, and active payment status",
    facts: "Mandatory integration. It must be load-bearing, not just a logo on the architecture slide.",
  },
  {
    id: "neo4j",
    entity: "Neo4j Aura",
    category: "Tool",
    role: "Property graph for BTB task, source, claim, artifact, receipt, tool run, and agent step relationships",
    owner: "Graph lead",
    source: "https://console.neo4j.io",
    demo: "Run Cypher over source-to-claim-to-artifact paths and show the same relationships in NodeRoom",
    facts: "Mandatory graph database. Agent must traverse it through Cypher or relationship retrieval.",
  },
  {
    id: "rocketride",
    entity: "RocketRide Cloud",
    category: "Tool",
    role: "Managed pipeline endpoint for task ingestion, graph sync, and memory refresh",
    owner: "Pipeline lead",
    source: "https://cloud.rocketride.ai",
    demo: "NodeRoom calls a deployed RocketRide workflow after upload, then receives graph and memory receipts",
    facts: "Mandatory deployment. Local-only pipeline does not satisfy the hackathon requirement.",
  },
  {
    id: "cognee",
    entity: "Cognee OSS",
    category: "Tool",
    role: "AI memory over BTB traces, source chunks, claims, citations, and decisions",
    owner: "Memory lead",
    source: "https://github.com/topoteretes/cognee",
    demo: "Recall prior BTB evidence patterns and render Cognee/Neo4j relationships in the Graph tab",
    facts: "Optional bonus. Use Cognee with Neo4j so memory and graph story share the same backbone.",
  },
  {
    id: "nebius",
    entity: "Nebius AI Studio",
    category: "Tool",
    role: "Hosted model route for the public NodeAgent chat",
    owner: "Agent lead",
    source: "https://tokenfactory.nebius.com/settings/api-keys",
    demo: "Select a nebius/* model in the chat composer and run the BTB task through that policy",
    facts: "NodeRoom already exposes Nebius in model selection and modelCatalog has nebius model ids.",
  },
  {
    id: "daytona",
    entity: "Daytona",
    category: "Tool",
    role: "Sandbox for generated code, formula checks, file transformation, and smoke tests",
    owner: "Sandbox lead",
    source: "https://app.daytona.io",
    demo: "Agent writes code, runs it in a Daytona sandbox, and returns stdout plus artifact diffs as room evidence",
    facts: "Optional bonus. It is strongest when visibly executing code, not just claiming a sandbox exists.",
  },
  {
    id: "opsera",
    entity: "Opsera",
    category: "Tool",
    role: "Optional DevOps evidence lane for CI/CD status, deployment gates, and approval receipts",
    owner: "Release lead",
    source: "https://portal.opsera.io/signup",
    demo: "Show release workflow status or deployment approval if the account setup is quick",
    facts: "Not in the mandatory problem statement. Keep it optional unless mentors confirm a scoring angle.",
  },
  {
    id: "graph-display",
    entity: "Cognee plus Neo4j graph display",
    category: "Project",
    role: "Present memory graph nodes in the NodeRoom Graph tab or an embedded Cognee graph UI",
    owner: "Graph lead",
    source: "src/ui/panels/KnowledgeGraph.tsx",
    demo: "Switch from artifacts to relationship view: task -> sources -> claims -> artifacts -> receipts -> tools",
    facts: "Existing KnowledgeGraph derives a node-link graph from sheet artifacts. Cognee can feed the same node/link shape later.",
  },
  {
    id: "code-exec",
    entity: "Daytona code execution receipt",
    category: "Project",
    role: "Show code, command, stdout, files changed, and pass/fail result as a room artifact",
    owner: "Sandbox lead",
    source: "scripts/agent-workspace-sandbox-smoke.ts",
    demo: "Run a tiny valuation/check script in sandbox and attach the execution transcript",
    facts: "Noderoom already has local agent workspace sandbox smoke coverage; Daytona replaces the local sandbox in the demo.",
  },
];

export const HACKWITHBAY_CHECKLIST_COLUMNS: DataframeColumn[] = [
  { id: "service", label: "Service", order: 0, type: "text" },
  { id: "category", label: "Category", order: 1, type: "text" },
  { id: "setup", label: "Setup target", order: 2, type: "text" },
  { id: "secret", label: "Secret needed", order: 3, type: "text" },
  { id: "proof", label: "Demo proof", order: 4, type: "text" },
];

export const HACKWITHBAY_CHECKLIST_ROWS = [
  { id: "butterbase", service: "Butterbase", category: "Tool", setup: "Create project, redeem ENJOY0707 in billing, enable auth/database/storage/payment", secret: "project URL, anon/server key if provided", proof: "Stored project/user/upload/payment rows" },
  { id: "neo4j", service: "Neo4j Aura", category: "Tool", setup: "Create Aura free instance and copy Bolt URI plus username/password", secret: "NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD", proof: "Cypher returns BTB graph paths" },
  { id: "rocketride", service: "RocketRide Cloud", category: "Tool", setup: "Create cloud account and deploy ingestion/graph-sync workflow", secret: "ROCKETRIDE_API_KEY, workflow endpoint", proof: "Managed endpoint returns pipeline receipt" },
  { id: "nebius", service: "Nebius AI Studio", category: "Tool", setup: "Create API key in Token Factory settings", secret: "NEBIUS_API_KEY", proof: "NodeAgent run shows nebius model policy" },
  { id: "daytona", service: "Daytona", category: "Tool", setup: "Create account and API key for sandbox creation", secret: "DAYTONA_API_KEY", proof: "Sandbox transcript with code, stdout, and files changed" },
  { id: "cognee", service: "Cognee OSS", category: "Tool", setup: "Install OSS Cognee and configure Neo4j backend", secret: "Cognee env plus Neo4j credentials", proof: "Memory recall links prior BTB evidence to current task" },
  { id: "opsera", service: "Opsera", category: "Tool", setup: "Create account only if useful for release/CI evidence", secret: "Opsera token if available", proof: "Optional CI/CD or deployment approval receipt" },
];

export function hackwithBaySeed(rows: Array<Record<string, string>>, columns: DataframeColumn[]): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (const row of rows) {
    for (const column of columns) seed.push({ id: `${row.id}__${column.id}`, value: row[column.id] ?? "" });
  }
  return seed;
}
