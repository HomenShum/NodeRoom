import { describe, expect, it } from "vitest";
import { evaluateBtbDomainProof, evaluateBtbTaskCoverage, inferOfficialBtbTickers } from "../src/eval/btbTaskCoverage";

describe("BTB task coverage", () => {
  const softwarePeerInstruction = [
    "Build a trading comps package for the high-growth software peer set:",
    "Adobe, Amazon, Salesforce, Google, Intel, Meta, Microsoft, Nvidia, and Oracle.",
    "Use ticker-level source files and create xlsx, xlsm, pptx, docx, and pdf outputs.",
  ].join(" ");

  it("infers named BTB company tickers from the official task instruction", () => {
    expect(inferOfficialBtbTickers(softwarePeerInstruction)).toEqual([
      "CRM",
      "ADBE",
      "MSFT",
      "AMZN",
      "GOOGL",
      "INTC",
      "META",
      "NVDA",
      "ORCL",
    ]);
  });

  it("passes when generated artifact text covers every requested ticker/entity", () => {
    const result = evaluateBtbTaskCoverage(
      softwarePeerInstruction,
      "Rows: ADBE AMZN CRM GOOGL INTC META MSFT NVDA ORCL with revenue, EBITDA, EPS, and trading multiple outputs.",
    );

    expect(result).toMatchObject({ ok: true, missingTickers: [] });
  });

  it("fails a one-company package for a multi-company task", () => {
    const result = evaluateBtbTaskCoverage(
      softwarePeerInstruction,
      "ORCL package created successfully with Oracle revenue estimates, sourceArtifactIds:8, and package files.",
    );

    expect(result.ok).toBe(false);
    expect(result.missingTickers).toEqual(["CRM", "ADBE", "MSFT", "AMZN", "GOOGL", "INTC", "META", "NVDA"]);
    expect(result.detail).toContain("missing requested ticker/entity coverage");
  });

  it("does not treat banking roles or finance mechanics as required company coverage", () => {
    const instruction = [
      "Your VP in the TMT team at XYZ bank asked for an ADBE profile.",
      "The MD also wants PE ownership notes, SG&A, PIK interest, TEV, and XIRR sensitivities.",
    ].join(" ");

    expect(inferOfficialBtbTickers(instruction)).toEqual(["ADBE"]);
  });

  it("does not treat deliverable formats as requested company coverage", () => {
    const instruction = [
      "Prepare an updated trading comp table for COTY.",
      "The comparable companies are OR, EL, ELF, and ULTA.",
      "Build the comps in Excel, paste into PPT, and export to PDF as a one page Rider.",
    ].join(" ");

    expect(inferOfficialBtbTickers(instruction)).toEqual(["COTY", "OR", "EL", "ELF", "ULTA"]);
  });

  it("does not treat valuation assumptions as peer entities", () => {
    const instruction = [
      "Prepare a preliminary DCF for P&G with WACC at 8.0% and LTGR at 2.0%.",
      "Create the full Excel model, PowerPoint slides, and PDF output.",
    ].join(" ");

    expect(inferOfficialBtbTickers(instruction)).toEqual([]);
  });

  it("does not treat Alphabet SOTP methodology and macro source acronyms as peer entities", () => {
    const instruction = [
      "Build an Alphabet / Google SOTP valuation with GOOGL-US source files.",
      "Use NYU beta, USA ERP, FX, GDP, PP, YYA, and YYE assumptions where relevant.",
      "Output a DCF and SOTP package for the single company.",
    ].join(" ");

    expect(inferOfficialBtbTickers(instruction)).toEqual(["GOOGL"]);
    expect(evaluateBtbTaskCoverage(instruction, [
      "Alphabet GOOGL DCF and SOTP package created.",
      "Operating model includes 2022, 2024, 2025E, and 2030E forecast periods.",
      "Segment model covers Google Services, Google Cloud, and Other Bets.",
      "WACC and terminal growth drive enterprise value, equity value, share price, and upside/downside.",
    ].join(" ")).ok).toBe(true);
  });

  it("fails Alphabet packages that are only WACC-shaped instead of DCF/SOTP operating models", () => {
    const instruction = [
      "Build a DCF Sum-of-the-Parts valuation for Alphabet Inc. (Google).",
      "Include a three-statement operating model, segment-level DCF, and implied upside/downside.",
    ].join(" ");

    const result = evaluateBtbDomainProof(
      instruction,
      "Alphabet Inc. WACC Analysis and Valuation Framework. Cost of equity, ERP, beta, and after-tax cost of debt.",
    );

    expect(result.ok).toBe(false);
    expect(result.domain).toBe("alphabet_dcf_sotp");
    expect(result.missingGates).toEqual(expect.arrayContaining([
      "dcf_sotp_method",
      "operating_model_periods",
      "segment_level_model",
      "valuation_output",
    ]));
  });

  it("passes Alphabet DCF/SOTP packages with operating model, segments, WACC, and per-share valuation proof", () => {
    const instruction = [
      "Build a DCF Sum-of-the-Parts valuation for Alphabet Inc. (Google).",
      "Use historical 2022-2024 annuals, Q1-Q3 2025 actuals, Q4 2025E, and 2026E-2030E forecasts.",
    ].join(" ");

    const result = evaluateBtbTaskCoverage(instruction, [
      "Alphabet Inc. (GOOGL) DCF Sum-of-the-Parts valuation.",
      "Three-statement operating model and financials summary for 2022A, 2024A, 2025E, and 2030E.",
      "Segment-level model: Google Services, Google Cloud, and Other Bets.",
      "WACC and terminal growth assumptions drive segment enterprise values.",
      "Equity value bridge produces implied share price and upside/downside.",
    ].join(" "));

    expect(result.ok).toBe(true);
    expect(result.domainProof).toMatchObject({
      ok: true,
      domain: "alphabet_dcf_sotp",
      missingGates: [],
    });
  });
});
