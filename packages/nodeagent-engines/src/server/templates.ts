/**
 * Project templates: fixtures/<id>/template.json plus starter files. A project
 * gets a copy of the starter files as its workspace and a Node-private state dir.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TemplateConfig } from "../contract.js";

export const PACKAGE_NAME = "@homenshum/nodeagent-engines";

/** Walks up from this module to the package root (works from src/ and dist/). */
export function packageRoot(from = dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      try {
        if ((JSON.parse(readFileSync(pj, "utf8")) as { name?: string }).name === PACKAGE_NAME) return dir;
      } catch {
        // unreadable package.json: keep walking
      }
    }
    if (dirname(dir) === dir) throw new Error(`Could not find the ${PACKAGE_NAME} package root above ${from}`);
  }
}

export function packageVersion(): string {
  return (JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")) as { version: string }).version;
}

export interface TemplateEntry {
  config: TemplateConfig;
  /** Directory holding template.json and the starter files. */
  dir: string;
  /** Absolute verifier path, when the template declares one. */
  verifierPath?: string;
}

export function loadTemplates(fixturesDir = join(packageRoot(), "fixtures"), log: (m: string) => void = () => {}): Map<string, TemplateEntry> {
  const out = new Map<string, TemplateEntry>();
  if (!existsSync(fixturesDir)) return out;
  for (const d of readdirSync(fixturesDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = join(fixturesDir, d.name);
    const file = join(dir, "template.json");
    if (!existsSync(file)) continue;
    try {
      const config = JSON.parse(readFileSync(file, "utf8")) as TemplateConfig;
      if (typeof config.id !== "string" || !config.id) throw new Error("missing id");
      config.restrictedGlobs ??= [];
      config.checks ??= {};
      const verifierPath = config.verifier ? resolve(dir, config.verifier) : undefined;
      if (verifierPath && !existsSync(verifierPath)) log(`template ${config.id}: verifier ${verifierPath} does not exist`);
      out.set(config.id, { config, dir, verifierPath });
    } catch (err) {
      log(`template ${file} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

export function projectDirs(home: string, projectId: string): { workspaceDir: string; nodeStateDir: string } {
  const root = join(home, "projects", projectId);
  return { workspaceDir: join(root, "workspace"), nodeStateDir: join(root, "node-state") };
}

/** Copies every starter file except template.json into a fresh workspace. */
export function materializeProject(home: string, projectId: string, template: TemplateEntry): { workspaceDir: string; nodeStateDir: string } {
  const dirs = projectDirs(home, projectId);
  mkdirSync(dirs.workspaceDir, { recursive: true });
  mkdirSync(dirs.nodeStateDir, { recursive: true });
  const skip = resolve(template.dir, "template.json");
  cpSync(template.dir, dirs.workspaceDir, { recursive: true, filter: (src) => resolve(src) !== skip });
  return dirs;
}
