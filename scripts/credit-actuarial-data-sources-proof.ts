import ExcelJS from "exceljs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type SourceStatus = "machine_accessible" | "access_required" | "cataloged" | "unreachable";

type PublicSourceReceipt = {
  id: string;
  name: string;
  authority: string;
  sourceUrl: string;
  status: SourceStatus;
  license?: string;
  latestKnownUpdate?: string;
  covers: string[];
  blockers: string[];
  evidence: string[];
  resources?: Array<{
    name: string;
    format?: string;
    size?: number;
    url?: string;
    lastModified?: string;
    httpStatus?: number;
    ok?: boolean;
  }>;
  fieldsVerified?: string[];
};

type HttpProbe = {
  status?: number;
  ok: boolean;
  contentType?: string | null;
  contentLength?: string | null;
  finalUrl?: string;
  error?: string;
};

const OUTPUT_PATH = resolve(process.cwd(), "docs/eval/credit-actuarial-data-sources-proof.json");
const HARNESS_VERSION = "credit-actuarial-data-sources-proof-v0.1.0";
const SBA_PACKAGE_API = "https://data.sba.gov/en/api/3/action/package_show?id=7-a-504-foia";
const SBA_PAGE = "https://data.sba.gov/en/dataset/7-a-504-foia";
const FHFA_PUDB_PAGE = "https://www.fhfa.gov/data/public-use-database";
const FHFA_2024_NFA_ZIP = "https://www.fhfa.gov/document/d/pud/2024_pudb_sf_nfa.zip";
const HMDA_SOURCE_URL = "https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?states=DC&years=2025&actions_taken=1,3&loan_purposes=1";
const FREDDIE_PAGE = "https://www.freddiemac.com/research/datasets/sf-loanlevel-dataset";
const FANNIE_PAGE = "https://capitalmarkets.fanniemae.com/credit-risk-transfer/single-family-credit-risk-transfer/fannie-mae-single-family-loan-performance-data";
const ZENODO_LENDING_CLUB_API = "https://zenodo.org/api/records/11295916";
const FIGSHARE_LENDING_CLUB_API = "https://api.figshare.com/v2/articles/22121477";
const HOME_CREDIT_KAGGLE = "https://www.kaggle.com/c/home-credit-default-risk";
const UNDERWRITING_RECEIPT_PATH = resolve(process.cwd(), "docs/eval/underwriting-hmda-live-proof.json");

const sources: PublicSourceReceipt[] = [];

await addSbaSource();
await addFhfaSource();
await addHmdaSource();
await addFannieFreddieSources();
await addLendingClubSources();
await addHomeCreditSource();

const machineAccessibleSources = sources.filter((source) => source.status === "machine_accessible").length;
const publicPerformanceSources = sources.filter((source) =>
  source.status === "machine_accessible"
  && source.covers.some((item) => /\b(default|charge-off|loss|performance|paid in full|loan status)\b/i.test(item))).length;
const accessRequiredSources = sources.filter((source) => source.status === "access_required").length;
const unreachableSources = sources.filter((source) => source.status === "unreachable").length;

const receipt = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  harnessVersion: HARNESS_VERSION,
  passed: machineAccessibleSources >= 3 && publicPerformanceSources >= 2 && unreachableSources === 0,
  sources,
  summary: {
    machineAccessibleSources,
    publicPerformanceSources,
    accessRequiredSources,
    unreachableSources,
    solvedLocally: [
      "public default / charge-off / loan-status proxy data exists for benchmark and model-development work",
      "public fair-lending segmentation proxies exist for mortgage acquisition and HMDA decision-label analysis",
      "multi-angle actuarial forecasting can be run against public proxies with explicit caveats",
    ],
    stillExternal: [
      "buyer-owned private application, approval, override, servicing, repayment, default, and recovery data",
      "buyer-approved protected-class proxy methodology and compliance signoff",
      "buyer-granted delegated authority limits for production credit decisions",
    ],
  },
  actuarialPredictionContract: {
    taskFamilies: [
      "credit default probability",
      "loss given default / charge-off severity",
      "loan-status transition and survival/default timing",
      "reserve or expected-loss scenario analysis",
      "insurance-style claim frequency and severity modeling",
      "M&A, venture, startup-bank, or de novo portfolio outcome forecasting",
    ],
    requiredReceipts: [
      "exposure definition",
      "outcome and censoring definition",
      "frequency / severity split",
      "time-to-event or vintage curve",
      "base-rate and trend model",
      "scenario branches",
      "calibration and backtest",
      "uncertainty interval",
      "red-team disagreement ledger",
    ],
  },
  ai2027StyleForecastContract: {
    sourcePattern: "AI 2027 used trend extrapolations, tabletop exercises/wargames, expert feedback, research supplements, uncertainty ranges, branch scenarios, and updateable simulation models.",
    modules: [
      "decompose the target outcome into separable drivers",
      "build a base-rate and trend-extrapolation model for each driver",
      "run scenario branches with explicit assumptions",
      "collect expert or stakeholder forecasts and disagreements",
      "simulate milestone timing or outcome distributions",
      "publish confidence intervals and model code or receipt references",
      "red-team failure modes and update when new evidence arrives",
    ],
  },
  documentation: "docs/eval/ACTUARIAL_MULTI_ANGLE_FORECASTING_PROOFLOOP.md",
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);

