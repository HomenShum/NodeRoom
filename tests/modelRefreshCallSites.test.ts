/**
 * 2026-10 model refresh (SPEC Part A §A.2.9, rule A.0.6) — the migrated DEFAULT_AGENT_MODEL call sites.
 *
 * The constant itself is pinned by tests/modelCatalogRefresh.test.ts and the http.ts / agentJobs.ts / adapter.ts /
 * adaptiveRouter.ts sites are driven through their builders elsewhere. These five are not reachable from a unit test
 * without a live Convex deployment (the actions are "use node" bundles bound to a ctx; the Chat composer is a React
 * closure), so each is pinned at the expression that owns the default. Re-inlining "gemini-3.5-flash" (or any literal)
 * at one of them, or dropping the env chain, makes exactly that test fail; the previous suite stayed green for all five.
 *
 *   convex/agent.ts:346          runRoomAgent (public_ask)   process.env.AGENT_MODEL ?? DEFAULT_AGENT_MODEL
 *   convex/agent.ts:783          runPrivateAgent             process.env.AGENT_MODEL ?? DEFAULT_AGENT_MODEL
 *   convex/agentJobRunner.ts:512 runFreeAutoJobSlice         claimed.modelPolicy || (free ? free-auto : AGENT_MODEL ?? DEFAULT_AGENT_MODEL)
 *   convex/streaming.ts:68       createPrivateReplyStream    process.env.AGENT_MODEL ?? DEFAULT_AGENT_MODEL (egress check)
 *   src/ui/Chat.tsx:1690         composerModelSelection      specificModelPolicy || defaultSpecificModel || DEFAULT_AGENT_MODEL
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_MODEL } from "../convex/modelDefaults";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
/** Source with line and block comments blanked, so a mention of an old id in prose is not mistaken for code. */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
const count = (haystack: string, needle: RegExp) => [...haystack.matchAll(new RegExp(needle.source, needle.flags.includes("g") ? needle.flags : `${needle.flags}g`))].length;
const OLD_OR_OTHER_GEMINI_LITERAL = /["'`]gemini-3\.\d+(?:-flash)?(?:-lite)?["'`]/;

describe("DEFAULT_AGENT_MODEL call sites (model refresh)", () => {
  it("the constant is the refreshed id", () => {
    expect(DEFAULT_AGENT_MODEL).toBe("gemini-3.8-flash");
  });

  it("convex/agent.ts:346 runRoomAgent (public_ask) falls back to DEFAULT_AGENT_MODEL, behind AGENT_RESEARCH_MODEL for research", () => {
    const src = code("convex/agent.ts");
    expect(src).toMatch(/const requestedModelName = a\.mode === "research"\s*\? \(process\.env\.AGENT_RESEARCH_MODEL \?\? "minimax\/minimax-m3"\)\s*: \(process\.env\.AGENT_MODEL \?\? DEFAULT_AGENT_MODEL\);/);
    expect(src).toMatch(/agentModel\(modelNameForEgress\(requestedModelName, "public_ask", egressArtifacts\), \{ entrypoint: "public_ask" \}\)/);
  });

  it("convex/agent.ts:783 runPrivateAgent falls back to DEFAULT_AGENT_MODEL", () => {
    const src = code("convex/agent.ts");
    expect(src).toMatch(/agentModel\(modelNameForEgress\(process\.env\.AGENT_MODEL \?\? DEFAULT_AGENT_MODEL, "private_agent", egressArtifacts\), \{ entrypoint: "private_agent" \}\)/);
    expect(count(src, /process\.env\.AGENT_MODEL \?\? DEFAULT_AGENT_MODEL/)).toBe(2); // exactly the two roles; a third copy would be a new, untested site
    expect(src).not.toMatch(OLD_OR_OTHER_GEMINI_LITERAL);
  });

  it("convex/agentJobRunner.ts:512 runFreeAutoJobSlice resolves an unset modelPolicy through AGENT_MODEL ?? DEFAULT_AGENT_MODEL", () => {
    const src = code("convex/agentJobRunner.ts");
    expect(src).toMatch(/const modelPolicy = claimed\.modelPolicy \|\| \(entrypoint === "free" \? "openrouter\/free-auto" : process\.env\.AGENT_MODEL \?\? DEFAULT_AGENT_MODEL\);/);
    expect(src).not.toMatch(OLD_OR_OTHER_GEMINI_LITERAL);
  });

  it("convex/streaming.ts:68 createPrivateReplyStream checks egress for the same default model the stream route sends", () => {
    const src = code("convex/streaming.ts");
    expect(src).toMatch(/assertProviderEgressAllowed\(\{\s*model: process\.env\.AGENT_MODEL \?\? DEFAULT_AGENT_MODEL,\s*entrypoint: "private_agent",/);
    expect(src).not.toMatch(OLD_OR_OTHER_GEMINI_LITERAL);
  });

  it("src/ui/Chat.tsx:1690 composerModelSelection falls back to DEFAULT_AGENT_MODEL after the user's choice and the room default", () => {
    const src = code("src/ui/Chat.tsx");
    expect(src).toMatch(/\{ mode: "specific", modelPolicy: specificModelPolicy \|\| defaultSpecificModel \|\| DEFAULT_AGENT_MODEL \}/);
    expect(src).toMatch(/import \{ DEFAULT_AGENT_MODEL \} from "\.\.\/\.\.\/convex\/modelDefaults";/);
  });

  it("every site imports the one constant from convex/modelDefaults (no local copy)", () => {
    for (const [file, from] of [
      ["convex/agent.ts", "./modelDefaults"],
      ["convex/agentJobRunner.ts", "./modelDefaults"],
      ["convex/streaming.ts", "./modelDefaults"],
      ["src/ui/Chat.tsx", "../../convex/modelDefaults"],
    ] as const) {
      expect(code(file), file).toMatch(new RegExp(`import \\{[^}]*\\bDEFAULT_AGENT_MODEL\\b[^}]*\\} from "${from.replace(/[./]/g, "\\$&")}";`));
      expect(code(file), file).not.toMatch(/(?:const|let|var)\s+DEFAULT_AGENT_MODEL\b/);
    }
  });
});
