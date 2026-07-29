import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OBSERVATION_DIR = "design-dna/observations";
const RULES_PATH = "design-dna/rules.yaml";
const SCORE_RECEIPT_DIR = "design-dna/score-receipts";
const RENDER_RECEIPT_PATH =
  "evidence/investigation-mode-vertical-slice/reference-render-receipt.json";
const BANNED_VIBE_WORDS =
  /\b(clean|beautiful|modern|premium|delightful|polished|good ux)\b/i;
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const FACT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface ParsedReferenceFact {
  id: string;
  kind: string;
  subject: string;
  property: string;
  value: string;
  locatorDescription: string;
  raw: string;
}

export interface ParsedReferenceObservation {
  id: string;
  sourceUrl: string;
  app: string;
  surface: string;
  capturedVia: string;
  firstSeenAt: string;
  lastVerifiedAt: string;
  facts: ParsedReferenceFact[];
  problemTags: string[];
  intentTags: string[];
  layoutTags: string[];
  interactionTags: string[];
  pixelsStoredFalse: boolean;
  originPath: string;
}

export interface ParsedDesignRule {
  id: string;
  evidence: string[];
  originPath: string;
}

export interface ScoreCriterion {
  id: string;
  score: number;
  maxScore: number;
  citations: string[];
}

export interface ScoreReceipt {
  schemaVersion: string;
  id: string;
  surface: string;
  ruleIds: string[];
  scale: { min: number; max: number };
  criteria: ScoreCriterion[];
  score: number;
  citedFacts: string[];
  humanReview: { status: string };
  evidence: {
    exactLocalScreenshot: ScreenshotEvidence;
    durableScreenshot: ScreenshotEvidence;
  };
  originPath: string;
}

export interface ScreenshotEvidence {
  path: string;
  sha256: string;
  gating: boolean;
}

export interface ReferenceRenderReceipt {
  schemaVersion: string;
  receiptId: string;
  referenceProvenance: {
    observationFacts: Array<{ observationId: string; factIds: string[] }>;
    designRuleIds: string[];
    scoreReceipt: { id: string; path: string };
    humanReview: { status: string };
  };
  capture: {
    exactLocalScreenshot: ScreenshotEvidence;
    durableScreenshot: ScreenshotEvidence;
  };
}

export interface ReferenceProvenanceDocuments {
  root: string;
  observations: ParsedReferenceObservation[];
  rules: ParsedDesignRule[];
  scoreReceipts: ScoreReceipt[];
  renderReceipt: ReferenceRenderReceipt;
}

export interface ReferenceProvenanceFinding {
  code: string;
  ref: string;
  message: string;
}

export interface ReferenceProvenanceValidation {
  ok: boolean;
  findings: ReferenceProvenanceFinding[];
  summary: {
    observations: number;
    facts: number;
    rules: number;
    scoreReceipts: number;
    citedFacts: number;
    localScreenshotVerified: boolean;
    durableScreenshotVerified: boolean;
  };
}

export function loadReferenceProvenanceDocuments(
  root = process.cwd(),
): ReferenceProvenanceDocuments {
  const observationDir = resolve(root, OBSERVATION_DIR);
  const observations = readdirSync(observationDir)
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => {
      const originPath = `${OBSERVATION_DIR}/${name}`;
      return parseObservation(
        readFileSync(join(observationDir, name), "utf8"),
        originPath,
      );
    });
  const rules = parseRules(
    readFileSync(resolve(root, RULES_PATH), "utf8"),
    RULES_PATH,
  );
  const scoreReceiptDir = resolve(root, SCORE_RECEIPT_DIR);
  const scoreReceipts = readdirSync(scoreReceiptDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const originPath = `${SCORE_RECEIPT_DIR}/${name}`;
      return {
        ...(readJson<ScoreReceipt>(resolve(root, originPath))),
        originPath,
      };
    });
  const renderReceipt = readJson<ReferenceRenderReceipt>(
    resolve(root, RENDER_RECEIPT_PATH),
  );
  return { root: resolve(root), observations, rules, scoreReceipts, renderReceipt };
}

export function validateReferenceProvenance(
  root = process.cwd(),
): ReferenceProvenanceValidation {
  return validateReferenceProvenanceDocuments(
    loadReferenceProvenanceDocuments(root),
  );
}