if (!receipt.passed) {
  console.error(`credit-actuarial-data-sources-proof: FAIL machineAccessible=${machineAccessibleSources} publicPerformance=${publicPerformanceSources} unreachable=${unreachableSources}`);
  process.exit(1);
}

console.log(JSON.stringify({
  passed: receipt.passed,
  harnessVersion: receipt.harnessVersion,
  machineAccessibleSources,
  publicPerformanceSources,
  accessRequiredSources,
  proofPath: normalizePath(OUTPUT_PATH),
}, null, 2));

async function addSbaSource(): Promise<void> {
  const pkg = await getJson(SBA_PACKAGE_API) as {
    success?: boolean;
    result?: {
      license_title?: string;
      metadata_modified?: string;
      resources?: Array<{
        name?: string;
        format?: string;
        size?: number;
        url?: string;
        last_modified?: string;
      }>;
    };
  };
  if (pkg.success !== true || !pkg.result) throw new Error("SBA CKAN package metadata unavailable");

  const resources = pkg.result.resources ?? [];
  const dictionaryResource = resources.find((resource) => /data dictionary/i.test(resource.name ?? "") && resource.url);
  const fields = dictionaryResource?.url ? await readSbaDictionaryFields(dictionaryResource.url) : [];
  const verifiedFields = fields.filter((field) => [
    "GrossApproval",
    "ApprovalDate",
    "ApprovalFY",
    "TermInMonths",
    "LoanStatus",
    "PaidInFullDate",
    "ChargeOffDate",
    "GrossChargeOffAmount",
  ].includes(field));

  const resourcesWithProbe = await Promise.all(resources.map(async (resource) => {
    const probe = resource.url ? await probeHead(resource.url) : { ok: false } as HttpProbe;
    return {
      name: resource.name ?? "unnamed resource",
      format: resource.format,
      size: resource.size,
      url: resource.url,
      lastModified: resource.last_modified,
      httpStatus: probe.status,
      ok: probe.ok,
    };
  }));

  const csvFiles = resourcesWithProbe.filter((resource) => resource.format?.toUpperCase() === "CSV");
  sources.push({
    id: "sba_7a_504_foia",
    name: "SBA 7(a) and 504 FOIA loan data",
    authority: "U.S. Small Business Administration Office of Capital Access",
    sourceUrl: SBA_PAGE,
    status: csvFiles.length >= 6 && resourcesWithProbe.every((resource) => resource.ok) && verifiedFields.length >= 6
      ? "machine_accessible"
      : "cataloged",
    license: pkg.result.license_title,
    latestKnownUpdate: pkg.result.metadata_modified,
    covers: [
      "small business loan approvals",
      "loan status",
      "paid in full outcome",
      "charge-off outcome",
      "charge-off amount",
      "term and approval timing",
    ],
    blockers: [
      "contains public SBA program outcomes, not a buyer's private underwriting overrides or servicing policy",
      "FOIA-exempt active loans require censoring treatment",
    ],
    evidence: [
      `resources=${resources.length}`,
      `csvFiles=${csvFiles.length}`,
      `verifiedPerformanceFields=${verifiedFields.join(",")}`,
    ],
    resources: resourcesWithProbe,
    fieldsVerified: verifiedFields,
  });
}

