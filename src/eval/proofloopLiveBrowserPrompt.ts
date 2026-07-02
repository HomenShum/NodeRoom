export function withNodeAgentMention(goal: string): string {
  return /^\s*@nodeagent\b/i.test(goal) ? goal : `@nodeagent ${goal}`;
}

export function parseProofloopTaskIds(value: string | undefined): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of (value ?? "").split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function filterProofloopTasksByIds<T extends { id: string }>(
  tasks: T[],
  taskIds: string[],
  sourceLabel = "PROOFLOOP_TASK_IDS",
): T[] {
  if (taskIds.length === 0) return tasks;
  const available = new Set(tasks.map((task) => task.id));
  const unknown = taskIds.filter((id) => !available.has(id));
  if (unknown.length > 0) {
    throw new Error(`${sourceLabel} included unknown task id(s): ${unknown.join(", ")}. Available: ${[...available].join(", ")}`);
  }
  return tasks.filter((task) => taskIds.includes(task.id));
}

export function providerForAgentModelPolicy(modelPolicy: string): string {
  if (modelPolicy.startsWith("nebius/")) return "nebius";
  if (/^(gpt-|o\d|chatgpt-)/i.test(modelPolicy)) return "openai";
  if (/^claude/i.test(modelPolicy)) return "anthropic";
  if (/^gemini/i.test(modelPolicy)) return "gemini";
  return "openrouter";
}
