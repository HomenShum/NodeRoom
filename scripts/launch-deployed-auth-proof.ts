import { spawnSync } from "node:child_process";
import { convexDeploymentFromUrl, validateDeployedProofInput } from "../src/launch/deployedProof";

const root = process.cwd();
const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const expectedAppCommit = process.env.LAUNCH_EXPECTED_APP_COMMIT?.trim();
const expectedBackendRevision = process.env.LAUNCH_EXPECTED_BACKEND_REVISION?.trim();
const expectedConvexUrl = process.env.LAUNCH_EXPECTED_CONVEX_URL?.trim();
const expectedConvexDeployment = convexDeploymentFromUrl(expectedConvexUrl);
const gitCommit = git(["rev-parse", "HEAD"]);
const gitBackendRevision = git(["rev-parse", "HEAD:convex"]);
const worktreeDirty = git(["status", "--porcelain"]).length > 0;

const errors = validateDeployedProofInput({
  deployedAuth: process.env.PLAYWRIGHT_DEPLOYED_AUTH,
  baseUrl,
  expectedAppCommit,
  expectedBackendRevision,
  expectedConvexUrl,
  gitCommit,
  gitBackendRevision,
  worktreeDirty,
});

if (errors.length) {
  console.error("deployed auth proof refused:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(2);
}

const program = process.platform === "win32" ? "npx.cmd" : "npx";
if (!expectedConvexDeployment) process.exit(2);
const functionSpec = spawnSync(program, ["tsx", "scripts/convex-deploy-verify.ts", "--deployment", expectedConvexDeployment], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
  stdio: "inherit",
  env: process.env,
});
if (functionSpec.status !== 0) {
  if (functionSpec.error) console.error(functionSpec.error.message);
  process.exit(functionSpec.status ?? 1);
}

const result = spawnSync(program, ["playwright", "test", "e2e/deployed-auth-first-user.spec.ts", "--project=chromium"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_REUSE_SERVER: "1",
    PLAYWRIGHT_RECORD_VIDEO: "1",
  },
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : "";
}
