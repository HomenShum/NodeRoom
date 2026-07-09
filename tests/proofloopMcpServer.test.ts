import { describe, expect, it } from "vitest";
import {
  PROOFLOOP_MCP_TOOLS,
  handleProofloopMcpRequest,
  type ProofloopMcpCommandResult,
} from "../src/eval/proofloopMcpServer";

describe("ProofLoop MCP server", () => {
  it("lists ProofLoop tools through MCP", async () => {
    const response = await handleProofloopMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1 });
    const result = response?.result as { tools: Array<{ name: string }> };
    expect(result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "proofloop_manifest",
      "proofloop_agents_setup",
      "proofloop_agents_launch",
      "proofloop_agents_collect",
      "proofloop_agents_verify",
      "proofloop_providers_setup",
      "proofloop_bench_setup",
      "proofloop_codex_reprompt_latest",
      "proofloop_gate_official_scores",
    ]));
    expect(PROOFLOOP_MCP_TOOLS.length).toBeGreaterThan(8);
  });

  it("returns manifest content without shelling out", async () => {
    const response = await handleProofloopMcpRequest({
      jsonrpc: "2.0",
      id: "manifest",
      method: "tools/call",
      params: { name: "proofloop_manifest", arguments: {} },
    });

    const result = response?.result as { content: Array<{ text: string }>; structuredContent: { schema: string } };
    expect(result.content[0].text).toContain("manifest --json");
    expect(result.structuredContent.schema).toBe("proofloop-cli-manifest-v1");
  });

  it("routes write tools through the existing ProofLoop CLI commands", async () => {
    const calls: string[][] = [];
    const runCommand = (args: string[]): ProofloopMcpCommandResult => {
      calls.push(args);
      return {
        command: "npm run proofloop --",
        args,
        exitCode: 0,
        stdout: "ok\n",
        stderr: "",
      };
    };

    const response = await handleProofloopMcpRequest({
      jsonrpc: "2.0",
      id: "setup",
      method: "tools/call",
      params: {
        name: "proofloop_agents_setup",
        arguments: { agent: "cursor", local: true },
      },
    }, { runCommand });

    expect(calls).toEqual([["agents", "setup", "cursor", "--local"]]);
    const result = response?.result as { content: Array<{ text: string }>; structuredContent: { exitCode: number } };
    expect(result.content[0].text).toContain("Command: npm run proofloop -- agents setup cursor --local");
    expect(result.structuredContent.exitCode).toBe(0);
  });

  it("routes native launch, collect, and verify tools through ProofLoop CLI commands", async () => {
    const calls: string[][] = [];
    const runCommand = (args: string[]): ProofloopMcpCommandResult => {
      calls.push(args);
      return {
        command: "npm run proofloop --",
        args,
        exitCode: 0,
        stdout: "ok\n",
        stderr: "",
      };
    };

    await handleProofloopMcpRequest({
      jsonrpc: "2.0",
      id: "launch",
      method: "tools/call",
      params: {
        name: "proofloop_agents_launch",
        arguments: { host: "devin-cli", prompt: "repair.md", runDir: ".proofloop/agents/native/devin-cli-test" },
      },
    }, { runCommand });
    await handleProofloopMcpRequest({
      jsonrpc: "2.0",
      id: "collect",
      method: "tools/call",
      params: {
        name: "proofloop_agents_collect",
        arguments: { host: "windsurf", runDir: ".proofloop/agents/native/windsurf-test", session: "transcript.jsonl" },
      },
    }, { runCommand });
    await handleProofloopMcpRequest({
      jsonrpc: "2.0",
      id: "verify",
      method: "tools/call",
      params: {
        name: "proofloop_agents_verify",
        arguments: { host: "devin-cli", runDir: ".proofloop/agents/native/devin-cli-test", goal: "official-scores" },
      },
    }, { runCommand });

    expect(calls).toEqual([
      ["agents", "launch", "devin-cli", "--prompt", "repair.md", "--run-dir", ".proofloop/agents/native/devin-cli-test"],
      ["agents", "collect", "windsurf", "--run-dir", ".proofloop/agents/native/windsurf-test", "--session", "transcript.jsonl"],
      ["agents", "verify", "devin-cli", "--run-dir", ".proofloop/agents/native/devin-cli-test", "--goal", "official-scores", "--strict"],
    ]);
  });

  it("validates enum arguments before running commands", async () => {
    const response = await handleProofloopMcpRequest({
      jsonrpc: "2.0",
      id: "bad",
      method: "tools/call",
      params: {
        name: "proofloop_bench_setup",
        arguments: { bench: "unknown" },
      },
    }, {
      runCommand: () => {
        throw new Error("should not run");
      },
    });

    expect(response?.error).toMatchObject({ code: -32000 });
    expect(response?.error?.message).toContain("Expected one of");
  });
});
