export type BtbTaskCoverageResult = {
  ok: boolean;
  requiredTickers: string[];
  missingTickers: string[];
  domainProof: BtbDomainProofResult;
  detail: string;
};

export type BtbDomainProofGate = {
  id: string;
  label: string;
  passed: boolean;
};

export type BtbDomainProofResult = {
  ok: boolean;
  domain: "alphabet_dcf_sotp" | "generic";
  gates: BtbDomainProofGate[];
  missingGates: string[];
  detail: string;
};

const COMPANY_TICKER_ALIASES: Array<{ ticker: string; patterns: RegExp[]; surfaceForms: string[] }> = [
  { ticker: "DIS", patterns: [/\bDisney\b/i, /\bWalt\s+Disney\b/i, /\bDIS\b/], surfaceForms: ["DIS", "Disney", "Walt Disney"] },
  { ticker: "WBD", patterns: [/\bWarner\s+Bros\.?\s+Discovery\b/i, /\bWBD\b/], surfaceForms: ["WBD", "Warner Bros Discovery", "Warner Bros. Discovery"] },
  { ticker: "HLT", patterns: [/\bHilton\b/i, /\bHLT\b/], surfaceForms: ["HLT", "Hilton"] },
  { ticker: "LVS", patterns: [/\bLas\s+Vegas\s+Sands\b/i, /\bLVS\b/], surfaceForms: ["LVS", "Las Vegas Sands"] },
  { ticker: "FDX", patterns: [/\bFedEx\b/i, /\bFDX\b/], surfaceForms: ["FDX", "FedEx"] },
  { ticker: "NYT", patterns: [/\bNew\s+York\s+Times\b/i, /\bNYT\b/], surfaceForms: ["NYT", "New York Times"] },
  { ticker: "CRM", patterns: [/\bSalesforce\b/i, /\bCRM\b/], surfaceForms: ["CRM", "Salesforce"] },
  { ticker: "ADBE", patterns: [/\bAdobe\b/i, /\bADBE\b/], surfaceForms: ["ADBE", "Adobe"] },
  { ticker: "MSFT", patterns: [/\bMicrosoft\b/i, /\bMSFT\b/], surfaceForms: ["MSFT", "Microsoft"] },
  { ticker: "AMZN", patterns: [/\bAmazon\b/i, /\bAMZN\b/], surfaceForms: ["AMZN", "Amazon"] },
  { ticker: "GOOGL", patterns: [/\bAlphabet\b/i, /\bGoogle\b/i, /\bGOOGL\b/, /\bGOOG\b/], surfaceForms: ["GOOGL", "GOOG", "Alphabet", "Google"] },
  { ticker: "INTC", patterns: [/\bIntel\b/i, /\bIntel\s+Corporation\b/i, /\bINTC\b/], surfaceForms: ["INTC", "Intel", "Intel Corporation"] },
  { ticker: "META", patterns: [/\bMeta\b/i, /\bMeta\s+Inc\.?\b/i, /\bFacebook\b/i, /\bMETA\b/], surfaceForms: ["META", "Meta", "Facebook"] },
  { ticker: "NVDA", patterns: [/\bNvidia\b/i, /\bNVIDIA\b/i, /\bNVDA\b/], surfaceForms: ["NVDA", "Nvidia", "NVIDIA"] },
  { ticker: "ORCL", patterns: [/\bOracle\b/i, /\bORCL\b/], surfaceForms: ["ORCL", "Oracle"] },
];

const BTB_UPPERCASE_EXCLUSIONS = new Set([
  "API",
  "BTB",
  "CAGR",
  "CEO",
  "CFO",
  "CIO",
  "COGS",
  "COO",
  "CIRC",
  "CSV",
  "CTO",
  "CY",
  "DCF",
  "DOCX",
  "EBIT",
  "EBITDA",
  "EPS",
  "ERP",
  "EV",
  "FY",
  "IPO",
  "IRR",
  "LBO",
  "LLM",
  "LTM",
  "MD",
  "MCP",
  "NWC",
  "PDF",
  "PE",
  "PIK",
  "PPT",
  "PPTX",
  "QA",
  "QTD",
  "SEC",
  "SG",
  "SOTP",
  "TMT",
  "TTM",
  "TEV",
  "UI",
  "USA",
  "US",
  "VDR",
  "VP",
  "WACC",
  "FX",
  "GDP",
  "NYU",
  "XLSM",
  "XLSX",
  "XIRR",
  "XYZ",
  "YYA",
  "YYE",
  "YTD",
  "LTGR",
  "PP",
]);

export function inferOfficialBtbTickers(instruction: string): string[] {
  const out = new Set<string>();
  for (const { ticker, patterns } of COMPANY_TICKER_ALIASES) {
    if (patterns.some((pattern) => pattern.test(instruction))) out.add(ticker);
  }
  for (const match of instruction.matchAll(/\b[A-Z]{1,5}(?:\.[A-Z])?\b/g)) {
    const token = match[0];
    if (token.length === 1 || BTB_UPPERCASE_EXCLUSIONS.has(token)) continue;
    out.add(token === "GOOG" ? "GOOGL" : token);
  }
  return [...out];
}