export function validateReferenceProvenanceDocuments(
  documents: ReferenceProvenanceDocuments,
): ReferenceProvenanceValidation {
  const findings: ReferenceProvenanceFinding[] = [];
  const observationById = uniqueIndex(
    documents.observations,
    "observation",
    findings,
  );
  const ruleById = uniqueIndex(documents.rules, "rule", findings);
  const scoreById = uniqueIndex(
    documents.scoreReceipts,
    "score-receipt",
    findings,
  );

  for (const observation of documents.observations) {
    validateObservation(observation, findings);
  }

  for (const rule of documents.rules) {
    if (rule.evidence.length === 0) {
      add(findings, "rule-evidence-empty", rule.id, "Rule has no fact citations.");
    }
    for (const citation of rule.evidence) {
      resolveFact(citation, observationById, findings, `rule:${rule.id}`);
    }
  }

  for (const score of documents.scoreReceipts) {
    validateScoreReceipt(
      score,
      documents.root,
      observationById,
      ruleById,
      findings,
    );
  }

  validateRenderReceipt(
    documents.renderReceipt,
    documents.root,
    observationById,
    ruleById,
    scoreById,
    findings,
  );

  findings.sort((left, right) =>
    `${left.code}\0${left.ref}\0${left.message}`.localeCompare(
      `${right.code}\0${right.ref}\0${right.message}`,
    ),
  );

  const localScreenshot = documents.renderReceipt.capture.exactLocalScreenshot;
  const durableScreenshot = documents.renderReceipt.capture.durableScreenshot;
  return {
    ok: findings.length === 0,
    findings,
    summary: {
      observations: documents.observations.length,
      facts: documents.observations.reduce(
        (total, observation) => total + observation.facts.length,
        0,
      ),
      rules: documents.rules.length,
      scoreReceipts: documents.scoreReceipts.length,
      citedFacts: documents.renderReceipt.referenceProvenance.observationFacts.reduce(
        (total, citation) => total + citation.factIds.length,
        0,
      ),
      localScreenshotVerified: screenshotMatches(
        documents.root,
        localScreenshot,
      ),
      durableScreenshotVerified: screenshotMatches(
        documents.root,
        durableScreenshot,
      ),
    },
  };
}

function validateObservation(
  observation: ParsedReferenceObservation,
  findings: ReferenceProvenanceFinding[],
): void {
  if (!ID_PATTERN.test(observation.id)) {
    add(findings, "observation-id-invalid", observation.originPath, observation.id);
  }
  if (!observation.sourceUrl) {
    add(findings, "observation-url-missing", observation.id, "source.url is required.");
  } else {
    try {
      const url = new URL(observation.sourceUrl);
      if (url.protocol !== "https:" || url.hostname !== "mobbin.com") {
        add(
          findings,
          "observation-url-invalid",
          observation.id,
          "source.url must be an https://mobbin.com screen URL.",
        );
      }
    } catch {
      add(
        findings,
        "observation-url-invalid",
        observation.id,
        observation.sourceUrl,
      );
    }
  }
  if (!observation.app || !observation.surface) {
    add(
      findings,
      "observation-source-incomplete",
      observation.id,
      "source.app and source.surface are required.",
    );
  }
  if (observation.capturedVia !== "mobbin-live") {
    add(
      findings,
      "observation-capture-invalid",
      observation.id,
      "capturedVia must be mobbin-live.",
    );
  }
  if (
    !DATE_PATTERN.test(observation.firstSeenAt) ||
    !DATE_PATTERN.test(observation.lastVerifiedAt)
  ) {
    add(
      findings,
      "observation-date-invalid",
      observation.id,
      "firstSeenAt and lastVerifiedAt must be YYYY-MM-DD.",
    );
  }
  if (observation.facts.length < 5 || observation.facts.length > 15) {
    add(
      findings,
      "observation-fact-count",
      observation.id,
      `Expected 5-15 facts; found ${observation.facts.length}.`,
    );
  }
  const factIds = new Set<string>();
  for (const fact of observation.facts) {
    if (!FACT_ID_PATTERN.test(fact.id)) {
      add(findings, "fact-id-invalid", `${observation.id}/${fact.id}`, fact.id);
    }
    if (factIds.has(fact.id)) {
      add(
        findings,
        "fact-id-duplicate",
        `${observation.id}/${fact.id}`,
        "Fact id is duplicated within one observation.",
      );
    }
    factIds.add(fact.id);
    if (
      !fact.kind ||
      !fact.subject ||
      !fact.property ||
      !fact.value ||
      !fact.locatorDescription
    ) {
      add(
        findings,
        "fact-incomplete",
        `${observation.id}/${fact.id}`,
        "kind, subject, property, value, and locatorDescription are required.",
      );
    }
    if (BANNED_VIBE_WORDS.test(fact.raw)) {
      add(
        findings,
        "fact-vibe-word",
        `${observation.id}/${fact.id}`,
        "Fact contains a banned appearance judgement.",
      );
    }
  }
  for (const [tagName, tags] of Object.entries({
    problemTags: observation.problemTags,
    intentTags: observation.intentTags,
    layoutTags: observation.layoutTags,
    interactionTags: observation.interactionTags,
  })) {
    if (tags.length === 0) {
      add(
        findings,
        "observation-tags-missing",
        observation.id,
        `${tagName} must contain at least one tag.`,
      );
    }
    for (const tag of tags) {
      if (!ID_PATTERN.test(tag)) {
        add(
          findings,
          "observation-tag-invalid",
          observation.id,
          `${tagName}:${tag}`,
        );
      }
    }
  }
  if (
    observation.originPath.includes("obs-stackai-") ||
    observation.originPath.includes("obs-airtable-") ||
    observation.originPath.includes("obs-coinbase-")
  ) {
    if (!observation.pixelsStoredFalse) {
      add(
        findings,
        "observation-pixel-policy",
        observation.id,
        "Mobbin observations must record pixelsStored: false.",
      );
    }
  }
}

