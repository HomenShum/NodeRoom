import type { OkfConcept } from "../../okf/types";

function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      i++;
    } else if (char === "*") {
      out += "[^/]*";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${out}$`);
}

export function okfGlob(concepts: OkfConcept[], pattern: string, limit = 50): OkfConcept[] {
  const re = globToRegExp(pattern);
  return concepts.filter((concept) => re.test(concept.path)).slice(0, limit);
}
