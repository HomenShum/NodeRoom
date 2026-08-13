/**
 * Import-cycle check for the app and the backend.
 *
 * Why this file exists: `npx depcruise --validate` needs to know which folders
 * are "the product" and which file extensions to follow. Without it the tool
 * finds four modules and reports a clean run that means nothing.
 *
 * Run it:  npx dependency-cruiser@16 --validate src convex
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A imports B imports A. Module init order becomes load-order dependent, which fails in production and not in tests.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(_generated|node_modules|dist)(/|$)" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    },
  },
};
