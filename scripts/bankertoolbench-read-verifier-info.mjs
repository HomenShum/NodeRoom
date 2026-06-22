import { readFileSync } from "node:fs";

const infoPath = process.argv[2];
if (!infoPath) {
  console.error("Usage: node scripts/bankertoolbench-read-verifier-info.mjs <info.json>");
  process.exit(2);
}

const text = readFileSync(infoPath, "utf8");

function readScalar(key) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*([^,}\\r\\n]+)`));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

const unmetMatches = text.match(/"met"\s*:\s*false/g);

process.stdout.write(JSON.stringify({
  rawScore: readScalar("raw_score"),
  maximumScore: readScalar("maximum_score"),
  reward: readScalar("reward"),
  unmetCriteria: unmetMatches ? unmetMatches.length : 0,
}));
