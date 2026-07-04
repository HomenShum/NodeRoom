import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  __bankerToolBenchGeneralTestHooks,
  runBankerToolBenchNodeAgentGeneral,
  type BtbSourceFileSummary,
  type BankerToolBenchSourcePacket,
} from "../src/eval/bankerToolBenchNodeAgentGeneral";
import {
  getModelPricing,
  getProviderForModel,
  isValidModel,
  resolveModelAlias,
} from "../src/nodeagent/models/modelCatalog";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BankerToolBench NodeAgent general runner", () => {
  it("writes a deterministic artifact plan with cell and bbox citation coverage", async () => {
    const root = tempRoot();
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers: ["LVS"],
      inputFiles: [
        {
          path: "/home/agent/workspace/LVS historicals.xlsx",
          kind: "xlsx",
          sheets: [
            {
              name: "Income Statement",
              maxRow: 10,
              maxColumn: 3,
              cells: [
                { address: "A1", value: "Revenue" },
                { address: "B1", value: 1200 },
              ],
            },
          ],
        },
        {
          path: "/home/agent/workspace/source filing.pdf",
          kind: "pdf",
          pages: [
            {
              page: 1,
              text: "Las Vegas Sands reported casino revenue and adjusted property EBITDA.",
              boxes: [{ x: 10, y: 20, w: 30, h: 12, page: 1, unit: "pt" }],
            },
          ],
        },
      ],
      mcpFiles: [],
      mcpCalls: [],
    };

    const result = await runBankerToolBenchNodeAgentGeneral({
      instruction: "Build a DCF package for LVS with Excel, PowerPoint, memo, PDF, and citations.",
      sourcePacket,
      outDir: join(root, "out"),
      artifactPlanOut: join(root, "artifact-plan.json"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      modelId: "local/deterministic",
      nowIso: "2026-06-20T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.modelName).toBe("local/deterministic-btb-planner");
    expect(result.plannerTransport).toBe("tool-call");
    expect(result.allowFallbackPlan).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    const plan = JSON.parse(await readFile(result.artifactPlanOut, "utf8")) as {
      schema: string;
      tickers: string[];
      deliverables: { workbook: boolean; presentation: boolean; memo: boolean; pdf: boolean };
      citations: Array<{ boundaryBoxStatus: string; sourcePath: string }>;
    };
    expect(plan.schema).toBe("noderoom-btb-artifact-plan-v1");
    expect(plan.tickers).toEqual(["LVS"]);
    expect(plan.deliverables).toEqual({ workbook: true, presentation: true, memo: true, pdf: true });
    expect(plan.citations.map((citation) => citation.boundaryBoxStatus)).toContain("cell");
    expect(plan.citations.map((citation) => citation.boundaryBoxStatus)).toContain("bbox");

    const trajectory = JSON.parse(await readFile(result.trajectoryOut, "utf8")) as {
      schema_version: string;
      agent: { version: string };
      steps: Array<{ tool_calls?: Array<{ function_name: string }> }>;
    };
    expect(trajectory.schema_version).toBe("ATIF-v1.6");
    expect(trajectory.agent.version).toBe("0.2.0-general");
    expect(trajectory.steps.some((step) => step.tool_calls?.some((call) => call.function_name === "write_artifact_plan"))).toBe(true);

    const trace = JSON.parse(await readFile(result.traceOut, "utf8")) as {
      allowFallbackPlan: boolean;
      fallbackUsed: boolean;
      plannerStopReason: string;
      plannerTransport: string;
    };
    expect(trace.allowFallbackPlan).toBe(true);
    expect(trace.fallbackUsed).toBe(false);
    expect(trace.plannerStopReason).toBe("done");
    expect(trace.plannerTransport).toBe("tool-call");
  });

  it("rejects no-plan planner output when fallback plans are disabled", async () => {
    const root = tempRoot();
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers: ["LVS"],
      inputFiles: [],
      mcpFiles: [],
      mcpCalls: [],
    };

    await expect(runBankerToolBenchNodeAgentGeneral({
      instruction: "Build a DCF package for LVS with Excel, PowerPoint, memo, PDF, and citations.",
      sourcePacket,
      outDir: join(root, "out"),
      artifactPlanOut: join(root, "artifact-plan.json"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      modelId: "local/no-tool",
      nowIso: "2026-06-20T00:00:00.000Z",
      allowFallbackPlan: false,
    })).rejects.toThrow(/without committing an artifact plan/);
  });

  it("commits source-driven public comps plans without fallback in strict mode", async () => {
    const root = tempRoot();
    const tickers = ["ADBE", "AMZN", "CRM", "GOOGL", "INTC", "META", "MSFT", "NVDA", "ORCL"];
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers,
      inputFiles: [],
      mcpFiles: tickers.flatMap((ticker) => [
        sourceWorkbook(ticker, "Price History (Daily)"),
        sourceWorkbook(ticker, "Shares Outstanding"),
        sourceWorkbook(ticker, "Revenue Estimate"),
        sourceWorkbook(ticker, "Balance Sheet (Quarterly)"),
        sourceWorkbook(ticker, "Income Statement (Annual)"),
      ]),
      mcpCalls: [],
    };

    const result = await runBankerToolBenchNodeAgentGeneral({
      instruction: "Prepare a public comps spreadsheet and ppt output with Market cap, 2025E and 2026E Revenue, EV/Revenue, EV/EBITDA, EBITDA margins, averages and weighted averages as of 11/16/2025.",
      sourcePacket,
      outDir: join(root, "out"),
      artifactPlanOut: join(root, "artifact-plan.json"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      modelId: "local/no-tool",
      nowIso: "2026-06-20T00:00:00.000Z",
      allowFallbackPlan: false,
    });

    expect(result.ok).toBe(true);
    expect(result.plannerTransport).toBe("source-skill");
    expect(result.fallbackUsed).toBe(false);
    expect(result.usage.modelCalls).toBe(0);

    const plan = JSON.parse(await readFile(result.artifactPlanOut, "utf8")) as {
      tickers: string[];
      citations: Array<{ boundaryBoxStatus: string }>;
    };
    expect(plan.tickers).toEqual(tickers);
    expect(plan.citations.map((citation) => citation.boundaryBoxStatus)).toContain("cell");
    expect(plan.citations.map((citation) => citation.boundaryBoxStatus)).toContain("derived");
  });

  it("forces model planning instead of source-skill planning for clean capability probes", async () => {
    const root = tempRoot();
    const tickers = ["ADBE", "AMZN", "CRM", "GOOGL", "INTC", "META", "MSFT", "NVDA", "ORCL"];
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers,
      inputFiles: [],
      mcpFiles: tickers.flatMap((ticker) => [
        sourceWorkbook(ticker, "Price History (Daily)"),
        sourceWorkbook(ticker, "Shares Outstanding"),
        sourceWorkbook(ticker, "Revenue Estimate"),
      ]),
      mcpCalls: [],
    };

    const result = await runBankerToolBenchNodeAgentGeneral({
      instruction: "Prepare a public comps spreadsheet and ppt output with Market cap, 2025E and 2026E Revenue, EV/Revenue, EV/EBITDA, EBITDA margins, averages and weighted averages as of 11/16/2025.",
      sourcePacket,
      outDir: join(root, "out"),
      artifactPlanOut: join(root, "artifact-plan.json"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      modelId: "local/json-text",
      nowIso: "2026-06-20T00:00:00.000Z",
      allowFallbackPlan: false,
      forceModelPlanner: true,
    });

    expect(result.ok).toBe(true);
    expect(result.forceModelPlanner).toBe(true);
    expect(result.plannerTransport).toBe("json-text");
    expect(result.fallbackUsed).toBe(false);
    expect(result.usage.modelCalls).toBeGreaterThan(0);

    const trace = JSON.parse(await readFile(result.traceOut, "utf8")) as {
      forceModelPlanner: boolean;
      plannerTransport: string;
      trace: Array<{ tool?: string }>;
    };
    expect(trace.forceModelPlanner).toBe(true);
    expect(trace.plannerTransport).toBe("json-text");
    expect(trace.trace.some((event) => event.tool === "source_driven_artifact_plan")).toBe(false);
  });

  it("normalizes citation boundary-status aliases from JSON-text model plans", async () => {
    const root = tempRoot();
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers: ["BAC"],
      inputFiles: [],
      mcpFiles: [],
      mcpCalls: [],
    };

    const result = await runBankerToolBenchNodeAgentGeneral({
      instruction: "Build a cited workbook and PDF from the source packet.",
      sourcePacket,
      outDir: join(root, "out"),
      artifactPlanOut: join(root, "artifact-plan.json"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      modelId: "local/json-status-alias",
      nowIso: "2026-06-20T00:00:00.000Z",
      allowFallbackPlan: false,
      forceModelPlanner: true,
    });

    expect(result.ok).toBe(true);
    expect(result.plannerTransport).toBe("json-text");
    expect(result.fallbackUsed).toBe(false);
    const plan = JSON.parse(await readFile(result.artifactPlanOut, "utf8")) as {
      citations: Array<{ boundaryBoxStatus: string }>;
    };
    expect(plan.citations.map((citation) => citation.boundaryBoxStatus)).toEqual(["cell", "page"]);
  });

  it("normalizes plural row and cell boundary-status aliases before schema validation", () => {
    const normalized = __bankerToolBenchGeneralTestHooks.normalizeArtifactPlanForValidation({
      citations: [
        { claim: "Workbook row support", sourcePath: "model.xlsx", locator: "Rows 4-8", boundaryBoxStatus: "rows" },
        { claim: "Workbook cell support", sourcePath: "model.xlsx", locator: "B12:C15", boundaryBoxStatus: "cells" },
      ],
    }) as { citations: Array<{ boundaryBoxStatus: string }> };

    expect(normalized.citations.map((citation) => citation.boundaryBoxStatus)).toEqual(["cell", "cell"]);
  });

  it("normalizes compound boundary-status aliases and null quotes before schema validation", () => {
    const normalized = __bankerToolBenchGeneralTestHooks.normalizeArtifactPlanForValidation({
      citations: [
        { claim: "Derived workbook cell", sourcePath: "model.xlsx", locator: "B12", quote: null, boundaryBoxStatus: "cell|derived" },
        { claim: "Unsupported assumption", sourcePath: "model.xlsx", locator: "not found", quote: null, boundaryBoxStatus: "unsupported" },
      ],
    }) as { citations: Array<{ boundaryBoxStatus: string; quote?: string }> };

    expect(normalized.citations.map((citation) => citation.boundaryBoxStatus)).toEqual(["cell", "unsupported"]);
    expect(normalized.citations.map((citation) => citation.quote)).toEqual([undefined, undefined]);
  });

  it("treats task-instruction citations as supported paragraph receipts", () => {
    const normalized = __bankerToolBenchGeneralTestHooks.normalizeArtifactPlanForValidation({
      citations: [
        {
          claim: "IOIs are due April 24.",
          sourcePath: "/home/agent/workspace/",
          locator: "instruction",
          quote: "IOI: April 24",
          boundaryBoxStatus: "unsupported",
        },
      ],
    }) as { citations: Array<{ sourcePath: string; boundaryBoxStatus: string }> };

    expect(normalized.citations).toEqual([expect.objectContaining({
      sourcePath: "task_instruction",
      boundaryBoxStatus: "paragraph",
    })]);
  });

  it("normalizes citation boundary-status aliases from tool-call model plans", async () => {
    const root = tempRoot();
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers: ["BAC"],
      inputFiles: [],
      mcpFiles: [],
      mcpCalls: [],
    };

    const result = await runBankerToolBenchNodeAgentGeneral({
      instruction: "Build a cited workbook and PDF from the source packet.",
      sourcePacket,
      outDir: join(root, "out"),
      artifactPlanOut: join(root, "artifact-plan.json"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      modelId: "local/tool-status-alias",
      nowIso: "2026-06-20T00:00:00.000Z",
      allowFallbackPlan: false,
      allowJsonTextPlanner: false,
      forceModelPlanner: true,
    });

    expect(result.ok).toBe(true);
    expect(result.plannerTransport).toBe("tool-call");
    expect(result.fallbackUsed).toBe(false);
    const plan = JSON.parse(await readFile(result.artifactPlanOut, "utf8")) as {
      citations: Array<{ boundaryBoxStatus: string }>;
    };
    expect(plan.citations.map((citation) => citation.boundaryBoxStatus)).toEqual(["cell", "page"]);
  });

  it("repairs commented JSON-text plans with blank citation locators", async () => {
    const root = tempRoot();
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers: ["CRM"],
      inputFiles: [],
      mcpFiles: [],
      mcpCalls: [],
    };

    const result = await runBankerToolBenchNodeAgentGeneral({
      instruction: "Build a cited sources and uses workbook from the provided packet.",
      sourcePacket,
      outDir: join(root, "out"),
      artifactPlanOut: join(root, "artifact-plan.json"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      modelId: "local/json-comment-blank-citations",
      nowIso: "2026-06-20T00:00:00.000Z",
      allowFallbackPlan: false,
      forceModelPlanner: true,
    });

    expect(result.ok).toBe(true);
    expect(result.plannerTransport).toBe("json-text");
    expect(result.fallbackUsed).toBe(false);
    const plan = JSON.parse(await readFile(result.artifactPlanOut, "utf8")) as {
      citations: Array<{ sourcePath: string; locator: string; boundaryBoxStatus: string }>;
    };
    expect(plan.citations[0]).toMatchObject({
      sourcePath: "Agent-derived from source packet",
      locator: "model-plan derived citation",
      boundaryBoxStatus: "derived",
    });
  });

  it("preflights clean-probe plans into populated generic workbook tables", async () => {
    const root = tempRoot();
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers: ["BAC"],
      inputFiles: [{
        path: "/home/agent/workspace/Pricing Supplement - BAC 2023 Notes.docx",
        kind: "docx",
        paragraphs: [{ index: 1, text: "Two BAC senior notes tranches priced April 19, 2023." }],
      }],
      mcpFiles: [],
      mcpCalls: [],
    };

    const result = await runBankerToolBenchNodeAgentGeneral({
      instruction: [
        "Please deliver a single-slide PPT and its corresponding PDF with a clean terms summary.",
        "Use Excel formatting for the terms table and include only the two BAC senior notes tranches.",
      ].join(" "),
      sourcePacket,
      outDir: join(root, "out"),
      artifactPlanOut: join(root, "artifact-plan.json"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      modelId: "local/json-empty-workbook",
      nowIso: "2026-06-20T00:00:00.000Z",
      allowFallbackPlan: false,
      forceModelPlanner: true,
    });

    expect(result.ok).toBe(true);
    expect(result.forceModelPlanner).toBe(true);
    expect(result.plannerTransport).toBe("json-text");
    expect(result.fallbackUsed).toBe(false);

    const plan = JSON.parse(await readFile(result.artifactPlanOut, "utf8")) as {
      deliverables: { workbook: boolean };
      workbook: { sheets: Array<{ name: string; rows: string[][] }> };
      presentation: { slides: Array<unknown> };
    };
    expect(plan.deliverables.workbook).toBe(true);
    expect(plan.workbook.sheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(["Term Summary", "Sources"]));
    expect(plan.workbook.sheets[0]?.rows).toContainEqual([
      "Term",
      "5.202% Senior Notes 2029",
      "5.288% Senior Notes 2034",
    ]);
    expect(plan.workbook.sheets[0]?.rows).toContainEqual(["CUSIP", "06051GLG2", "06051GLH0"]);
    expect(plan.presentation.slides).toHaveLength(1);

    const trace = JSON.parse(await readFile(result.traceOut, "utf8")) as {
      trace: Array<{ tool?: string; args?: { repairs?: string[] } }>;
    };
    const preflight = trace.trace.find((event) => event.tool === "artifact_plan_preflight");
    expect(preflight?.args?.repairs).toEqual(expect.arrayContaining([
      "enabled_workbook_from_instruction",
      "added_primary_workbook_sheet",
      "added_sources_sheet",
    ]));
  });

  it("does not collapse one-slide-per-category presentations into one slide", () => {
    const basePlan = minimalPlan({
      title: "Buyer Universe Presentation",
      workbookSheets: [
        { name: "Strategic Operators", rows: [["Potential Buyer", "Key Statistics"], ["Kinder Morgan", "Market cap"]] },
      ],
      slides: ["Strategic Operators", "Infrastructure PE Sponsors", "Pension Funds"],
    });

    const { plan, repairs } = __bankerToolBenchGeneralTestHooks.preflightArtifactPlan(
      basePlan,
      "Deliver the output as a PowerPoint presentation with one slide per buyer category.",
      { schema: "noderoom-btb-source-packet-v1", tickers: [], inputFiles: [], mcpFiles: [], mcpCalls: [] },
    );

    expect(plan.presentation.slides).toHaveLength(3);
    expect(repairs).not.toContain("trimmed_presentation_to_single_slide");
  });

  it("expands 5x5 sensitivity tables only on sensitivity sheets", () => {
    const basePlan = minimalPlan({
      title: "Shake Shack LBO Model",
      workbookSheets: [
        { name: "Assumptions & Sources-Uses", rows: [["Input", "Value"], ["Sponsor Requested LTV", "40%"]] },
        { name: "Income Statement & Cash Flow", rows: [["Year", "2025E", "2026E"], ["Revenue", "Formula", "Formula"]] },
        { name: "Sensitivity Tables", rows: [["LTV % / Spread %", "3.5%", "4.5%", "5.5%"], ["30%", "Formula", "Formula", "Formula"]] },
      ],
      slides: ["Summary"],
    });

    const { plan, repairs } = __bankerToolBenchGeneralTestHooks.preflightArtifactPlan(
      basePlan,
      "Sensitivity tables should be 5 by 5 and show LTV % vs. Interest Rate Spread centered on 40% LTV and S+450.",
      { schema: "noderoom-btb-source-packet-v1", tickers: ["SHAK"], inputFiles: [], mcpFiles: [], mcpCalls: [] },
    );

    expect(repairs).toContain("expanded_5x5_sensitivity:Sensitivity Tables");
    expect(repairs.some((repair) => repair === "expanded_5x5_sensitivity:Assumptions & Sources-Uses")).toBe(false);
    expect(repairs.some((repair) => repair === "expanded_5x5_sensitivity:Income Statement & Cash Flow")).toBe(false);
    expect(plan.workbook.sheets[0]?.rows[0]).toEqual(["Input", "Value"]);
    expect(plan.workbook.sheets[1]?.rows[0]).toEqual(["Year", "2025E", "2026E"]);
    expect(plan.workbook.sheets[2]?.rows[1]).toEqual(["LTV % / Spread %", "2.5%", "3.5%", "4.5%", "5.5%", "6.5%"]);
    expect(plan.workbook.sheets[2]?.rows[2]?.[0]).toBe("20%");
    expect(plan.workbook.sheets[2]?.rows[6]?.[0]).toBe("60%");
  });

  it("adds source citations when a clean model plan omits citation receipts", () => {
    const basePlan = minimalPlan({
      title: "Buyer Universe Presentation",
      workbookSheets: [],
      slides: ["Strategic Operators", "Infrastructure PE Sponsors", "Pension Funds"],
    });
    basePlan.citations = [];

    const { plan, repairs } = __bankerToolBenchGeneralTestHooks.preflightArtifactPlan(
      basePlan,
      "Deliver the output as a PowerPoint presentation with source footnotes.",
      {
        schema: "noderoom-btb-source-packet-v1",
        tickers: [],
        inputFiles: [{
          path: "/home/agent/workspace/source.pdf",
          kind: "pdf",
          pages: [{ page: 1, text: "Market data and buyer universe source evidence." }],
        }],
        mcpFiles: [],
        mcpCalls: [],
      },
    );

    expect(repairs).toContain("added_source_citations");
    expect(plan.citations).toHaveLength(1);
    expect(plan.citations[0]).toMatchObject({
      sourcePath: "/home/agent/workspace/source.pdf",
      locator: "page 1",
      boundaryBoxStatus: "bbox",
    });
  });

  it("commits structured finance source-skill plans before model planning in strict mode", async () => {
    const root = tempRoot();
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers: ["CRM"],
      inputFiles: [],
      mcpFiles: [
        sourceWorkbook("CRM", "Income Statement (Annual)"),
        sourceWorkbook("CRM", "Balance Sheet (Quarterly)"),
        sourceWorkbook("CRM", "Shares Outstanding"),
        sourceWorkbook("CRM", "Capital Structure"),
      ],
      mcpCalls: [],
    };

    const result = await runBankerToolBenchNodeAgentGeneral({
      instruction: "Using the provided historical financials for Salesforce (CRM-US), build an illustrative Sources and Uses analysis with a Transaction Assumptions table, Enterprise Value calculations, Debt Calculations, complete Sources and Uses table, and a Sensitivity Table for Equity Injection. Include Transaction Fees of 2.0%, Financing Fees of 2.5%, Term Loan B Amount (x EBITDA) of 3.0x, Shareholder Rollover of 25.0%, and Premium to Current Share price of 35.0%.",
      sourcePacket,
      outDir: join(root, "out"),
      artifactPlanOut: join(root, "artifact-plan.json"),
      trajectoryOut: join(root, "trajectory.json"),
      traceOut: join(root, "trace.json"),
      modelId: "local/no-tool",
      nowIso: "2026-06-20T00:00:00.000Z",
      allowFallbackPlan: false,
    });

    expect(result.ok).toBe(true);
    expect(result.plannerTransport).toBe("source-skill");
    expect(result.fallbackUsed).toBe(false);
    expect(result.usage.modelCalls).toBe(0);

    const plan = JSON.parse(await readFile(result.artifactPlanOut, "utf8")) as {
      title: string;
      workbook: { sheets: Array<{ name: string; rows: string[][] }> };
    };
    expect(plan.title).toContain("CRM Sources and Uses Analysis");
    expect(plan.workbook.sheets.map((sheet) => sheet.name)).toEqual(
      expect.arrayContaining(["Transaction Assumptions", "Enterprise Value", "Sources and Uses", "Sensitivity Table"]),
    );
    expect(JSON.stringify(plan.workbook.sheets)).toContain("2.0%");
    expect(JSON.stringify(plan.workbook.sheets)).toContain("35.0%");
  });

  it("compacts large peer source packets under budget while preserving valuation inputs", () => {
    const files = ["Revenue Estimate", "Earnings Estimate", "Price History (Daily)", "Income Statement (Annual)", "Insider Transactions"]
      .flatMap((kind) => ["ADBE", "AMZN", "CRM", "GOOGL", "MSFT", "NVDA", "ORCL"].map((ticker) => sourceWorkbook(ticker, kind)));
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers: ["ADBE", "AMZN", "CRM", "GOOGL", "MSFT", "NVDA", "ORCL"],
      inputFiles: [],
      mcpFiles: files,
      mcpCalls: [],
    };

    const compact = __bankerToolBenchGeneralTestHooks.compactSourcePacket(
      sourcePacket,
      50_000,
      "Prepare a valuation comps spreadsheet with Revenue, EBITDA, P/E, market cap, and weighted averages.",
    );
    const compactText = JSON.stringify(compact);
    const compactNames = compact.mcpFiles?.map((file) => file.name ?? "") ?? [];
    const compactPaths = compact.mcpFiles?.map((file) => file.path) ?? [];
    const representedTickers = new Set(
      compactPaths
        .map((path) => path.match(/\/mcp\/([^/]+)\//)?.[1])
        .filter(Boolean),
    );

    expect(compactText.length).toBeLessThanOrEqual(50_000);
    expect([...representedTickers].sort()).toEqual(["ADBE", "AMZN", "CRM", "GOOGL", "MSFT", "NVDA", "ORCL"]);
    expect(compactNames.some((name) => name.includes("Revenue Estimate"))).toBe(true);
    expect(compactNames.some((name) => name.includes("Earnings Estimate"))).toBe(true);
    expect(compactNames.some((name) => name.includes("Price History"))).toBe(true);
    expect(compact.warnings?.some((warning) => warning.includes("source packet compaction selected"))).toBe(true);
    expect(compact.warnings?.some((warning) => warning.includes("balanced MCP coverage files"))).toBe(true);
  });

  it("preserves MCP coverage index when verbose call logs would crowd out source files", () => {
    const tickers = ["COTY", "OR", "EL", "ELF", "ULTA"];
    const kinds = [
      "Shares Outstanding",
      "Enterprise Value Capitalization",
      "Income Statement (Annual)",
      "Revenue Estimate",
      "Earnings Estimate",
      "Price History (Daily)",
    ];
    const files = kinds.flatMap((kind) => tickers.map((ticker) => sourceWorkbook(ticker, kind)));
    const sourcePacket: BankerToolBenchSourcePacket = {
      schema: "noderoom-btb-source-packet-v1",
      tickers,
      inputFiles: [
        sourceWorkbook("INPUT", "Equity Risk Premium"),
        sourceWorkbook("INPUT", "Betas by Industry"),
      ],
      mcpFiles: files,
      mcpCalls: files.flatMap((file, index) => Array.from({ length: 4 }, (_, copy) => ({
        tool: "vdr.download_to_workspace",
        symbol: file.path.match(/\/mcp\/([^/]+)\//)?.[1],
        data_type: file.name?.replace(/^[^-]+-US /, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase(),
        filepaths: [file.path, `${file.path}.copy-${index}-${copy}`],
      }))),
    };

    const compact = __bankerToolBenchGeneralTestHooks.compactSourcePacket(
      sourcePacket,
      24_000,
      "Build COTY trading comps vs OR, EL, ELF, and ULTA using market cap, shares outstanding, EV/Revenue, EV/EBITDA, and EBITDA margin.",
    );
    const coverageIndex = compact.mcpCoverageIndex as Array<{ ticker?: string; sourceType?: string; path?: string }> | undefined;
    const coverageTickers = new Set((coverageIndex ?? []).map((entry) => entry.ticker).filter(Boolean));
    const coverageTypes = new Set((coverageIndex ?? []).map((entry) => entry.sourceType).filter(Boolean));

    expect(JSON.stringify(compact).length).toBeLessThanOrEqual(24_000);
    expect(compact.mcpCallCount).toBe(sourcePacket.mcpCalls?.length);
    expect(compact.mcpCalls?.length).toBeLessThanOrEqual(40);
    expect([...coverageTickers].sort()).toEqual([...tickers].sort());
    expect([...coverageTypes]).toEqual(expect.arrayContaining(["shares_outstanding", "enterprise_value", "income_statement_annual", "revenue_estimate", "earnings_estimate", "price_history_daily"]));
  });

  it("routes GLM 5.2 through OpenRouter with priced context metadata", () => {
    expect(resolveModelAlias("glm-5.2")).toBe("z-ai/glm-5.2");
    expect(getProviderForModel("glm-5.2")).toBe("openrouter");
    expect(isValidModel("glm-5.2", "openrouter")).toBe(true);
    expect(getModelPricing("z-ai/glm-5.2")).toMatchObject({
      inputPer1M: 0.77,
      outputPer1M: 2.42,
      contextWindow: 1048576,
    });
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-btb-nodeagent-general-"));
  roots.push(root);
  return root;
}

function sourceWorkbook(ticker: string, kind: string): BtbSourceFileSummary {
  return {
    path: `/home/agent/workspace/banker_workspace/source/mcp/${ticker}/vdr/${ticker}-US ${kind}.xlsx`,
    name: `${ticker}-US ${kind}.xlsx`,
    kind: "xlsx",
    size: 10_000,
    sheets: [{
      name: "Sheet1",
      maxRow: 120,
      maxColumn: 6,
      cells: Array.from({ length: 120 }, (_, index) => ({
        address: `A${index + 1}`,
        value: `${kind} row ${index + 1} ${"x".repeat(50)}`,
      })),
    }],
  };
}

function minimalPlan(opts: {
  title: string;
  workbookSheets: Array<{ name: string; rows: string[][] }>;
  slides: string[];
}) {
  return {
    schema: "noderoom-btb-artifact-plan-v1" as const,
    title: opts.title,
    taskSummary: opts.title,
    deliverables: { workbook: true, presentation: true, memo: true, pdf: true },
    tickers: [],
    workbook: {
      sheets: opts.workbookSheets.map((sheet) => ({
        name: sheet.name,
        purpose: `${sheet.name} purpose`,
        rows: sheet.rows,
      })),
    },
    presentation: {
      slides: opts.slides.map((title) => ({
        title,
        bullets: [`${title} content`],
      })),
    },
    memo: { sections: [{ heading: "Summary", body: opts.title }] },
    citations: [{
      claim: "Source evidence reviewed",
      sourcePath: "/home/agent/workspace/source.pdf",
      locator: "page 1",
      boundaryBoxStatus: "paragraph" as const,
    }],
    risks: [],
  };
}
