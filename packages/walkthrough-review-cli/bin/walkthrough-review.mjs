#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "src", "cli.ts");
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, ["tsx", cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
