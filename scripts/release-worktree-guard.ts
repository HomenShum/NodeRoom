import { spawnSync } from "node:child_process";

function git(...args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", shell: true });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
    process.exit(1);
  }
  return result.stdout.trim();
}

const status = git("status", "--porcelain=v1", "--untracked-files=all");
if (status) {
  console.error("[release-guard] Refusing production deploy from a dirty worktree.");
  console.error(status.split(/\r?\n/).slice(0, 30).join("\n"));
  process.exit(1);
}

const branch = git("branch", "--show-current");
const head = git("rev-parse", "HEAD");
if (!branch) {
  console.error("[release-guard] Refusing production deploy from a detached HEAD.");
  process.exit(1);
}

console.log(`[release-guard] OK - clean ${branch} at ${head.slice(0, 12)}.`);