function validateScoreReceipt(
  score: ScoreReceipt,
  root: string,
  observations: Map<string, ParsedReferenceObservation>,
  rules: Map<string, ParsedDesignRule>,
  findings: ReferenceProvenanceFinding[],
): void {
  if (score.schemaVersion !== "noderoom.design-dna-score-receipt/v1") {
    add(
      findings,
      "score-schema-invalid",
      score.id,
      "Unexpected score receipt schemaVersion.",
    );
  }
  if (!ID_PATTERN.test(score.id)) {
    add(findings, "score-id-invalid", score.originPath, score.id);
  }
  for (const ruleId of score.ruleIds) {
    if (!rules.has(ruleId)) {
      add(findings, "missing-rule", `score:${score.id}`, ruleId);
    }
  }
  if (score.citedFacts.length === 0) {
    add(findings, "score-citations-empty", score.id, "citedFacts is empty.");
  }
  const citedSet = new Set(score.citedFacts);
  for (const citation of score.citedFacts) {
    resolveFact(citation, observations, findings, `score:${score.id}`);
  }
  const criterionCitations = new Set<string>();
  let scoreSum = 0;
  let maxScoreSum = 0;
  for (const criterion of score.criteria) {
    scoreSum += criterion.score;
    maxScoreSum += criterion.maxScore;
    if (criterion.citations.length === 0) {
      add(
        findings,
        "score-criterion-citations-empty",
        `${score.id}/${criterion.id}`,
        "Criterion has no citations.",
      );
    }
    for (const citation of criterion.citations) {
      criterionCitations.add(citation);
      resolveFact(
        citation,
        observations,
        findings,
        `score:${score.id}/${criterion.id}`,
      );
      if (!citedSet.has(citation)) {
        add(
          findings,
          "score-citation-not-declared",
          `${score.id}/${criterion.id}`,
          citation,
        );
      }
    }
  }
  for (const citation of citedSet) {
    if (!criterionCitations.has(citation)) {
      add(
        findings,
        "score-citation-unused",
        score.id,
        `${citation} is not used by a criterion.`,
      );
    }
  }
  if (score.score !== scoreSum || score.scale.max !== maxScoreSum) {
    add(
      findings,
      "score-total-invalid",
      score.id,
      `score=${score.score}, criterionSum=${scoreSum}, scale.max=${score.scale.max}, maxScoreSum=${maxScoreSum}`,
    );
  }
  if (
    score.score < score.scale.min ||
    score.score > score.scale.max ||
    score.scale.min < 0
  ) {
    add(
      findings,
      "score-range-invalid",
      score.id,
      "Score falls outside its scale.",
    );
  }
  if (!score.humanReview?.status) {
    add(
      findings,
      "score-human-review-missing",
      score.id,
      "humanReview.status is required.",
    );
  }
  validateScreenshot(root, score.evidence?.durableScreenshot, score.id, findings);
  validateScreenshot(root, score.evidence?.exactLocalScreenshot, score.id, findings);
}

