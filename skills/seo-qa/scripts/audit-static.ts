import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

type AuditStatus = "pass" | "warn" | "fail";

type AuditFinding = {
  status: AuditStatus;
  check: string;
  detail: string;
  path?: string;
};

type RouteAudit = {
  route: string;
  path: string;
  exists: boolean;
  title?: string;
  description?: string;
  h1Count?: number;
  canonical?: string;
};

type AuditReport = {
  generatedAt: string;
  baseUrl: string;
  summary: Record<AuditStatus, number>;
  routes: RouteAudit[];
  findings: AuditFinding[];
};

const ROOT = process.cwd();
const args = process.argv.slice(2);
const baseUrl = (optionValue("--base-url") ?? process.env.SEO_BASE_URL ?? "https://noderoom.live").replace(/\/$/, "");
const jsonOut = optionValue("--json-out") ?? join(ROOT, "docs", "seo", "seo-audit.latest.json");
const mdOut = optionValue("--md-out") ?? join(ROOT, "docs", "seo", "SEO_AUDIT.md");
const writeDocs = !hasFlag("--no-write");

const PUBLIC_ROUTES = [
  "/",
  "/brand/noderoom/",
  "/solutions/",
  "/solutions/collaborative-ai-workspace/",
  "/solutions/ai-agent-collaboration/",
  "/solutions/source-backed-ai-workflows/",
  "/solutions/ai-diligence-room/",
  "/solutions/ai-research-workspace/",
  "/use-cases/",
  "/use-cases/startups/",
  "/use-cases/sales/",
  "/use-cases/finance/",
  "/use-cases/students/",
  "/compare/slack-ai/",
  "/compare/notion-ai/",
  "/compare/google-docs/",
  "/blog/",
  "/learn/",
  "/pricing/",
  "/faq/",
];

const PRIVATE_PATTERNS = [
  "/*?room=",
  "/*?demo=",
  "/*?create=",
];

const report = buildReport();

if (writeDocs) {
  writeJson(jsonOut, report);
  writeText(mdOut, renderMarkdown(report));
}

console.log(renderConsole(report));
if (report.findings.some((finding) => finding.status === "fail")) process.exitCode = 1;

function buildReport(): AuditReport {
  const findings: AuditFinding[] = [];
  const routes = PUBLIC_ROUTES.map((route) => auditRoute(route, findings));
  auditRoot(findings);
  auditSitemap(routes, findings);
  auditRobots(findings);
  auditLlmsTxt(findings);
  auditAiCrawlerAccess(findings);
  auditPrivateRouteGuard(findings);
  const summary = countBy(findings, (finding) => finding.status);
  for (const status of ["pass", "warn", "fail"] as const) summary[status] ??= 0;
  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    summary: summary as Record<AuditStatus, number>,
    routes,
    findings,
  };
}

function auditRoute(route: string, findings: AuditFinding[]): RouteAudit {
  const publicRoutePath = route.replace(/^\/+|\/+$/g, "");
  const path = route === "/" ? join(ROOT, "index.html") : join(ROOT, "public", publicRoutePath, "index.html");
  const rel = slash(relative(ROOT, path));
  if (!existsSync(path)) {
    findings.push({ status: "fail", check: "route_exists", detail: `${route} is missing`, path: rel });
    return { route, path: rel, exists: false };
  }
  const html = readFileSync(path, "utf8");
  const title = textTag(html, "title");
  const description = metaContent(html, "description");
  const canonical = linkHref(html, "canonical");
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  pushRequired(findings, Boolean(title), "title", `${route} has a title`, `${route} is missing a title`, rel);
  pushRequired(findings, Boolean(description), "meta_description", `${route} has a meta description`, `${route} is missing a meta description`, rel);
  pushRequired(findings, Boolean(canonical), "canonical", `${route} has a canonical URL`, `${route} is missing a canonical URL`, rel);
  pushRequired(findings, h1Count === 1, "single_h1", `${route} has one H1`, `${route} has ${h1Count} H1 elements`, rel);
  if (description && description.length > 165) {
    findings.push({ status: "warn", check: "meta_description_length", detail: `${route} description is ${description.length} chars`, path: rel });
  }
  if (canonical && !canonical.startsWith(baseUrl)) {
    findings.push({ status: "warn", check: "canonical_base", detail: `${route} canonical does not start with ${baseUrl}`, path: rel });
  }
  return { route, path: rel, exists: true, title, description, h1Count, canonical };
}

