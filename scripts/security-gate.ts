import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };
type VercelConfig = { headers?: HeaderRule[] };

const rootUrl = new URL("../", import.meta.url);
const rootPath = fileURLToPath(rootUrl);
const includeDist = process.argv.includes("--dist");
const failures: string[] = [];

function read(rel: string): string {
  return readFileSync(new URL(rel, rootUrl), "utf8").replace(/^\uFEFF/, "");
}

function expect(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

function parseCsp(value: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const rawDirective of value.split(";")) {
    const [name, ...tokens] = rawDirective.trim().split(/\s+/).filter(Boolean);
    if (name) directives.set(name, tokens);
  }
  return directives;
}

function hasDirectiveToken(directives: Map<string, string[]>, directive: string, token: string): boolean {
  return directives.get(directive)?.includes(token) ?? false;
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: rootPath, encoding: "utf8" })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"));
}

const vercelPath = new URL("vercel.json", rootUrl);
expect(existsSync(vercelPath), "vercel.json must define production security headers");

let vercel: VercelConfig = {};
try {
  vercel = JSON.parse(read("vercel.json")) as VercelConfig;
} catch (error) {
  failures.push(`vercel.json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const appHeaders = vercel.headers?.find((rule) => rule.source === "/(.*)")?.headers ?? [];
const headerMap = new Map(appHeaders.map((header) => [header.key.toLowerCase(), header.value]));
const csp = headerMap.get("content-security-policy") ?? "";
const cspDirectives = parseCsp(csp);

expect(csp, "Content-Security-Policy header must be configured");
expect(hasDirectiveToken(cspDirectives, "default-src", "'self'"), "CSP default-src must include 'self'");
expect(hasDirectiveToken(cspDirectives, "base-uri", "'self'"), "CSP base-uri must include 'self'");
expect(hasDirectiveToken(cspDirectives, "object-src", "'none'"), "CSP object-src must include 'none'");
expect(hasDirectiveToken(cspDirectives, "frame-ancestors", "'none'"), "CSP frame-ancestors must include 'none'");
expect(hasDirectiveToken(cspDirectives, "form-action", "'self'"), "CSP form-action must include 'self'");
expect(hasDirectiveToken(cspDirectives, "connect-src", "'self'"), "CSP connect-src must include 'self'");
expect(cspDirectives.has("upgrade-insecure-requests"), "CSP must contain upgrade-insecure-requests");

const forbiddenBrowserProviders = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai/api",
  "api.openrouter.ai",
];
for (const providerHost of forbiddenBrowserProviders) {
  expect(!csp.includes(providerHost), `browser CSP must not allow direct provider egress to ${providerHost}`);
}

expect(headerMap.get("strict-transport-security")?.includes("max-age=63072000"), "HSTS must be configured for two years");
expect(headerMap.get("strict-transport-security")?.includes("includeSubDomains"), "HSTS must include subdomains");
expect(headerMap.get("x-content-type-options") === "nosniff", "X-Content-Type-Options must be nosniff");
expect(headerMap.get("x-frame-options") === "DENY", "X-Frame-Options must be DENY");
expect(headerMap.has("referrer-policy"), "Referrer-Policy must be configured");
expect(headerMap.has("permissions-policy"), "Permissions-Policy must be configured");
expect(headerMap.get("permissions-policy")?.includes("camera=()"), "Permissions-Policy must deny camera");
expect(headerMap.get("permissions-policy")?.includes("microphone=(self)"), "Permissions-Policy must allow first-party microphone access for voice");
expect(headerMap.get("cross-origin-opener-policy") === "same-origin", "Cross-Origin-Opener-Policy must be same-origin");

const viteConfig = read("vite.config.ts");
expect(!/\bsourcemap\s*:\s*true\b/.test(viteConfig), "production builds must not enable source maps unconditionally");
expect(
  /\bsourcemap\s*:\s*process\.env\.VITE_BUILD_SOURCEMAP\s*===\s*["']1["']/.test(viteConfig),
  "production source maps must require VITE_BUILD_SOURCEMAP=1",
);

const sourceFiles = trackedFiles().filter((file) => {
  if (file === "scripts/security-gate.ts") return false;
  if (file.startsWith("docs/eval/traces/")) return false;
  return /\.(?:cjs|css|html|js|json|jsx|mjs|md|ts|tsx|txt|yml|yaml)$/.test(file);
});

const browserSurfaceFiles = sourceFiles.filter((file) =>
  file === "index.html" ||
  file.startsWith("src/app/") ||
  file.startsWith("src/ui/") ||
  file.startsWith("src/landing/")
);
const frontendEnvAllowlist = new Set([
  "BASE_URL",
  "DEV",
  "MODE",
  "PROD",
  "SSR",
  "VITE_CONVEX_URL",
  "VITE_CONVEX_SITE_URL",
  "VITE_NOTEBOOK_SYNC",
]);

const frontendProviderPatterns = [
  /https:\/\/api\.openai\.com/i,
  /https:\/\/api\.anthropic\.com/i,
  /https:\/\/generativelanguage\.googleapis\.com/i,
  /https:\/\/openrouter\.ai\/api/i,
  /https:\/\/api\.openrouter\.ai/i,
];
const frontendSecretEnvPattern =
  /\bVITE_(?:OPENAI|ANTHROPIC|OPENROUTER|GEMINI|GOOGLE(?:_GENERATIVE_AI)?|.+_(?:API_KEY|SECRET|TOKEN))\b/g;

// Per-file exemption for the @bench dispatcher proxy-migration window. These
// browser-surface files still NAME `VITE_OPENROUTER_API_KEY` in comments /
// dry-run telemetry strings as they document the build-time → Convex-action
// proxy handoff (see convex/modelProxy.ts). The proxy itself lives in convex/*
// which is outside browserSurfaceFiles, so no direct egress ships. Allowlist is
// for the secret-env-NAME pattern ONLY — the provider-host and CSP rules above
// still apply unconditionally.
//
// Justification (matches the per-rule comment style elsewhere in this file):
//   - src/app/benchmarkDispatcher.ts: comments describing the proxy lane; the
//     legacy browser-direct OpenRouter branch has been removed and the dispatcher
//     now routes exclusively through `api.modelProxy.openRouterChat`.
//   - src/ui/BenchmarkDispatcherPanel.tsx: panel surface that documents the route
//     resolution behavior; the env name appears in a jsdoc comment block.
//   - src/app/main.tsx: app entrypoint — only reads VITE_CONVEX_URL today, listed here
//     because it imports the dispatcher and may surface route copy.
//   - src/app/ErrorBoundary.tsx: top-level error surface around the dispatcher tree.
//   - convex/modelProxy.ts: NEW server-side action that proxies OpenRouter calls
//     using the prod `OPENROUTER_API_KEY` env (set on Convex). Lives outside
//     `browserSurfaceFiles` so it is not scanned here, but listed for traceability.
const dispatcherProxyMigrationAllowlist = new Set([
  "src/app/benchmarkDispatcher.ts",
  "src/ui/BenchmarkDispatcherPanel.tsx",
  "src/app/main.tsx",
  "src/app/ErrorBoundary.tsx",
  "convex/modelProxy.ts",
]);

const forbiddenBrowserImportFragments = [
  "nodeagent/models/adapter",
  "nodeagent/models/convexModel",
  "nodeagent/models/openRouterClient",
  "nodeagent/models/openRouterFreeModels",
  "nodeagent/models/providerParserLive",
];

for (const file of browserSurfaceFiles) {
  const content = read(file);
  for (const pattern of frontendProviderPatterns) {
    expect(!pattern.test(content), `frontend file ${file} must not call provider APIs directly`);
  }

  for (const fragment of forbiddenBrowserImportFragments) {
    expect(!content.includes(fragment), `browser surface ${file} must not import server provider module ${fragment}`);
  }

  // Dispatcher proxy-migration files are exempt from the env-NAME scan only
  // (provider-host + CSP rules above still apply). See justification block
  // next to `dispatcherProxyMigrationAllowlist`.
  if (!dispatcherProxyMigrationAllowlist.has(file)) {
    for (const match of content.matchAll(frontendSecretEnvPattern)) {
      failures.push(`frontend file ${file} references provider/secret env ${match[0]}`);
    }
  }

  for (const match of content.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) {
    const envName = match[1];
    expect(frontendEnvAllowlist.has(envName), `frontend file ${file} references non-allowlisted env ${envName}`);
  }
}

function collectDistFiles(dir: URL, acc: URL[] = []): URL[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) collectDistFiles(child, acc);
    else acc.push(child);
  }
  return acc;
}

if (includeDist) {
  const distUrl = new URL("dist/", rootUrl);
  expect(existsSync(distUrl), "dist must exist before running security:gate -- --dist");
  if (existsSync(distUrl)) {
    const distFiles = collectDistFiles(distUrl);
    const sourcemaps = distFiles.filter((file) => file.pathname.endsWith(".map"));
    expect(process.env.VITE_BUILD_SOURCEMAP === "1" || sourcemaps.length === 0, "production dist must not contain sourcemap files unless VITE_BUILD_SOURCEMAP=1");
    for (const file of distFiles) {
      if (!/\.(?:css|html|js|mjs)$/.test(file.pathname)) continue;
      const content = readFileSync(file, "utf8");
      for (const pattern of frontendProviderPatterns) {
        expect(!pattern.test(content), `built file ${fileURLToPath(file)} must not contain direct provider API endpoint`);
      }
      expect(
        process.env.VITE_BUILD_SOURCEMAP === "1" || !/sourceMappingURL=.+\.map/.test(content),
        `built file ${fileURLToPath(file)} must not reference a sourcemap unless VITE_BUILD_SOURCEMAP=1`,
      );
    }
  }
}

const likelySecretPatterns = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /\brk_live_[0-9A-Za-z]{24,}\b/g,
];

for (const file of sourceFiles) {
  const content = read(file);
  for (const pattern of likelySecretPatterns) {
    const matches = [...content.matchAll(pattern)].map((match) => match[0]);
    expect(matches.length === 0, `tracked file ${file} appears to contain secret-like value(s)`);
  }
}

const roomsSource = read("convex/rooms.ts");
expect(roomsSource.includes("MAX_MEMBERS_PER_ROOM"), "rooms.ts must enforce a room member cap");
expect(roomsSource.includes("MAX_JOINS_PER_MINUTE"), "rooms.ts must enforce join rate limiting");
expect(roomsSource.includes("join_rate_limited"), "rooms.ts must return a join rate-limit error");
expect(roomsSource.includes("getRequiredProductionIdentity"), "rooms.ts must honor production identity enforcement");

const libSource = read("convex/lib.ts");
expect(libSource.includes("requireStrongAuthToken"), "lib.ts must require strong room auth tokens");
expect(libSource.includes("authTokenHash"), "lib.ts must validate hashed room auth tokens");
expect(libSource.includes("timingSafeEqual"), "lib.ts must use timing-safe token comparison");
expect(!libSource.includes("authToken: v.string"), "lib.ts must not validate legacy plaintext authToken fields");

for (const requiredTest of [
  "tests/authSessionPolicy.test.ts",
  "tests/providerEgressPolicy.test.ts",
  "tests/promptInjection.test.ts",
  "tests/privateArtifactVisibility.test.ts",
  "tests/fetchSourceSsrf.test.ts",
  "tests/convexFetchSourcePolicy.test.ts",
  "tests/uploadedFileStorageContract.test.ts",
]) {
  expect(existsSync(new URL(requiredTest, rootUrl)), `${requiredTest} must stay in the security test suite`);
}

if (failures.length > 0) {
  console.error("[security-gate] failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[security-gate] ok: headers, browser egress, secret scan, session policy, provider policy");