function validateRenderReceipt(
  render: ReferenceRenderReceipt,
  root: string,
  observations: Map<string, ParsedReferenceObservation>,
  rules: Map<string, ParsedDesignRule>,
  scores: Map<string, ScoreReceipt>,
  findings: ReferenceProvenanceFinding[],
): void {
  if (render.schemaVersion !== "noderoom.reference-render-receipt/v1") {
    add(
      findings,
      "render-schema-invalid",
      render.receiptId,
      "Unexpected render receipt schemaVersion.",
    );
  }
  const provenance = render.referenceProvenance;
  const qualifiedRenderFacts = new Set<string>();
  for (const citation of provenance.observationFacts) {
    if (!observations.has(citation.observationId)) {
      add(
        findings,
        "missing-observation",
        `render:${render.receiptId}`,
        citation.observationId,
      );
      continue;
    }
    for (const factId of citation.factIds) {
      const qualified = `${citation.observationId}/${factId}`;
      qualifiedRenderFacts.add(qualified);
      resolveFact(
        qualified,
        observations,
        findings,
        `render:${render.receiptId}`,
      );
    }
  }
  for (const ruleId of provenance.designRuleIds) {
    if (!rules.has(ruleId)) {
      add(findings, "missing-rule", `render:${render.receiptId}`, ruleId);
    }
  }
  const score = scores.get(provenance.scoreReceipt.id);
  if (!score) {
    add(
      findings,
      "missing-score-receipt",
      `render:${render.receiptId}`,
      provenance.scoreReceipt.id,
    );
  } else {
    const declaredPath = normalize(provenance.scoreReceipt.path);
    const loadedPath = normalize(score.originPath);
    if (declaredPath !== loadedPath) {
      add(
        findings,
        "score-receipt-path-mismatch",
        `render:${render.receiptId}`,
        `${declaredPath} != ${loadedPath}`,
      );
    }
    const scoreFacts = new Set(score.citedFacts);
    for (const citation of scoreFacts) {
      if (!qualifiedRenderFacts.has(citation)) {
        add(
          findings,
          "render-score-fact-missing",
          `render:${render.receiptId}`,
          citation,
        );
      }
    }
    for (const citation of qualifiedRenderFacts) {
      if (!scoreFacts.has(citation)) {
        add(
          findings,
          "render-fact-not-scored",
          `render:${render.receiptId}`,
          citation,
        );
      }
    }
  }
  if (!provenance.humanReview?.status) {
    add(
      findings,
      "render-human-review-missing",
      render.receiptId,
      "referenceProvenance.humanReview.status is required.",
    );
  }
  validateScreenshot(
    root,
    render.capture?.durableScreenshot,
    render.receiptId,
    findings,
  );
  validateScreenshot(
    root,
    render.capture?.exactLocalScreenshot,
    render.receiptId,
    findings,
  );
}

function validateScreenshot(
  root: string,
  evidence: ScreenshotEvidence | undefined,
  owner: string,
  findings: ReferenceProvenanceFinding[],
): void {
  if (!evidence?.path || !SHA256_PATTERN.test(evidence.sha256)) {
    add(
      findings,
      "screenshot-evidence-invalid",
      owner,
      "Screenshot path and lowercase SHA-256 are required.",
    );
    return;
  }
  const path = evidencePath(root, evidence.path);
  if (!existsSync(path)) {
    if (evidence.gating) {
      add(findings, "screenshot-missing", owner, evidence.path);
    }
    return;
  }
  if (!screenshotMatches(root, evidence)) {
    add(findings, "screenshot-hash-mismatch", owner, evidence.path);
  }
}

function screenshotMatches(root: string, evidence: ScreenshotEvidence): boolean {
  const path = evidencePath(root, evidence.path);
  if (!existsSync(path) || !SHA256_PATTERN.test(evidence.sha256)) return false;
  const actual = createHash("sha256")
    .update(readFileSync(path))
    .digest("hex");
  return actual === evidence.sha256;
}

