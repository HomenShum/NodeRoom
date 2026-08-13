import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The onboarding walkthrough (docs/START_HERE.md and .tours/) cites code by
 * location. A guard that only checks the cited LINE NUMBER IS IN RANGE proves
 * anchor stability and never anchor correctness: it stays green while a step
 * points at the wrong symbol in the right file. So every citation here has to
 * carry the thing it claims to be pointing at, and this file asserts the cited
 * line MATCHES it.
 *
 *   .tours/*.tour   -> each step carries `pattern`; the cited line must match it.
 *                     CodeTour itself only reads `pattern` when `line` is absent,
 *                     so `line` stays authoritative for the extension and
 *                     `pattern` is the correctness anchor for this test.
 *   START_HERE.md   -> `**Symbol:**` must occur in a file the step cites, every
 *                     ```lang block must be quoted from the file it names, and a
 *                     `path:line` citation must be preceded by the substring
 *                     that line has to contain.
 */

const fileLines = (path: string): string[] => readFileSync(path, "utf8").split(/\r?\n/);

const backticked = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);

const citedPaths = (text: string): string[] => backticked(text).filter((t) => t.includes("/") && existsSync(t));

describe(".tours steps cite the line they claim", () => {
  const tours = readdirSync(".tours").filter((f) => f.endsWith(".tour"));
  expect(tours.length, "no tours found").toBeGreaterThan(0);

  for (const name of tours) {
    const tour = JSON.parse(readFileSync(`.tours/${name}`, "utf8")) as {
      steps: { file?: string; line?: number; pattern?: string; title?: string }[];
    };
    tour.steps.forEach((step, i) => {
      it(`${name} step ${i + 1} — ${step.title ?? "(untitled)"}`, () => {
        expect(step.file, "step must cite a file").toBeTruthy();
        expect(existsSync(step.file!), `${step.file} does not exist`).toBe(true);
        expect(step.line, "step must cite a line").toBeGreaterThan(0);
        // A line number alone only proves the anchor is in range. `pattern` is what
        // proves it is the RIGHT anchor.
        expect(step.pattern, "step must carry a `pattern` the cited line has to match").toBeTruthy();
        const lines = fileLines(step.file!);
        expect(lines.length, `${step.file} has no line ${step.line}`).toBeGreaterThanOrEqual(step.line!);
        expect(lines[step.line! - 1], `${step.file}:${step.line} does not match /${step.pattern}/`).toMatch(
          new RegExp(step.pattern!),
        );
      });
    });
  }
});

describe("START_HERE.md cites the code it claims", () => {
  const doc = readFileSync("docs/START_HERE.md", "utf8");
  const steps = doc.split(/\n(?=## )/).filter((s) => s.startsWith("## Step "));
  expect(steps.length, "no steps found").toBeGreaterThan(0);

  for (const step of steps) {
    const heading = step.split("\n", 1)[0].replace(/^##\s*/, "");
    const paths = citedPaths(/^\*\*File:\*\*(.+)$/m.exec(step)?.[1] ?? "");
    const blocks = [...step.matchAll(/\*\*Core code\*\*([^\n]*)\n```([^\n]*)\n([\s\S]*?)\n```/g)];

    it(`${heading} — cited files exist and the step has an anchor`, () => {
      const declared = backticked(/^\*\*File:\*\*(.+)$/m.exec(step)?.[1] ?? "").filter((t) => t.includes("/"));
      for (const p of declared) expect(existsSync(p), `${p} does not exist`).toBe(true);
      expect(paths.length, "step cites no file").toBeGreaterThan(0);
      const symbol = backticked(/^\*\*Symbol:\*\*(.+)$/m.exec(step)?.[1] ?? "")[0];
      const languageBlocks = blocks.filter((b) => b[2].trim().length > 0);
      expect(
        Boolean(symbol) || languageBlocks.length > 0,
        "step must carry a `**Symbol:**` or a fenced code block to check",
      ).toBe(true);
    });

    const symbol = backticked(/^\*\*Symbol:\*\*(.+)$/m.exec(step)?.[1] ?? "")[0];
    if (symbol) {
      it(`${heading} — \`${symbol}\` is in a file the step cites`, () => {
        const needle = symbol.split(".").pop()!;
        const found = paths.filter((p) => readFileSync(p, "utf8").includes(needle));
        expect(found, `${needle} is in none of ${paths.join(", ")}`).not.toHaveLength(0);
      });
    }

    blocks.forEach(([, suffix, lang, body], i) => {
      if (!lang.trim()) return; // a language-less fence is prose, not a quotation
      const source = citedPaths(suffix)[0] ?? paths[0];
      const quoted = body.split("\n").find((l) => l.trim().length > 0)!.trim();
      it(`${heading} — code block ${i + 1} is quoted from ${source}`, () => {
        expect(readFileSync(source, "utf8"), `${source} does not contain: ${quoted}`).toContain(quoted);
      });
    });
  }

  it("the documented dev URL is the one `npm run dev` actually serves", () => {
    const url = /npm run dev\s+# (http:\/\/[^\s]+)/.exec(doc)?.[1];
    expect(url, "START_HERE.md must document the dev URL next to `npm run dev`").toBeTruthy();
    const port = /server: \{\s*\n\s*port: (\d+)/.exec(readFileSync("vite.config.ts", "utf8"))?.[1];
    expect(url).toBe(`http://localhost:${port}`);
    // Not 127.0.0.1: Vite binds the single address `localhost` resolves to, which on
    // Windows is ::1 — a documented 127.0.0.1 URL there refuses the connection.
  });

  it("every `path:line` citation names what that line must contain", () => {
    const all = backticked(doc).filter((t) => /^[^\s]+\/[^\s]+:\d+$/.test(t));
    const anchored = [...doc.matchAll(/`([^`\n]+)`\s*\(`([^`\n]+\/[^`\n]+):(\d+)`/g)];
    expect(
      anchored.length,
      `a \`path:line\` citation must be written as \`anchor\` (\`path:line\`); found ${all.length} citation(s), ${anchored.length} anchored`,
    ).toBe(all.length);
    for (const [, anchor, path, line] of anchored) {
      expect(existsSync(path), `${path} does not exist`).toBe(true);
      const lines = fileLines(path);
      const n = Number(line);
      expect(lines.length, `${path} has no line ${n}`).toBeGreaterThanOrEqual(n);
      expect(lines[n - 1], `${path}:${n} does not contain: ${anchor}`).toContain(anchor);
    }
  });
});
