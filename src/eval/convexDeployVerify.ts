/**
 * Pure logic for the deploy self-verification guard (scripts/convex-deploy-verify.ts).
 * Split out so the diffing + source-scanning can be unit tested without a real
 * filesystem or a live Convex deployment — see convexDeployVerify.test.ts.
 */
import * as ts from "typescript";

const CONSTRUCTORS = new Set(["query", "internalQuery", "mutation", "internalMutation", "action", "internalAction"]);

/** Every exported `query`/`mutation`/`action` (public + internal) in one convex module's source,
 * as Convex's own `module.js:exportName` identifier format. Pure — takes source text, not a path. */
export function expectedIdentifiersFromSource(source: string, moduleName: string): string[] {
  const sourceFile = ts.createSourceFile(`${moduleName}.ts`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer || !ts.isCallExpression(decl.initializer)) continue;
        const call = decl.initializer;
        if (!ts.isIdentifier(call.expression) || !CONSTRUCTORS.has(call.expression.text)) continue;
        names.push(`${moduleName}.js:${decl.name.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

export type DeployVerifyDiff = {
  missing: string[];
  extra: string[];
  ok: boolean;
};

/** Compare what the working tree expects to be deployed against what actually is.
 * `missing` (expected but not deployed) is the hard-fail signal — the exact
 * silent-clobber pattern this guard exists to catch. `extra` (deployed but not
 * expected) is informational only: framework-component exports (workflow.define,
 * destructured component syncApi, etc.) never match the plain query/mutation/
 * action shape this scanner looks for, and a deploy that's genuinely AHEAD of
 * this working tree is not itself a failure. */
export function diffDeployState(expected: Iterable<string>, deployed: Iterable<string>): DeployVerifyDiff {
  const expectedSet = new Set(expected);
  const deployedSet = new Set(deployed);
  const missing = [...expectedSet].filter((id) => !deployedSet.has(id)).sort();
  const extra = [...deployedSet].filter((id) => !expectedSet.has(id)).sort();
  return { missing, extra, ok: missing.length === 0 };
}