function auditRoot(findings: AuditFinding[]): void {
  const path = join(ROOT, "index.html");
  const html = existsSync(path) ? readFileSync(path, "utf8") : "";
  pushRequired(findings, /property=["']og:title["']/i.test(html), "og_title", "Root has OG title", "Root is missing OG title", "index.html");
  pushRequired(findings, /name=["']twitter:card["']/i.test(html), "twitter_card", "Root has Twitter card", "Root is missing Twitter card", "index.html");
  pushRequired(findings, /application\/ld\+json/i.test(html), "json_ld", "Root has JSON-LD", "Root is missing JSON-LD", "index.html");
}

function auditSitemap(routes: RouteAudit[], findings: AuditFinding[]): void {
  const path = join(ROOT, "public", "sitemap.xml");
  if (!existsSync(path)) {
    findings.push({ status: "fail", check: "sitemap", detail: "public/sitemap.xml is missing", path: "public/sitemap.xml" });
    return;
  }
  const xml = readFileSync(path, "utf8");
  for (const route of routes) {
    const loc = `${baseUrl}${route.route === "/" ? "/" : route.route}`;
    pushRequired(findings, xml.includes(`<loc>${loc}</loc>`), "sitemap_route", `Sitemap includes ${route.route}`, `Sitemap missing ${loc}`, "public/sitemap.xml");
  }
}

function auditRobots(findings: AuditFinding[]): void {
  const path = join(ROOT, "public", "robots.txt");
  if (!existsSync(path)) {
    findings.push({ status: "fail", check: "robots", detail: "public/robots.txt is missing", path: "public/robots.txt" });
    return;
  }
  const text = readFileSync(path, "utf8");
  pushRequired(findings, /Sitemap:\s*https?:\/\//i.test(text), "robots_sitemap", "robots.txt points to sitemap", "robots.txt does not point to a sitemap", "public/robots.txt");
  for (const pattern of PRIVATE_PATTERNS) {
    pushRequired(findings, text.includes(pattern), "robots_private_disallow", `robots.txt disallows ${pattern}`, `robots.txt does not disallow ${pattern}`, "public/robots.txt");
  }
}

function auditLlmsTxt(findings: AuditFinding[]): void {
  const path = join(ROOT, "public", "llms.txt");
  if (!existsSync(path)) {
    findings.push({ status: "warn", check: "llms_txt", detail: "public/llms.txt is missing", path: "public/llms.txt" });
    return;
  }
  const text = readFileSync(path, "utf8");
  pushRequired(findings, /^#\s+\S+/m.test(text), "llms_txt_h1", "llms.txt has an H1 title", "llms.txt is missing a Markdown H1 title", "public/llms.txt");
  pushRequired(findings, text.includes("https://noderoom.live/brand/noderoom/"), "llms_txt_brand", "llms.txt includes brand/entity page", "llms.txt is missing the brand/entity page", "public/llms.txt");
  pushRequired(findings, text.includes("https://noderoom.live/solutions/"), "llms_txt_solutions", "llms.txt includes solutions hub", "llms.txt is missing the solutions hub", "public/llms.txt");
}

function auditAiCrawlerAccess(findings: AuditFinding[]): void {
  const path = join(ROOT, "public", "robots.txt");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const crawler of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot"]) {
    const crawlerBlock = new RegExp(`User-agent:\\s*${escapeRegex(crawler)}[\\s\\S]*?Allow:\\s*/`, "i");
    pushRequired(findings, crawlerBlock.test(text), "ai_crawler_allow", `robots.txt explicitly allows ${crawler}`, `robots.txt does not explicitly allow ${crawler}`, "public/robots.txt");
  }
}

function auditPrivateRouteGuard(findings: AuditFinding[]): void {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  pushRequired(
    findings,
    /noindex,nofollow/.test(html) && /room\|demo\|create/.test(html),
    "private_noindex_guard",
    "Root shell has private-route noindex guard",
    "Root shell is missing private-route noindex guard",
    "index.html",
  );
}

function renderConsole(input: AuditReport): string {
  return [
    `SEO audit ${input.generatedAt}`,
    `baseUrl=${input.baseUrl}`,
    `pass=${input.summary.pass} warn=${input.summary.warn} fail=${input.summary.fail}`,
    `wrote=${writeDocs ? slash(relative(ROOT, jsonOut)) + ", " + slash(relative(ROOT, mdOut)) : "disabled"}`,
  ].join("\n");
}

function renderMarkdown(input: AuditReport): string {
  const lines: string[] = [];
  lines.push("# NodeRoom SEO Audit");
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push(`Base URL: \`${input.baseUrl}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Pass: ${input.summary.pass}`);
  lines.push(`- Warn: ${input.summary.warn}`);
  lines.push(`- Fail: ${input.summary.fail}`);
  lines.push("");
  lines.push("## Routes");
  lines.push("");
  lines.push("| Route | File | Title | Description | H1 | Canonical |");
  lines.push("|---|---|---|---|---:|---|");
  for (const route of input.routes) {
    lines.push(`| \`${route.route}\` | \`${route.path}\` | ${cell(route.title)} | ${cell(route.description)} | ${route.h1Count ?? 0} | ${cell(route.canonical)} |`);
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  lines.push("| Status | Check | Path | Detail |");
  lines.push("|---|---|---|---|");
  for (const finding of input.findings) {
    lines.push(`| ${finding.status} | \`${finding.check}\` | ${finding.path ? `\`${finding.path}\`` : ""} | ${escapeMd(finding.detail)} |`);
  }
  lines.push("");
  lines.push("## Next Measurement");
  lines.push("");
  lines.push("- Run `PLAYWRIGHT_RECORD_VIDEO=1 npm run test:journeys` for recorded landing and app flows.");
  lines.push("- Run Lighthouse against a built preview or production URL for LCP, INP, and CLS evidence.");
  lines.push("- Run `npm run seo:search-console` after deployment when Search Console credentials are available.");
  lines.push("");
  return lines.join("\n");
}

function pushRequired(findings: AuditFinding[], ok: boolean, check: string, pass: string, fail: string, path: string): void {
  findings.push({ status: ok ? "pass" : "fail", check, detail: ok ? pass : fail, path });
}

function textTag(html: string, tag: string): string | undefined {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

function metaContent(html: string, name: string): string | undefined {
  const match = html.match(new RegExp(`<meta\\s+[^>]*name=["']${escapeRegex(name)}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"))
    ?? html.match(new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*name=["']${escapeRegex(name)}["'][^>]*>`, "i"));
  return match?.[1]?.trim();
}

function linkHref(html: string, rel: string): string | undefined {
  const match = html.match(new RegExp(`<link\\s+[^>]*rel=["']${escapeRegex(rel)}["'][^>]*href=["']([^"']+)["'][^>]*>`, "i"))
    ?? html.match(new RegExp(`<link\\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']${escapeRegex(rel)}["'][^>]*>`, "i"));
  return match?.[1]?.trim();
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[keyFn(item)] = (out[keyFn(item)] ?? 0) + 1;
  return out;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
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

function cell(value: string | undefined): string {
  return value ? escapeMd(value) : "";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function slash(path: string): string {
  return path.replace(/\\/g, "/");
}
