import "../../../scripts/benchmark/loadEnv";

import { createSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

type SearchAnalyticsRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

type SearchAnalyticsResponse = {
  rows?: SearchAnalyticsRow[];
};

type SearchConsoleReport = {
  generatedAt: string;
  siteUrl: string;
  startDate: string;
  endDate: string;
  dryRun: boolean;
  dimensions: string[];
  queryRows: NormalizedRow[];
  pageRows: NormalizedRow[];
  opportunities: {
    poorCtrQueries: NormalizedRow[];
    impressionPages: NormalizedRow[];
  };
};

type NormalizedRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

const ROOT = process.cwd();
const args = process.argv.slice(2);
const dryRun = hasFlag("--dry-run");
const siteUrl = optionValue("--site-url") ?? process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL ?? "https://noderoom.live/";
const endDate = optionValue("--end-date") ?? isoDate(daysAgo(3));
const startDate = optionValue("--start-date") ?? isoDate(daysAgo(31));
const rowLimit = numberOption("--row-limit", 250);
const jsonOut = optionValue("--json-out") ?? join(ROOT, "docs", "seo", "search-console.latest.json");
const mdOut = optionValue("--md-out") ?? join(ROOT, "docs", "seo", "SEARCH_CONSOLE_REPORT.md");

const report = dryRun ? dryReport() : await liveReport();
writeJson(jsonOut, report);
writeText(mdOut, renderMarkdown(report));
console.log(`wrote ${slash(relative(ROOT, jsonOut))} and ${slash(relative(ROOT, mdOut))}`);

async function liveReport(): Promise<SearchConsoleReport> {
  const token = await accessToken();
  const queryRows = await fetchRows(token, ["query"]);
  const pageRows = await fetchRows(token, ["page"]);
  return buildReport(queryRows, pageRows, false);
}

function dryReport(): SearchConsoleReport {
  return buildReport([
    { keys: ["collaborative ai room"], clicks: 6, impressions: 420, ctr: 0.0142, position: 18.4 },
    { keys: ["startup diligence ai"], clicks: 2, impressions: 210, ctr: 0.0095, position: 24.1 },
  ], [
    { keys: ["https://noderoom.live/"], clicks: 8, impressions: 510, ctr: 0.0156, position: 19.3 },
    { keys: ["https://noderoom.live/use-cases/startups/"], clicks: 1, impressions: 140, ctr: 0.0071, position: 28.2 },
  ], true);
}

function buildReport(queryRows: NormalizedRow[], pageRows: NormalizedRow[], isDryRun: boolean): SearchConsoleReport {
  const poorCtrQueries = queryRows
    .filter((row) => row.impressions >= 50 && row.ctr < 0.02)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);
  const impressionPages = pageRows
    .filter((row) => row.impressions >= 50 && row.clicks <= 2)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);
  return {
    generatedAt: new Date().toISOString(),
    siteUrl,
    startDate,
    endDate,
    dryRun: isDryRun,
    dimensions: ["query", "page"],
    queryRows,
    pageRows,
    opportunities: { poorCtrQueries, impressionPages },
  };
}

async function fetchRows(token: string, dimensions: string[]): Promise<NormalizedRow[]> {
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions,
      rowLimit,
      startRow: 0,
    }),
  });
  if (!response.ok) throw new Error(`Search Console request failed: ${response.status} ${await response.text()}`);
  const body = await response.json() as SearchAnalyticsResponse;
  return (body.rows ?? []).map(normalizeRow);
}

function normalizeRow(row: SearchAnalyticsRow): NormalizedRow {
  return {
    keys: row.keys ?? [],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  };
}

async function accessToken(): Promise<string> {
  const envToken = process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN?.trim();
  if (envToken) return envToken;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
    ?? process.env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!credentialsPath) {
    throw new Error("Set GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS for Search Console API access. Use --dry-run to test output shape.");
  }
  if (!existsSync(credentialsPath)) throw new Error(`Search Console credential file not found: ${credentialsPath}`);
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8")) as { client_email?: string; private_key?: string; token_uri?: string };
  if (!credentials.client_email || !credentials.private_key) throw new Error("Service account JSON must include client_email and private_key");
  const assertion = serviceAccountJwt(credentials.client_email, credentials.private_key);
  const tokenResponse = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`OAuth token request failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
  const body = await tokenResponse.json() as { access_token?: string };
  if (!body.access_token) throw new Error("OAuth token response did not include access_token");
  return body.access_token;
}

function serviceAccountJwt(clientEmail: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(privateKey, "base64url")}`;
}

function renderMarkdown(report: SearchConsoleReport): string {
  const lines: string[] = [];
  lines.push("# Search Console Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Site: \`${report.siteUrl}\``);
  lines.push(`Date range: ${report.startDate} to ${report.endDate}`);
  lines.push(`Dry run: ${report.dryRun ? "yes" : "no"}`);
  lines.push("");
  lines.push("> This report uses Google Search Console data. It does not scrape Google results or simulate clicks.");
  lines.push("");
  lines.push("## Queries");
  lines.push("");
  lines.push(table(report.queryRows));
  lines.push("");
  lines.push("## Landing Pages");
  lines.push("");
  lines.push(table(report.pageRows));
  lines.push("");
  lines.push("## CTR Opportunities");
  lines.push("");
  lines.push(table(report.opportunities.poorCtrQueries));
  lines.push("");
  lines.push("## Page Opportunities");
  lines.push("");
  lines.push(table(report.opportunities.impressionPages));
  lines.push("");
  return lines.join("\n");
}

function table(rows: NormalizedRow[]): string {
  const lines = ["| Keys | Clicks | Impressions | CTR | Avg position |", "|---|---:|---:|---:|---:|"];
  if (!rows.length) lines.push("| none | 0 | 0 | 0.00% | 0.0 |");
  for (const row of rows.slice(0, 25)) {
    lines.push(`| ${escapeMd(row.keys.join(" / "))} | ${row.clicks} | ${row.impressions} | ${(row.ctr * 100).toFixed(2)}% | ${row.position.toFixed(1)} |`);
  }
  return lines.join("\n");
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function numberOption(name: string, fallback: number): number {
  const value = optionValue(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 25000) throw new Error(`${name} must be an integer from 1 to 25000`);
  return parsed;
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (inline !== undefined) return inline;
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function slash(path: string): string {
  return path.replace(/\\/g, "/");
}