function evidencePath(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

function resolveFact(
  qualified: string,
  observations: Map<string, ParsedReferenceObservation>,
  findings: ReferenceProvenanceFinding[],
  owner: string,
): void {
  const slash = qualified.lastIndexOf("/");
  if (slash <= 0 || slash === qualified.length - 1) {
    add(findings, "fact-citation-invalid", owner, qualified);
    return;
  }
  const observationId = qualified.slice(0, slash);
  const factId = qualified.slice(slash + 1);
  const observation = observations.get(observationId);
  if (!observation) {
    add(findings, "missing-observation", owner, observationId);
    return;
  }
  if (!observation.facts.some((fact) => fact.id === factId)) {
    add(findings, "missing-fact", owner, qualified);
  }
}

function parseObservation(
  yaml: string,
  originPath: string,
): ParsedReferenceObservation {
  const source = topLevelSection(yaml, "source");
  const facts = parseFacts(topLevelSection(yaml, "facts"));
  return {
    id: topLevelScalar(yaml, "id"),
    sourceUrl: sectionScalar(source, "url"),
    app: sectionScalar(source, "app"),
    surface: sectionScalar(source, "surface"),
    capturedVia: sectionScalar(source, "capturedVia"),
    firstSeenAt: topLevelScalar(yaml, "firstSeenAt"),
    lastVerifiedAt: topLevelScalar(yaml, "lastVerifiedAt"),
    facts,
    problemTags: topLevelList(yaml, "problemTags"),
    intentTags: topLevelList(yaml, "intentTags"),
    layoutTags: topLevelList(yaml, "layoutTags"),
    interactionTags: topLevelList(yaml, "interactionTags"),
    pixelsStoredFalse: /^\s{2}pixelsStored:\s*false\s*$/m.test(yaml),
    originPath,
  };
}

function parseRules(yaml: string, originPath: string): ParsedDesignRule[] {
  const starts: number[] = [];
  const pattern = /^- id:\s*([a-z][a-z0-9-]*)\s*$/gm;
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(yaml)) !== null) {
    starts.push(match.index);
    ids.push(match[1]);
  }
  return ids.map((id, index) => {
    const block = yaml.slice(starts[index], starts[index + 1] ?? yaml.length);
    const evidence = listAtIndent(block, "evidence", 2);
    return { id, evidence, originPath };
  });
}

function parseFacts(section: string): ParsedReferenceFact[] {
  const starts: number[] = [];
  const ids: string[] = [];
  const pattern = /^\s{2}- id:\s*([a-z0-9][a-z0-9-]*)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) !== null) {
    starts.push(match.index);
    ids.push(match[1]);
  }
  return ids.map((id, index) => {
    const raw = section.slice(starts[index], starts[index + 1] ?? section.length);
    return {
      id,
      kind: sectionScalar(raw, "kind"),
      subject: sectionScalar(raw, "subject"),
      property: sectionScalar(raw, "property"),
      value: sectionScalar(raw, "value"),
      locatorDescription: sectionScalar(raw, "locatorDescription"),
      raw,
    };
  });
}

function topLevelSection(yaml: string, key: string): string {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) return "";
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length > 0 && !/^\s/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

function topLevelScalar(yaml: string, key: string): string {
  const match = yaml.match(new RegExp(`^${escapeRegex(key)}:\\s*(.+?)\\s*$`, "m"));
  return unquote(match?.[1] ?? "");
}

function sectionScalar(section: string, key: string): string {
  const match = section.match(
    new RegExp(`^\\s*(?:-\\s+)?${escapeRegex(key)}:\\s*(.+?)\\s*$`, "m"),
  );
  return unquote(match?.[1] ?? "");
}

function topLevelList(yaml: string, key: string): string[] {
  const section = topLevelSection(yaml, key);
  return [...section.matchAll(/^\s+-\s+(.+?)\s*$/gm)].map((match) =>
    unquote(match[1]),
  );
}

function listAtIndent(yaml: string, key: string, indent: number): string[] {
  const lines = yaml.split(/\r?\n/);
  const prefix = " ".repeat(indent);
  const start = lines.findIndex((line) => line === `${prefix}${key}:`);
  if (start < 0) return [];
  const itemPrefix = " ".repeat(indent + 2);
  const values: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length > 0 && !line.startsWith(itemPrefix)) break;
    const match = line.match(/^\s+-\s+(.+?)\s*$/);
    if (match) values.push(unquote(match[1]));
  }
  return values;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueIndex<T extends { id: string }>(
  entries: T[],
  kind: string,
  findings: ReferenceProvenanceFinding[],
): Map<string, T> {
  const index = new Map<string, T>();
  for (const entry of entries) {
    if (index.has(entry.id)) {
      add(findings, `${kind}-id-duplicate`, entry.id, `${kind} id is duplicated.`);
      continue;
    }
    index.set(entry.id, entry);
  }
  return index;
}

function add(
  findings: ReferenceProvenanceFinding[],
  code: string,
  ref: string,
  message: string,
): void {
  findings.push({ code, ref, message });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isMainModule()) {
  const validation = validateReferenceProvenance();
  console.log(JSON.stringify(validation, null, 2));
  if (!validation.ok) process.exitCode = 1;
}
