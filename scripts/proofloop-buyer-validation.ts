import {
  buildProofloopBuyerValidationKit,
  renderProofloopBuyerValidationMarkdown,
  writeProofloopBuyerValidationKit,
} from "../src/eval/proofloopBuyerValidation";

function main(): void {
  const args = process.argv.slice(2);
  const kit = buildProofloopBuyerValidationKit();

  if (args.includes("--json")) {
    console.log(JSON.stringify(kit, null, 2));
    return;
  }

  if (args.includes("--stdout-md")) {
    console.log(renderProofloopBuyerValidationMarkdown(kit));
    return;
  }

  const result = writeProofloopBuyerValidationKit(kit, {
    outDir: optionValue(args, "--out"),
  });

  console.log(`proofloop buyer validation: ${result.markdownPath}`);
  console.log(`proofloop buyer validation: ${result.jsonPath}`);
  console.log(`proofloop buyer validation: ${kit.questions.length} questions`);
  console.log(`proofloop buyer validation: ${kit.oneLiner}`);
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
