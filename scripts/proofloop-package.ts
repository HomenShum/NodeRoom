import {
  buildProofloopPackageManifest,
  writeProofloopPackage,
  type ProofloopPackageTargetId,
} from "../src/eval/proofloopMultiRepoPackaging";

const TARGETS = new Set<ProofloopPackageTargetId>(["public-core", "private-hosted"]);

function main(): void {
  const args = process.argv.slice(2);
  const target = targetFromArgs(args);
  if (!target) {
    console.error("usage: npm run proofloop:package -- <public-core|private-hosted> [--copy] [--out <dir>] [--json]");
    process.exitCode = 1;
    return;
  }

  const manifest = buildProofloopPackageManifest(target);
  const result = writeProofloopPackage(manifest, {
    copyFiles: args.includes("--copy"),
    outDir: optionValue(args, "--out"),
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify({ manifest, result }, null, 2));
    return;
  }

  console.log(`proofloop package: ${manifest.target} -> ${result.packageRoot}`);
  console.log(`proofloop package: manifest ${result.manifestPath}`);
  console.log(`proofloop package: files ${manifest.fileCount}, bytes ${manifest.totalBytes}`);
  if (result.copiedFiles.length) console.log(`proofloop package: copied ${result.copiedFiles.length} file(s)`);
  if (manifest.requiredMissingComponents.length) {
    console.log("proofloop package: private/hosted components still missing");
    for (const component of manifest.requiredMissingComponents) console.log(`  - ${component}`);
  }
  console.log("proofloop package: publish commands");
  for (const command of manifest.publishCommands) console.log(`  ${command}`);
}

function targetFromArgs(args: string[]): ProofloopPackageTargetId | undefined {
  const first = args.find((arg) => !arg.startsWith("--"));
  return first && TARGETS.has(first as ProofloopPackageTargetId) ? first as ProofloopPackageTargetId : undefined;
}

function optionValue(args: string[], name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

main();