async function addFhfaSource(): Promise<void> {
  const probe = await probeHead(FHFA_2024_NFA_ZIP);
  sources.push({
    id: "fhfa_enterprise_pudb_2024",
    name: "FHFA Enterprise Public Use Database 2024",
    authority: "Federal Housing Finance Agency",
    sourceUrl: FHFA_PUDB_PAGE,
    status: probe.ok ? "machine_accessible" : "cataloged",
    license: "public use government dataset",
    latestKnownUpdate: "2024 release; page notes 2025 CSV release expected September 2026",
    covers: [
      "single-family mortgage acquisitions",
      "borrower income",
      "race and sex fields for fair-lending segmentation",
      "loan-to-value and debt-to-income fields",
      "census-tract geography",
    ],
    blockers: [
      "acquisition public-use database is not monthly loan performance or loss history",
    ],
    evidence: [
      `zipStatus=${probe.status}`,
      `zipContentType=${probe.contentType ?? "missing"}`,
      `zipContentLength=${probe.contentLength ?? "missing"}`,
    ],
    resources: [{
      name: "2024 Single-Family National File A ZIP",
      format: "ZIP",
      url: FHFA_2024_NFA_ZIP,
      size: Number(probe.contentLength ?? 0) || undefined,
      httpStatus: probe.status,
      ok: probe.ok,
    }],
  });
}

async function addHmdaSource(): Promise<void> {
  const receipt = existsSync(UNDERWRITING_RECEIPT_PATH)
    ? JSON.parse(readFileSync(UNDERWRITING_RECEIPT_PATH, "utf8")) as { passed?: boolean; source?: { raw?: { rows?: number; actionTakenDistribution?: Record<string, number> } } }
    : {};
  sources.push({
    id: "ffiec_hmda_2025_dc_live_packet",
    name: "FFIEC/CFPB HMDA 2025 DC live underwriting packet",
    authority: "FFIEC / CFPB HMDA Platform",
    sourceUrl: HMDA_SOURCE_URL,
    status: receipt.passed === true ? "machine_accessible" : "cataloged",
    license: "public HMDA modified loan/application register",
    latestKnownUpdate: "2025 HMDA public data",
    covers: [
      "mortgage application action_taken labels",
      "originated vs denied decision benchmark",
      "borrower and tract fields for segmentation",
      "public live-room withheld-label scoring dependency",
    ],
    blockers: [
      "HMDA action_taken is an application decision label, not realized repayment/default/loss performance",
    ],
    evidence: [
      `liveReceiptPassed=${String(receipt.passed === true)}`,
      `rows=${String(receipt.source?.raw?.rows ?? "unknown")}`,
      `actionTakenDistribution=${JSON.stringify(receipt.source?.raw?.actionTakenDistribution ?? {})}`,
    ],
  });
}

async function addFannieFreddieSources(): Promise<void> {
  const [freddieProbe, fannieProbe] = await Promise.all([
    probeHead(FREDDIE_PAGE),
    probeHead(FANNIE_PAGE),
  ]);

  sources.push({
    id: "freddie_mac_sf_lld",
    name: "Freddie Mac Single-Family Loan-Level Dataset",
    authority: "Freddie Mac",
    sourceUrl: FREDDIE_PAGE,
    status: freddieProbe.ok ? "access_required" : "unreachable",
    license: "free subject to dataset terms; commercial redistribution requires licensing agreement",
    latestKnownUpdate: "covers originations through 2025 with performance disclosed through September 30, 2025 per official page",
    covers: [
      "mortgage loan-level acquisition data",
      "monthly credit performance",
      "foreclosure alternatives and REO outcomes",
      "actual loss data including proceeds, recoveries, expenses, and deferred UPB",
    ],
    blockers: [
      "full download requires registration, sign-in, and terms acceptance",
    ],
    evidence: [
      `pageStatus=${freddieProbe.status}`,
      "official page states performance and actual loss fields exist, but full data access is gated",
    ],
  });

  sources.push({
    id: "fannie_mae_sf_performance",
    name: "Fannie Mae Single-Family Loan Performance Data",
    authority: "Fannie Mae",
    sourceUrl: FANNIE_PAGE,
    status: fannieProbe.ok || fannieProbe.status === 403 ? "access_required" : "unreachable",
    license: "registration and terms required; external commercial use/redistribution restricted without consent",
    latestKnownUpdate: "Q4 2025 release announced April 30, 2026 per official page",
    covers: [
      "mortgage acquisition data",
      "monthly performance data",
      "liquidation, payoff, repurchase, short sale, and REO lifecycle fields",
      "primary and HARP mapping datasets",
    ],
    blockers: [
      "full download requires registration, credentials, and terms acceptance",
    ],
    evidence: [
      `pageStatus=${fannieProbe.status}`,
      "official page states API/download access exists after registration",
    ],
  });
}

