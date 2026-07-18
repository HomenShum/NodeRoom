/**
 * Agent-native UI contract — the AUTHORED source of truth for how an agent drives
 * NodeRoom without vision or source access.
 *
 * This is deliberately different from the two things that already exist:
 *  - `proofloop ui contract` (detectUiContracts) INFERS a flat element list by regex-
 *    scraping source for data-testid and guessing actions from id naming. Inference,
 *    not contract: nothing breaks when the rendered app drifts.
 *  - docs/design/UI_CONTRACT.md governs human visual taste, not machine drivability.
 *
 * This module is versioned, curated, and ENFORCED:
 *  - `npm run ui:contract:check` fails when the emitted public/.well-known/agent-ui.json
 *    is stale relative to this file (same pattern as codegen checks).
 *  - `e2e/ui-contract-drift.spec.ts` EXECUTES the contract against the rendered app:
 *    every element must resolve in its declared context, journeys must complete from
 *    the contract's own steps, and each invariant names the spec that guards it.
 *
 * Rules for editing:
 *  - Add an element only with a stable data-testid that already ships (the drift spec
 *    will fail otherwise — that is the point).
 *  - `availableIn` names the contexts the drift verifier can reach headlessly in
 *    memory mode. Live-auth-only elements belong in `elementsLiveOnly` (documented,
 *    not machine-verified locally — verified by the deployed-auth e2e lane).
 *  - Never describe a capability the runtime lacks (capability-honest labeling).
 */

export const UI_CONTRACT_VERSION = "1.0.0";
export const UI_CONTRACT_SCHEMA = "noderoom/agent-ui-contract@1";

export type UiContext = "landing" | "room" | "room.paletteOpen" | "mobile";

export type UiContractElement = {
  id: string;
  selector: string;
  surface: string;
  availableIn: UiContext[];
  actions: Array<"click" | "fillText" | "keyboard" | "observe">;
  assertions: Array<"visible" | "focusable" | "count>0">;
  description: string;
};

export type UiContractState = {
  id: string;
  description: string;
  enter: Array<{ do: "click" | "press" | "goto"; target: string }>;
  exit?: Array<{ do: "click" | "press"; target: string }>;
};

export type UiContractInvariant = {
  id: string;
  description: string;
  verifiedBy: string;
};

export type UiContractJourney = {
  id: string;
  description: string;
  startContext: UiContext;
  endContext: UiContext;
  steps: Array<{ do: "click" | "press" | "goto" | "expectVisible"; target: string }>;
};

