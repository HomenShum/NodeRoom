import { writeProofloopChartPack } from "../src/eval/proofloopChartPack";

const args = process.argv.slice(2);
const target = optionValue("--run") ?? optionValue("--target") ?? positional() ?? "latest";
const outDir = optionValue("--out-dir") ?? "docs/eval/proofloop-charts";
const strict = args.includes("--strict");

const result = writeProofloopChartPack({
  target,
  outDir,
  generatedAt: new Date().toISOString(),
});

console.log(`proofloop charts: json ${result.paths.json}`);
console.log(`proofloop charts: markdown ${result.paths.markdown}`);
console.log(`proofloop charts: html ${result.paths.html}`);
for (const [name, path] of Object.entries(result.paths.specs)) {
  console.log(`proofloop charts: spec ${name} ${path}`);
}
for (const [name, path] of Object.entries(result.paths.data)) {
  console.log(`proofloop charts: data ${name} ${path}`);
}
for (const [name, path] of Object.entries(result.paths.svgs)) {
  console.log(`proofloop charts: ${name} ${path}`);
}
for (const artifact of result.paths.runArtifacts) {
  console.log(`proofloop charts: run json ${artifact.json}`);
  console.log(`proofloop charts: run html ${artifact.html}`);
}

if (strict && (!result.validation.ok || result.pack.summary.workflowItems === 0)) {
  for (const error of result.validation.errors) console.error(`proofloop charts: validation ${error}`);
  if (result.pack.summary.workflowItems === 0) console.error("proofloop charts: no workflow items found");
  process.exitCode = 1;
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function positional(): string | undefined {
  return args.find((arg) => !arg.startsWith("--"));
}
