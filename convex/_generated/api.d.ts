/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as agentArtifacts from "../agentArtifacts.js";
import type * as agentJobRunner from "../agentJobRunner.js";
import type * as agentJobs from "../agentJobs.js";
import type * as agentRuns from "../agentRuns.js";
import type * as agentStepJournal from "../agentStepJournal.js";
import type * as agentStepJournalClient from "../agentStepJournalClient.js";
import type * as agentSteps from "../agentSteps.js";
import type * as agentWorkflows from "../agentWorkflows.js";
import type * as alwaysOn from "../alwaysOn.js";
import type * as alwaysOnCore from "../alwaysOnCore.js";
import type * as alwaysOnShape from "../alwaysOnShape.js";
import type * as artifacts from "../artifacts.js";
import type * as auditBundle from "../auditBundle.js";
import type * as auditLog from "../auditLog.js";
import type * as benchmarkGrade from "../benchmarkGrade.js";
import type * as captures from "../captures.js";
import type * as capturesNode from "../capturesNode.js";
import type * as citations from "../citations.js";
import type * as citePdf from "../citePdf.js";
import type * as collab from "../collab.js";
import type * as convexRoomTools from "../convexRoomTools.js";
import type * as credits from "../credits.js";
import type * as crons from "../crons.js";
import type * as drafts from "../drafts.js";
import type * as elementHistory from "../elementHistory.js";
import type * as embeddingRunner from "../embeddingRunner.js";
import type * as embeddings from "../embeddings.js";
import type * as evalLedgerIngest from "../evalLedgerIngest.js";
import type * as evalRuns from "../evalRuns.js";
import type * as evidence from "../evidence.js";
import type * as exportDelete from "../exportDelete.js";
import type * as fileProcessing from "../fileProcessing.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as lib_cellsToGoldenOutputs from "../lib/cellsToGoldenOutputs.js";
import type * as lib_goldenRubrics from "../lib/goldenRubrics.js";
import type * as locks from "../locks.js";
import type * as loopAttempts from "../loopAttempts.js";
import type * as loopPolicies from "../loopPolicies.js";
import type * as loopRewards from "../loopRewards.js";
import type * as memory from "../memory.js";
import type * as messages from "../messages.js";
import type * as metrics from "../metrics.js";
import type * as modelFrontier from "../modelFrontier.js";
import type * as nodemem from "../nodemem.js";
import type * as nodememCompile from "../nodememCompile.js";
import type * as notebookAgent from "../notebookAgent.js";
import type * as notebookGraph from "../notebookGraph.js";
import type * as notebookProcessing from "../notebookProcessing.js";
import type * as noteworthy from "../noteworthy.js";
import type * as okf from "../okf.js";
import type * as okfEmbeddingProvider from "../okfEmbeddingProvider.js";
import type * as okfIndexer from "../okfIndexer.js";
import type * as presence from "../presence.js";
import type * as prosemirror from "../prosemirror.js";
import type * as retention from "../retention.js";
import type * as roomActivity from "../roomActivity.js";
import type * as rooms from "../rooms.js";
import type * as runTrace from "../runTrace.js";
import type * as sec from "../sec.js";
import type * as securityEvents from "../securityEvents.js";
import type * as seed from "../seed.js";
import type * as semanticRebase from "../semanticRebase.js";
import type * as spreadsheetIndexLib from "../spreadsheetIndexLib.js";
import type * as streaming from "../streaming.js";
import type * as streamingModel from "../streamingModel.js";
import type * as usageLimits from "../usageLimits.js";
import type * as voice from "../voice.js";
import type * as watches from "../watches.js";
import type * as watchesTables from "../watchesTables.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agentArtifacts: typeof agentArtifacts;
  agentJobRunner: typeof agentJobRunner;
  agentJobs: typeof agentJobs;
  agentRuns: typeof agentRuns;
  agentStepJournal: typeof agentStepJournal;
  agentStepJournalClient: typeof agentStepJournalClient;
  agentSteps: typeof agentSteps;
  agentWorkflows: typeof agentWorkflows;
  alwaysOn: typeof alwaysOn;
  alwaysOnCore: typeof alwaysOnCore;
  alwaysOnShape: typeof alwaysOnShape;
  artifacts: typeof artifacts;
  auditBundle: typeof auditBundle;
  auditLog: typeof auditLog;
  benchmarkGrade: typeof benchmarkGrade;
  captures: typeof captures;
  capturesNode: typeof capturesNode;
  citations: typeof citations;
  citePdf: typeof citePdf;
  collab: typeof collab;
  convexRoomTools: typeof convexRoomTools;
  credits: typeof credits;
  crons: typeof crons;
  drafts: typeof drafts;
  elementHistory: typeof elementHistory;
  embeddingRunner: typeof embeddingRunner;
  embeddings: typeof embeddings;
  evalLedgerIngest: typeof evalLedgerIngest;
  evalRuns: typeof evalRuns;
  evidence: typeof evidence;
  exportDelete: typeof exportDelete;
  fileProcessing: typeof fileProcessing;
  http: typeof http;
  lib: typeof lib;
  "lib/cellsToGoldenOutputs": typeof lib_cellsToGoldenOutputs;
  "lib/goldenRubrics": typeof lib_goldenRubrics;
  locks: typeof locks;
  loopAttempts: typeof loopAttempts;
  loopPolicies: typeof loopPolicies;
  loopRewards: typeof loopRewards;
  memory: typeof memory;
  messages: typeof messages;
  metrics: typeof metrics;
  modelFrontier: typeof modelFrontier;
  nodemem: typeof nodemem;
  nodememCompile: typeof nodememCompile;
  notebookAgent: typeof notebookAgent;
  notebookGraph: typeof notebookGraph;
  notebookProcessing: typeof notebookProcessing;
  noteworthy: typeof noteworthy;
  okf: typeof okf;
  okfEmbeddingProvider: typeof okfEmbeddingProvider;
  okfIndexer: typeof okfIndexer;
  presence: typeof presence;
  prosemirror: typeof prosemirror;
  retention: typeof retention;
  roomActivity: typeof roomActivity;
  rooms: typeof rooms;
  runTrace: typeof runTrace;
  sec: typeof sec;
  securityEvents: typeof securityEvents;
  seed: typeof seed;
  semanticRebase: typeof semanticRebase;
  spreadsheetIndexLib: typeof spreadsheetIndexLib;
  streaming: typeof streaming;
  streamingModel: typeof streamingModel;
  usageLimits: typeof usageLimits;
  voice: typeof voice;
  watches: typeof watches;
  watchesTables: typeof watchesTables;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  passiveWorkflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"passiveWorkflow">;
  agentWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"agentWorkpool">;
  persistentTextStreaming: import("@convex-dev/persistent-text-streaming/_generated/component.js").ComponentApi<"persistentTextStreaming">;
  debouncer: import("@ikhrustalev/convex-debouncer/_generated/component.js").ComponentApi<"debouncer">;
  prosemirrorSync: import("@convex-dev/prosemirror-sync/_generated/component.js").ComponentApi<"prosemirrorSync">;
};
