export type UiLayerAuditScope = "all" | "primitives" | "motion";

export type UiLayerFinding = {
  file: string;
  packageName: string;
  reason: string;
};

export type UiLayerAuditResult = {
  ok: boolean;
  checkedFiles: number;
  findings: UiLayerFinding[];
};

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const RADIX_AI_ELEMENT_EXCEPTIONS = new Set([
  "src/components/ai-elements/reasoning.tsx",
]);

export function auditUiLayerImports(
  files: Record<string, string>,
  scope: UiLayerAuditScope = "all",
): UiLayerAuditResult {
  const findings: UiLayerFinding[] = [];

  for (const [rawFile, source] of Object.entries(files)) {
    const file = normalizePath(rawFile);
    for (const packageName of importsFrom(source)) {
      if (scope !== "motion") auditPrimitiveImport(file, packageName, findings);
      if (scope !== "primitives") auditMotionImport(file, packageName, findings);
      auditVendorBusinessBoundary(file, packageName, findings);
    }
  }

  return { ok: findings.length === 0, checkedFiles: Object.keys(files).length, findings };
}

function auditPrimitiveImport(file: string, packageName: string, findings: UiLayerFinding[]) {
  if (!isRadixImport(packageName)) return;
  if (file.startsWith("src/components/ui/")) return;
  if (packageName === "@radix-ui/react-use-controllable-state" && RADIX_AI_ELEMENT_EXCEPTIONS.has(file)) return;
  findings.push({
    file,
    packageName,
    reason: "Radix behavior must be wrapped by src/components/ui; AI Elements has only the one recorded controllable-state exception.",
  });
}

function auditMotionImport(file: string, packageName: string, findings: UiLayerFinding[]) {
  const effectBoundary = file.startsWith("src/components/effects/react-bits/");
  const aiElementsBoundary = file.startsWith("src/components/ai-elements/");
  const motionBoundary = file.startsWith("src/motion/");
  const vantaBoundary = file.startsWith("src/components/backgrounds/vanta/");

  if (isPackage(packageName, "gsap") || isPackage(packageName, "@gsap/react")) {
    if (!motionBoundary) findings.push({ file, packageName, reason: "GSAP imports belong only in src/motion." });
    return;
  }
  if (isPackage(packageName, "lenis") || isPackage(packageName, "@studio-freight/lenis")) {
    if (!motionBoundary) findings.push({ file, packageName, reason: "Lenis imports belong only in the route-scoped src/motion provider." });
    return;
  }
  if (isPackage(packageName, "vanta") || isPackage(packageName, "three")) {
    if (!vantaBoundary) findings.push({ file, packageName, reason: "Vanta and its renderer belong only in the lazy background wrapper." });
    return;
  }
  if (isPackage(packageName, "motion") || isPackage(packageName, "framer-motion")) {
    if (!motionBoundary && !effectBoundary && !aiElementsBoundary) findings.push({ file, packageName, reason: "Motion imports belong in src/motion, AI Elements, or a reviewed React Bits effect." });
    return;
  }
  if (packageName.startsWith("@react-bits/")) {
    if (!effectBoundary) findings.push({ file, packageName, reason: "React Bits recipes belong only in src/components/effects/react-bits." });
  }
}

function auditVendorBusinessBoundary(file: string, packageName: string, findings: UiLayerFinding[]) {
  const vendorBoundary = file.startsWith("src/components/ui/")
    || file.startsWith("src/components/effects/react-bits/")
    || file.startsWith("src/components/backgrounds/vanta/")
    || file.startsWith("src/motion/");
  if (!vendorBoundary) return;

  if (
    packageName === "convex"
    || packageName.startsWith("convex/")
    || /(?:^|\/)convex(?:\/|$)/.test(packageName)
    || /(?:^|\/)nodeagent(?:\/|$)/i.test(packageName)
    || /(?:^|\/)app\/store(?:\.|$)/.test(packageName)
  ) {
    findings.push({
      file,
      packageName,
      reason: "Vendor UI and motion layers receive product state through props; they may not own Convex or NodeAgent behavior.",
    });
  }
}

function importsFrom(source: string): string[] {
  const imports = new Set<string>();
  for (const match of source.matchAll(IMPORT_RE)) {
    const packageName = match[1] ?? match[2];
    if (packageName) imports.add(packageName);
  }
  return [...imports];
}

function isRadixImport(packageName: string): boolean {
  return packageName === "radix-ui" || packageName.startsWith("@radix-ui/");
}

function isPackage(packageName: string, root: string): boolean {
  return packageName === root || packageName.startsWith(`${root}/`);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
