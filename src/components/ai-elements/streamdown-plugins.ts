import { useEffect, useMemo, useState } from "react";
import type { PluginConfig } from "streamdown";

export type StreamdownPluginRequirements = {
  cjk: boolean;
  code: boolean;
  math: boolean;
  mermaid: boolean;
};

const EMPTY_PLUGINS: PluginConfig = Object.freeze({});

let cjkPlugin: Promise<NonNullable<PluginConfig["cjk"]>> | undefined;
let codePlugin: Promise<NonNullable<PluginConfig["code"]>> | undefined;
let mathPlugin: Promise<NonNullable<PluginConfig["math"]>> | undefined;
let mermaidPlugin: Promise<NonNullable<PluginConfig["mermaid"]>> | undefined;

export function streamdownPluginRequirements(content: string): StreamdownPluginRequirements {
  const mermaid = /(?:^|\n)\s*```\s*mermaid\b/i.test(content);
  return {
    cjk: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(content),
    code: mermaid || /(?:^|\n)\s*(?:```|~~~)/.test(content),
    math: /\$\$|\\\(|\\\[/.test(content),
    mermaid,
  };
}

function loadCjkPlugin() {
  cjkPlugin ??= import("@streamdown/cjk").then((module) => module.cjk);
  return cjkPlugin;
}

function loadCodePlugin() {
  codePlugin ??= import("@streamdown/code").then((module) => module.code);
  return codePlugin;
}

function loadMathPlugin() {
  mathPlugin ??= import("@streamdown/math").then((module) => module.math);
  return mathPlugin;
}

function loadMermaidPlugin() {
  mermaidPlugin ??= import("@streamdown/mermaid").then((module) => module.mermaid);
  return mermaidPlugin;
}

export function useStreamdownPlugins(content: string): PluginConfig {
  const requirements = useMemo(() => streamdownPluginRequirements(content), [content]);
  const signature = `${Number(requirements.cjk)}${Number(requirements.code)}${Number(requirements.math)}${Number(requirements.mermaid)}`;
  const [plugins, setPlugins] = useState<PluginConfig>(EMPTY_PLUGINS);

  useEffect(() => {
    let cancelled = false;
    const pending: Array<Promise<readonly [keyof PluginConfig, PluginConfig[keyof PluginConfig]]>> = [];
    if (requirements.cjk) pending.push(loadCjkPlugin().then((plugin) => ["cjk", plugin] as const));
    if (requirements.code) pending.push(loadCodePlugin().then((plugin) => ["code", plugin] as const));
    if (requirements.math) pending.push(loadMathPlugin().then((plugin) => ["math", plugin] as const));
    if (requirements.mermaid) pending.push(loadMermaidPlugin().then((plugin) => ["mermaid", plugin] as const));

    if (pending.length === 0) {
      setPlugins(EMPTY_PLUGINS);
      return () => { cancelled = true; };
    }

    void Promise.all(pending).then((entries) => {
      if (!cancelled) setPlugins(Object.fromEntries(entries) as PluginConfig);
    });
    return () => { cancelled = true; };
  }, [requirements, signature]);

  return plugins;
}