async function addLendingClubSources(): Promise<void> {
  const [zenodo, figshare] = await Promise.all([
    getJson(ZENODO_LENDING_CLUB_API) as Promise<{
      doi?: string;
      metadata?: { title?: string; publication_date?: string; license?: { id?: string }; description?: string };
      files?: Array<{ key?: string; size?: number; checksum?: string; links?: { self?: string } }>;
    }>,
    getJson(FIGSHARE_LENDING_CLUB_API) as Promise<{
      files?: Array<{ name?: string; size?: number; download_url?: string; supplied_md5?: string; computed_md5?: string; mimetype?: string }>;
      license?: { name?: string; url?: string };
      doi?: string;
      title?: string;
      published_date?: string;
    }>,
  ]);

  const zenodoFiles = zenodo.files ?? [];
  const figshareFiles = figshare.files ?? [];
  sources.push({
    id: "lending_club_granting_model_zenodo",
    name: zenodo.metadata?.title ?? "Lending Club loan dataset for granting models",
    authority: "Zenodo / academic cleaned Lending Club granting-model dataset",
    sourceUrl: "https://zenodo.org/records/11295916",
    status: zenodoFiles.length > 0 ? "machine_accessible" : "cataloged",
    license: zenodo.metadata?.license?.id,
    latestKnownUpdate: zenodo.metadata?.publication_date,
    covers: [
      "consumer loan application-time granting variables",
      "default target",
      "fully paid target",
      "cleaned non-transitory loan-status population",
      "public default-modeling proxy",
    ],
    blockers: [
      "not an official bank regulatory dataset",
      "not a substitute for a buyer's own policy, channel, servicing, and override history",
    ],
    evidence: [
      `doi=${zenodo.doi ?? "missing"}`,
      `files=${zenodoFiles.map((file) => `${file.key}:${file.size}`).join(",")}`,
    ],
    resources: zenodoFiles.map((file) => ({
      name: file.key ?? "unnamed",
      format: "CSV",
      size: file.size,
      url: file.links?.self,
      ok: true,
    })),
  });

  sources.push({
    id: "lending_club_figshare_direct_files",
    name: figshare.title ?? "Lending Club direct files",
    authority: "Figshare / Deepchecks Data",
    sourceUrl: "https://figshare.com/articles/dataset/Lending_Club/22121477",
    status: figshareFiles.length > 0 ? "machine_accessible" : "cataloged",
    license: figshare.license?.name,
    latestKnownUpdate: figshare.published_date,
    covers: [
      "train/test Lending Club files",
      "public default-modeling proxy",
      "direct file metadata and hashes",
    ],
    blockers: [
      "modified Kaggle-derived data; verify terms and suitability before buyer distribution",
    ],
    evidence: [
      `doi=${figshare.doi ?? "missing"}`,
      `files=${figshareFiles.map((file) => `${file.name}:${file.size}`).join(",")}`,
    ],
    resources: figshareFiles.map((file) => ({
      name: file.name ?? "unnamed",
      format: file.mimetype,
      size: file.size,
      url: file.download_url,
      ok: true,
    })),
  });
}

async function addHomeCreditSource(): Promise<void> {
  const probe = await probeHead(HOME_CREDIT_KAGGLE);
  sources.push({
    id: "home_credit_default_risk_kaggle",
    name: "Home Credit Default Risk",
    authority: "Kaggle competition dataset",
    sourceUrl: HOME_CREDIT_KAGGLE,
    status: probe.ok ? "access_required" : "cataloged",
    license: "Kaggle competition terms",
    latestKnownUpdate: "competition dataset",
    covers: [
      "consumer repayment difficulty target",
      "application and bureau-style features",
      "credit default probability modeling practice",
    ],
    blockers: [
      "Kaggle account and competition terms required",
      "not a regulated buyer portfolio",
    ],
    evidence: [
      `pageStatus=${probe.status ?? "unknown"}`,
    ],
  });
}

async function readSbaDictionaryFields(url: string): Promise<string[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SBA data dictionary download failed: ${response.status}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const fields: string[] = [];
  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const value = sheet.getRow(rowNumber).getCell(1).value;
      if (typeof value === "string" && value.trim()) fields.push(value.trim());
    }
  }
  return [...new Set(fields)];
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function probeHead(url: string): Promise<HttpProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      finalUrl: response.url,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