export function evaluateBtbTaskCoverage(instruction: string, generatedArtifactText: string): BtbTaskCoverageResult {
  const requiredTickers = inferOfficialBtbTickers(instruction);
  const domainProof = evaluateBtbDomainProof(instruction, generatedArtifactText);
  if (requiredTickers.length <= 1) {
    return {
      ok: domainProof.ok,
      requiredTickers,
      missingTickers: [],
      domainProof,
      detail: requiredTickers.length === 0
        ? `no multi-entity ticker coverage gate required; ${domainProof.detail}`
        : `single requested ticker detected (${requiredTickers[0]}); multi-entity coverage gate not required; ${domainProof.detail}`,
    };
  }
  const normalizedText = normalizeBtbCoverageText(generatedArtifactText);
  const missingTickers = requiredTickers.filter((ticker) => !mentionsRequiredTicker(normalizedText, ticker));
  return {
    ok: missingTickers.length === 0 && domainProof.ok,
    requiredTickers,
    missingTickers,
    domainProof,
    detail: missingTickers.length === 0
      ? `generated package mentions every requested ticker/entity: ${requiredTickers.join(", ")}; ${domainProof.detail}`
      : `generated package is missing requested ticker/entity coverage: ${missingTickers.join(", ")}; required=${requiredTickers.join(", ")}; ${domainProof.detail}`,
  };
}

export function evaluateBtbDomainProof(instruction: string, generatedArtifactText: string): BtbDomainProofResult {
  if (!isAlphabetDcfSotpInstruction(instruction)) {
    return {
      ok: true,
      domain: "generic",
      gates: [],
      missingGates: [],
      detail: "no task-specific domain proof gate required",
    };
  }
  const text = normalizeBtbCoverageText(generatedArtifactText);
  const gates: BtbDomainProofGate[] = [
    gate("alphabet_identity", "Alphabet / Google / GOOGL identity", /(^|[^a-z0-9])(alphabet|google|googl|goog)([^a-z0-9]|$)/i.test(text)),
    gate("dcf_sotp_method", "DCF and SOTP methodology", /(dcf|discounted cash flow)/i.test(text) && /(sotp|sum[-\s]+of[-\s]+the[-\s]+parts)/i.test(text)),
    gate("operating_model_periods", "Operating model with historical and forecast periods", /(operating model|three[-\s]+statement|financials summary)/i.test(text) && /2022/i.test(text) && /2024/i.test(text) && /2030/i.test(text)),
    gate("segment_level_model", "Segment-level Google Services / Cloud / Other Bets model", /google services/i.test(text) && /google cloud/i.test(text) && /(other bets|other segments)/i.test(text)),
    gate("wacc_terminal_assumptions", "WACC and terminal-growth assumptions", /wacc/i.test(text) && /(terminal growth|ltgr|terminal)/i.test(text)),
    gate("valuation_output", "Enterprise/equity value and per-share output", /(enterprise value|equity value|segment enterprise values?)/i.test(text) && /(share price|per[-\s]+share|upside|downside)/i.test(text)),
  ];
  const missingGates = gates.filter((item) => !item.passed).map((item) => item.id);
  return {
    ok: missingGates.length === 0,
    domain: "alphabet_dcf_sotp",
    gates,
    missingGates,
    detail: missingGates.length === 0
      ? "Alphabet DCF/SOTP domain proof passed"
      : `Alphabet DCF/SOTP domain proof missing gates: ${missingGates.join(", ")}`,
  };
}

export function assertBtbTaskCoverage(instruction: string, generatedArtifactText: string): BtbTaskCoverageResult {
  const result = evaluateBtbTaskCoverage(instruction, generatedArtifactText);
  if (!result.ok) {
    throw new Error(`BTB task coverage gate failed: ${result.detail}`);
  }
  return result;
}

function mentionsRequiredTicker(normalizedText: string, ticker: string): boolean {
  const alias = COMPANY_TICKER_ALIASES.find((item) => item.ticker === ticker);
  const surfaceForms = alias?.surfaceForms ?? [ticker];
  return surfaceForms.some((surface) => hasTokenLikeSurface(normalizedText, surface));
}

function hasTokenLikeSurface(text: string, surface: string): boolean {
  const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?:-US)?([^A-Za-z0-9]|$)`, "i").test(text);
}

function normalizeBtbCoverageText(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isAlphabetDcfSotpInstruction(instruction: string): boolean {
  return /alphabet|google|googl|goog/i.test(instruction) && /(sotp|sum[-\s]+of[-\s]+the[-\s]+parts|dcf|discounted cash flow)/i.test(instruction);
}

function gate(id: string, label: string, passed: boolean): BtbDomainProofGate {
  return { id, label, passed };
}
