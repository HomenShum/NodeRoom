import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

type RoutePerf = {
  url: string;
  status: number | null;
  title: string;
  metrics: {
    domContentLoadedMs: number | null;
    loadEventMs: number | null;
    firstContentfulPaintMs: number | null;
    largestContentfulPaintMs: number | null;
    cumulativeLayoutShift: number;
    transferSizeBytes: number;
    encodedBodySizeBytes: number;
  };
  budgets: {
    lcpGoodMs: number;
    clsGood: number;
    loadEventBudgetMs: number;
  };
  statusText: "pass" | "warn" | "fail";
  findings: string[];
};

type PerfReport = {
  generatedAt: string;
  baseUrl: string;
  routes: RoutePerf[];
};

const ROOT = process.cwd();
const args = process.argv.slice(2);
const baseUrl = (optionValue("--base-url") ?? process.env.PLAYWRIGHT_BASE_URL ?? process.env.SEO_BASE_URL ?? "http://127.0.0.1:5260").replace(/\/$/, "");
const routes = optionValues("--route");
const targetRoutes = routes.length ? routes : ["/", "/use-cases/", "/pricing/", "/faq/"];
const jsonOut = optionValue("--json-out") ?? join(ROOT, "docs", "seo", "performance-check.latest.json");
const mdOut = optionValue("--md-out") ?? join(ROOT, "docs", "seo", "PERFORMANCE_QA_REPORT.md");

const browser = await chromium.launch({ headless: true });
try {
  const report: PerfReport = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    routes: [],
  };
  for (const route of targetRoutes) {
    report.routes.push(await auditRoute(browser, route));
  }
  writeJson(jsonOut, report);
  writeText(mdOut, renderMarkdown(report));
  console.log(`wrote ${slash(relative(ROOT, jsonOut))} and ${slash(relative(ROOT, mdOut))}`);
  if (report.routes.some((route) => route.statusText === "fail")) process.exitCode = 1;
} finally {
  await browser.close();
}

async function auditRoute(browser: Browser, route: string): Promise<RoutePerf> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  await installPerfObservers(page);
  const response = await page.goto(urlFor(route), { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const title = await page.title();
  const metrics = await collectMetrics(page);
  await page.close();
  const findings: string[] = [];
  const budgets = { lcpGoodMs: 2500, clsGood: 0.1, loadEventBudgetMs: 3500 };
  if (metrics.largestContentfulPaintMs !== null && metrics.largestContentfulPaintMs > budgets.lcpGoodMs) {
    findings.push(`LCP ${Math.round(metrics.largestContentfulPaintMs)}ms exceeds ${budgets.lcpGoodMs}ms`);
  }
  if (metrics.cumulativeLayoutShift > budgets.clsGood) {
    findings.push(`CLS ${metrics.cumulativeLayoutShift.toFixed(3)} exceeds ${budgets.clsGood}`);
  }
  if (metrics.loadEventMs !== null && metrics.loadEventMs > budgets.loadEventBudgetMs) {
    findings.push(`load event ${Math.round(metrics.loadEventMs)}ms exceeds ${budgets.loadEventBudgetMs}ms`);
  }
  if (!response?.ok()) findings.push(`HTTP status ${response?.status() ?? "unknown"}`);
  return {
    url: urlFor(route),
    status: response?.status() ?? null,
    title,
    metrics,
    budgets,
    statusText: findings.some((finding) => /^HTTP|LCP|CLS/.test(finding)) ? "fail" : findings.length ? "warn" : "pass",
    findings,
  };
}

async function installPerfObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as typeof window & {
      __seoPerf?: {
        fcp: number | null;
        lcp: number | null;
        cls: number;
      };
    };
    win.__seoPerf = { fcp: null, lcp: null, cls: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "first-contentful-paint") win.__seoPerf!.fcp = entry.startTime;
        }
      }).observe({ type: "paint", buffered: true });
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) win.__seoPerf!.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
          if (!entry.hadRecentInput) win.__seoPerf!.cls += entry.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Older browsers or restricted contexts may not expose all observers.
    }
  });
}

async function collectMetrics(page: Page): Promise<RoutePerf["metrics"]> {
  return await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const perf = (window as typeof window & { __seoPerf?: { fcp: number | null; lcp: number | null; cls: number } }).__seoPerf;
    return {
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd - nav.startTime : null,
      loadEventMs: nav ? nav.loadEventEnd - nav.startTime : null,
      firstContentfulPaintMs: perf?.fcp ?? null,
      largestContentfulPaintMs: perf?.lcp ?? null,
      cumulativeLayoutShift: perf?.cls ?? 0,
      transferSizeBytes: resources.reduce((sum, entry) => sum + entry.transferSize, nav?.transferSize ?? 0),
      encodedBodySizeBytes: resources.reduce((sum, entry) => sum + entry.encodedBodySize, nav?.encodedBodySize ?? 0),
    };
  });
}

function renderMarkdown(report: PerfReport): string {
  const lines: string[] = [];
  lines.push("# Performance QA Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Base URL: \`${report.baseUrl}\``);
  lines.push("");
  lines.push("> This is a Playwright lab check for Core Web Vitals-style budgets. Use Lighthouse or field data for final production claims.");
  lines.push("");
  lines.push("## Budgets");
  lines.push("");
  lines.push("- LCP good threshold: <= 2500ms");
  lines.push("- CLS good threshold: < 0.1");
  lines.push("- Load event lab budget: <= 3500ms");
  lines.push("");
  lines.push("## Routes");
  lines.push("");
  lines.push("| Route | Status | HTTP | FCP | LCP | CLS | Load | Transfer | Findings |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---|");
  for (const route of report.routes) {
    lines.push(`| \`${route.url.replace(report.baseUrl, "") || "/"}\` | ${route.statusText} | ${route.status ?? ""} | ${ms(route.metrics.firstContentfulPaintMs)} | ${ms(route.metrics.largestContentfulPaintMs)} | ${route.metrics.cumulativeLayoutShift.toFixed(3)} | ${ms(route.metrics.loadEventMs)} | ${bytes(route.metrics.transferSizeBytes)} | ${route.findings.length ? route.findings.map(escapeMd).join("; ") : "none"} |`);
  }
  lines.push("");
  lines.push("## Lighthouse");
  lines.push("");
  lines.push("Run this against a built preview or production URL when Lighthouse CLI/Chrome are available:");
  lines.push("");
  lines.push("```bash");
  lines.push("npx --yes lighthouse@latest http://127.0.0.1:5260/ --output=json --output=html --output-path=docs/seo/lighthouse-root --chrome-flags=\"--headless=new --no-sandbox\"");
  lines.push("```");
  lines.push("");
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

function urlFor(route: string): string {
  if (/^https?:\/\//i.test(route)) return route;
  return `${baseUrl}${route.startsWith("/") ? "" : "/"}${route}`;
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (inline !== undefined) return inline;
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function optionValues(name: string): string[] {
  const out: string[] = [];
  const prefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(prefix)) out.push(args[i].slice(prefix.length));
    else if (args[i] === name && args[i + 1] && !args[i + 1].startsWith("--")) out.push(args[++i]);
  }
  return out;
}

function ms(value: number | null): string {
  return value === null ? "" : `${Math.round(value)}ms`;
}

function bytes(value: number): string {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value > 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function slash(path: string): string {
  return path.replace(/\\/g, "/");
}
