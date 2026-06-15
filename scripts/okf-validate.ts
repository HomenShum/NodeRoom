import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { validateOkfBundleFiles, type OkfBundleFile } from "../src/nodeagent";

function walk(root: string, dir = root): OkfBundleFile[] {
  const files: OkfBundleFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(root, full));
    else if (entry.name.endsWith(".md")) files.push({ path: relative(root, full).replace(/\\/g, "/"), content: readFileSync(full, "utf8") });
  }
  return files;
}

const bundleRoot = process.argv[2] ?? "docs/okf/examples/startup-diligence-okf";
const issues = validateOkfBundleFiles(walk(bundleRoot));
if (issues.length) {
  console.error(JSON.stringify({ ok: false, bundleRoot, issues }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, bundleRoot }, null, 2));

