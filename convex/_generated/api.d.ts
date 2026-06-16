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
import type * as agentJobRunner from "../agentJobRunner.js";
import type * as agentJobs from "../agentJobs.js";
import type * as agentRuns from "../agentRuns.js";
import type * as agentStepJournal from "../agentStepJournal.js";
import type * as agentStepJournalClient from "../agentStepJournalClient.js";
import type * as agentSteps from "../agentSteps.js";
import type * as agentWorkflows from "../agentWorkflows.js";
import type * as artifacts from "../artifacts.js";
import type * as collab from "../collab.js";
import type * as convexRoomTools from "../convexRoomTools.js";
import type * as crons from "../crons.js";
import type * as drafts from "../drafts.js";
import type * as embeddingRunner from "../embeddingRunner.js";
import type * as embeddings from "../embeddings.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as locks from "../locks.js";
import type * as messages from "../messages.js";
import type * as notebookGraph from "../notebookGraph.js";
import type * as okf from "../okf.js";
import type * as okfEmbeddingProvider from "../okfEmbeddingProvider.js";
import type * as okfIndexer from "../okfIndexer.js";
import type * as retention from "../retention.js";
import type * as rooms from "../rooms.js";
import type * as seed from "../seed.js";
import type * as semanticRebase from "../semanticRebase.js";
import type * as spreadsheetIndexLib from "../spreadsheetIndexLib.js";
import type * as streaming from "../streaming.js";
import type * as streamingModel from "../streamingModel.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agentJobRunner: typeof agentJobRunner;
  agentJobs: typeof agentJobs;
  agentRuns: typeof agentRuns;
  agentStepJournal: typeof agentStepJournal;
  agentStepJournalClient: typeof agentStepJournalClient;
  agentSteps: typeof agentSteps;
  agentWorkflows: typeof agentWorkflows;
  artifacts: typeof artifacts;
  collab: typeof collab;
  convexRoomTools: typeof convexRoomTools;
  crons: typeof crons;
  drafts: typeof drafts;
  embeddingRunner: typeof embeddingRunner;
  embeddings: typeof embeddings;
  http: typeof http;
  lib: typeof lib;
  locks: typeof locks;
  messages: typeof messages;
  notebookGraph: typeof notebookGraph;
  okf: typeof okf;
  okfEmbeddingProvider: typeof okfEmbeddingProvider;
  okfIndexer: typeof okfIndexer;
  retention: typeof retention;
  rooms: typeof rooms;
  seed: typeof seed;
  semanticRebase: typeof semanticRebase;
  spreadsheetIndexLib: typeof spreadsheetIndexLib;
  streaming: typeof streaming;
  streamingModel: typeof streamingModel;
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
  agentWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"agentWorkpool">;
  persistentTextStreaming: import("@convex-dev/persistent-text-streaming/_generated/component.js").ComponentApi<"persistentTextStreaming">;
};