export const uiContract = {
  schema: UI_CONTRACT_SCHEMA,
  contractVersion: UI_CONTRACT_VERSION,
  generatedFrom: "src/design/uiContract.ts",
  app: {
    name: "NodeRoom",
    prodUrl: "https://noderoom.live",
    memoryMode: "/?mode=memory&surface=desktop",
    mobileSurface: "/#mobile?mode=memory",
    notes: [
      "Without VITE_CONVEX_URL the app runs a keyless deterministic memory engine; the landing shows start-demo-room instead of create-room.",
      "Viewports <=760px auto-rewrite to #mobile (a distinct surface); pass ?surface=desktop to opt out.",
      "Desktop shell is dark-first via data-theme on <html>; mobile themes itself.",
    ],
  },
  surfaces: [
    { id: "shell.topbar", selector: '[data-noderoom-surface="shell.topbar"]', description: "Room top bar: brand, invite chip, presence, settings." },
    { id: "shell.statusStrip", selector: '[data-noderoom-surface="shell.statusStrip"]', description: "Bottom status strip: latest agent outcome, versions." },
    { id: "shell.notifications", selector: '[data-noderoom-surface="shell.notifications"]', description: "Notifications inbox." },
    { id: "workSurface.sheet", selector: '[data-noderoom-surface="workSurface.sheet"]', description: "Spreadsheet work surface." },
    { id: "workSurface.trace", selector: '[data-noderoom-surface="workSurface.trace"]', description: "Trace / provenance work surface." },
    { id: "workSurface.notebook", selector: '[data-noderoom-surface="workSurface.notebook"]', description: "Notebook work surface." },
  ],
  states: [
    {
      id: "room.paletteOpen",
      description: "Command palette modal open; background is aria-hidden (see invariant modal-aria-hiding).",
      enter: [{ do: "press", target: "Control+K" }],
      exit: [{ do: "press", target: "Escape" }],
    },
  ] satisfies UiContractState[],
  elements: [
    // landing (memory mode)
    { id: "start-demo-room", selector: '[data-testid="start-demo-room"]', surface: "landing", availableIn: ["landing"], actions: ["click"], assertions: ["visible"], description: "Enter the deterministic demo room (memory mode primary CTA)." },
    { id: "join-room-code", selector: '[data-testid="join-room-code"]', surface: "landing", availableIn: ["landing"], actions: ["fillText"], assertions: ["visible"], description: "Room code entry field." },
    // room shell
    { id: "artifact-tabs", selector: '[data-testid="artifact-tabs"]', surface: "shell.topbar", availableIn: ["room"], actions: ["observe"], assertions: ["visible"], description: "Work-surface tab strip (Home, sheets, notes, Trace, Graph)." },
    { id: "people-trigger", selector: '[data-testid="people-trigger"]', surface: "shell.topbar", availableIn: ["room"], actions: ["click"], assertions: ["visible"], description: "Opens the People panel (presence + follow)." },
    { id: "room-settings-btn", selector: '[data-testid="room-settings-btn"]', surface: "shell.topbar", availableIn: ["room"], actions: ["click"], assertions: ["visible"], description: "Room controls (host: auto-allow vs review)." },
    { id: "status-strip", selector: '[data-testid="status-strip"]', surface: "shell.statusStrip", availableIn: ["room"], actions: ["observe"], assertions: ["visible"], description: "Latest agent outcome with version chip; click-through opens the referenced artifact." },
    { id: "walkthrough-dock", selector: '[data-testid="walkthrough-dock"]', surface: "shell.topbar", availableIn: ["room"], actions: ["observe"], assertions: ["count>0"], description: "Dismissable guided-walkthrough strip." },
    { id: "chat-feed", selector: '[data-testid="chat-feed"]', surface: "shell.topbar", availableIn: ["room"], actions: ["observe"], assertions: ["visible"], description: "Room chat log (role=log; implicitly live — no aria-live attribute, see modal-aria-hiding)." },
    { id: "trace-tab", selector: '[data-testid="trace-tab"]', surface: "workSurface.trace", availableIn: ["room"], actions: ["click"], assertions: ["count>0"], description: "Opens the trace/provenance work surface (ground truth for agent runs)." },
    // palette state
    { id: "command-palette", selector: '[data-testid="command-palette"]', surface: "shell.topbar", availableIn: ["room.paletteOpen"], actions: ["observe"], assertions: ["visible"], description: "Command palette dialog (Radix, portaled to body)." },
    { id: "command-palette-input", selector: '[data-testid="command-palette-input"]', surface: "shell.topbar", availableIn: ["room.paletteOpen"], actions: ["fillText", "keyboard"], assertions: ["visible", "focusable"], description: "Palette combobox; Ctrl+K toggles, Escape dismisses and restores focus." },
    // mobile surface
    { id: "mobile-header", selector: '[data-testid="mobile-header"]', surface: "mobile", availableIn: ["mobile"], actions: ["observe"], assertions: ["visible"], description: "Mobile terracotta header (44x44 targets)." },
    { id: "mobile-bottom-nav", selector: '[data-testid="mobile-bottom-nav"]', surface: "mobile", availableIn: ["mobile"], actions: ["click"], assertions: ["visible"], description: "Persistent primary mobile navigation (Home/Capture/Room/Agent/Review/Files)." },
  ] satisfies UiContractElement[],
  elementsLiveOnly: [
    { id: "create-room", selector: '[data-testid="create-room"]', description: "Live-mode primary CTA (sign-in gated). Verified by the deployed-auth e2e lane, not locally." },
    { id: "notifications-bell", selector: '[data-testid="notifications-bell"]', description: "Notifications trigger; mounts only in convex (live) mode — RoomShell gates NotificationsInbox on store.mode." },
    { id: "people-panel", selector: '[data-testid="people-panel"]', description: "People panel content; opens from people-trigger." },
    { id: "notifications-inbox", selector: '[data-testid="notifications-inbox"]', description: "Notifications inbox panel; opens from notifications-bell." },
  ],
  invariants: [
    { id: "modal-aria-hiding", description: "With any shared-primitive modal open, background content is aria-hidden; the only [aria-live] exemption inside #root is an empty announcement leaf.", verifiedBy: "e2e/modal-aria-hiding.spec.ts" },
    { id: "no-horizontal-overflow", description: "No horizontal document overflow at 375/768/1512 widths on landing, room, and mobile surfaces.", verifiedBy: "agentic-ui-qa pixels.cjs hOverflow + e2e expectNoHorizontalOverflow helpers" },
    { id: "escape-dismisses-restores", description: "Escape closes the palette and focus returns to the invoking element.", verifiedBy: "tests/commandPalette.test.tsx + e2e/modal-aria-hiding.spec.ts" },
    { id: "green-is-success-only", description: "Success ink is reserved for success semantics; informational copy uses neutral inks.", verifiedBy: "design:audit wrong-semantics checks (advisory) + taste review" },
    { id: "stable-testids", description: "Every element in this contract resolves in its declared context on the built app.", verifiedBy: "e2e/ui-contract-drift.spec.ts" },
  ] satisfies UiContractInvariant[],
  journeys: [
    {
      id: "enter-demo-room",
      description: "Cold visitor reaches a working room in memory mode.",
      startContext: "landing",
      endContext: "room",
      steps: [
        { do: "goto", target: "/?mode=memory&surface=desktop" },
        { do: "click", target: '[data-testid="start-demo-room"]' },
        { do: "expectVisible", target: '[data-testid="artifact-tabs"]' },
        { do: "expectVisible", target: '[data-testid="status-strip"]' },
      ],
    },
    {
      id: "open-command-palette",
      description: "From the room, open and dismiss the command palette.",
      startContext: "room",
      endContext: "room",
      steps: [
        { do: "press", target: "Control+K" },
        { do: "expectVisible", target: '[data-testid="command-palette-input"]' },
        { do: "press", target: "Escape" },
      ],
    },
  ] satisfies UiContractJourney[],
};

export type UiContract = typeof uiContract;
