import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type ProofloopBuyerProfileId = "solo-builder" | "workflow-team" | "regulated-platform";

export type ProofloopBuyerQuestionId =
  | "workflow-proof"
  | "anti-gaming"
  | "local-adoption"
  | "receipt-sensitivity"
  | "managed-trigger";

export type ProofloopBuyerProfile = {
  id: ProofloopBuyerProfileId;
  label: string;
  whyThisBuyer: string;
};

export type ProofloopBuyerValidationQuestion = {
  id: ProofloopBuyerQuestionId;
  question: string;
  positiveSignal: string;
  negativeSignal: string;
};

export type ProofloopBuyerValidationKit = {
  schema: "proofloop-buyer-validation-v1";
  generatedAt: string;
  oneLiner: string;
  framingRule: string;
  targetProfiles: ProofloopBuyerProfile[];
  questions: ProofloopBuyerValidationQuestion[];
  passCriteria: {
    minimumConversations: number;
    minimumActivePain: number;
    minimumRunWithinWeek: number;
    minimumNamedBudgetOwner: number;
    maximumHardRejects: number;
  };
  nextActionIfValidated: string;
  nextActionIfInvalidated: string;
};

export type ProofloopBuyerConversationSignal = {
  buyer: string;
  profile: ProofloopBuyerProfileId;
  activePain: boolean;
  wouldRunThisWeek: boolean;
  namedBudgetOwner: boolean;
  wouldPayForManagedPrivateReceipts: boolean;
  dataResidencyOrByokRequired: boolean;
  hardReject: boolean;
};

export type ProofloopBuyerValidationScore = {
  conversations: number;
  activePain: number;
  wouldRunThisWeek: number;
  namedBudgetOwner: number;
  wouldPayForManagedPrivateReceipts: number;
  dataResidencyOrByokRequired: number;
  hardRejects: number;
  recommendation: "validated" | "continue-interviews" | "pivot-or-reframe";
  reasons: string[];
};

type KitOptions = {
  now?: () => Date;
};

type WriteOptions = {
  root?: string;
  outDir?: string;
};

export function buildProofloopBuyerValidationKit(options: KitOptions = {}): ProofloopBuyerValidationKit {
  return {
    schema: "proofloop-buyer-validation-v1",
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    oneLiner:
      "Proof Loop proves your agent's work is real: it finished the task, used the right tools, and did not game the benchmark, so you can trust it before you ship.",
    framingRule:
      "Call this verification you run, not certification, until independent adoption makes Proof Loop receipts meaningful outside the team that ran them.",
    targetProfiles: [
      {
        id: "solo-builder",
        label: "Solo founder or hackathon builder",
        whyThisBuyer: "Validates the local npx adoption path and the 'help me ship without fake done' pain.",
      },
      {
        id: "workflow-team",
        label: "Agentic finance, health, science, or operations workflow team",
        whyThisBuyer: "Tests whether teams shipping real agent workflows need audit-grade receipts before release.",
      },
      {
        id: "regulated-platform",
        label: "Platform, infra, risk, or governance owner",
        whyThisBuyer: "Tests whether the anti-gaming wedge maps to budget, data controls, and enterprise procurement.",
      },
    ],
    questions: [
      {
        id: "workflow-proof",
        question:
          "Think of an agent workflow your team would ship in the next 60 days. What proof would you need before letting customers or internal users rely on it?",
        positiveSignal: "They name a live workflow, a release clock, and proof gaps that block launch.",
        negativeSignal: "They talk generally about agents but cannot name a workflow or release decision.",
      },
      {
        id: "anti-gaming",
        question:
          "If the agent passed a benchmark or eval, what would convince you it did not take a shortcut, leak answers, or game the score?",
        positiveSignal: "They already worry about eval leakage, shortcut paths, hidden state, or benchmark gaming.",
        negativeSignal: "They accept green evals at face value or treat gaming as only a research problem.",
      },
      {
        id: "local-adoption",
        question:
          "Would you run a local Proof Loop gate this week if it only wrote receipts on your machine and blocked fake done states? What would stop you?",
        positiveSignal: "They ask for install details, name a repo to try, or volunteer a pilot owner.",
        negativeSignal: "They say it is interesting but cannot name a near-term run or blocker.",
      },
      {
        id: "receipt-sensitivity",
        question:
          "Would hosted receipt dashboards be acceptable if source code stayed local? Which receipt fields would still be too sensitive to upload?",
        positiveSignal: "They distinguish source code from prompts, tool args, stack traces, paths, and failure details.",
        negativeSignal: "They either say all receipts are fine or all hosted proof is impossible without exploring controls.",
      },
      {
        id: "managed-trigger",
        question:
          "When would you pay for managed private Proof Loop: per-tenant indexes, BYO key or VPC deployment, audit-grade receipts, and team dashboards?",
        positiveSignal: "They name a budget owner, procurement path, compliance need, or paid pilot trigger.",
        negativeSignal: "They like the idea but keep it in free tooling, OSS, or personal productivity territory.",
      },
    ],
    passCriteria: {
      minimumConversations: 5,
      minimumActivePain: 3,
      minimumRunWithinWeek: 2,
      minimumNamedBudgetOwner: 1,
      maximumHardRejects: 1,
    },
    nextActionIfValidated:
      "Build only the smallest paid pilot surface: managed private receipts for the buyer who named budget, data controls, and a release decision.",
    nextActionIfInvalidated:
      "Do not build the hosted dashboard. Reframe around local demo-shipping reliability or keep Proof Loop as an OSS standard that compounds NodeRoom.",
  };
}

export function scoreProofloopBuyerValidation(
  conversations: ProofloopBuyerConversationSignal[],
  kit: ProofloopBuyerValidationKit = buildProofloopBuyerValidationKit(),
): ProofloopBuyerValidationScore {
  const score = {
    conversations: conversations.length,
    activePain: count(conversations, "activePain"),
    wouldRunThisWeek: count(conversations, "wouldRunThisWeek"),
    namedBudgetOwner: count(conversations, "namedBudgetOwner"),
    wouldPayForManagedPrivateReceipts: count(conversations, "wouldPayForManagedPrivateReceipts"),
    dataResidencyOrByokRequired: count(conversations, "dataResidencyOrByokRequired"),
    hardRejects: count(conversations, "hardReject"),
  };

  const reasons = [
    `${score.conversations}/${kit.passCriteria.minimumConversations} buyer conversations completed`,
    `${score.activePain}/${kit.passCriteria.minimumActivePain} buyers named active proof pain`,
    `${score.wouldRunThisWeek}/${kit.passCriteria.minimumRunWithinWeek} buyers would run a local gate this week`,
    `${score.namedBudgetOwner}/${kit.passCriteria.minimumNamedBudgetOwner} buyers named a budget owner`,
    `${score.hardRejects}/${kit.passCriteria.maximumHardRejects} hard rejects`,
  ];

  const validated =
    score.conversations >= kit.passCriteria.minimumConversations &&
    score.activePain >= kit.passCriteria.minimumActivePain &&
    score.wouldRunThisWeek >= kit.passCriteria.minimumRunWithinWeek &&
    score.namedBudgetOwner >= kit.passCriteria.minimumNamedBudgetOwner &&
    score.hardRejects <= kit.passCriteria.maximumHardRejects;

  const enoughConversations = score.conversations >= kit.passCriteria.minimumConversations;
  const clearlyInvalidated =
    enoughConversations &&
    (score.activePain < kit.passCriteria.minimumActivePain ||
      score.wouldRunThisWeek < kit.passCriteria.minimumRunWithinWeek ||
      score.namedBudgetOwner < kit.passCriteria.minimumNamedBudgetOwner);

  return {
    ...score,
    recommendation: validated ? "validated" : clearlyInvalidated ? "pivot-or-reframe" : "continue-interviews",
    reasons,
  };
}

export function renderProofloopBuyerValidationMarkdown(kit: ProofloopBuyerValidationKit): string {
  const lines = [
    "# Proof Loop Buyer Validation",
    "",
    `Generated: ${kit.generatedAt}`,
    "",
    "## One-Liner",
    "",
    kit.oneLiner,
    "",
    "## Framing Rule",
    "",
    kit.framingRule,
    "",
    "## Target Buyers",
    "",
    ...kit.targetProfiles.flatMap((profile) => [
      `- ${profile.label}: ${profile.whyThisBuyer}`,
    ]),
    "",
    "## Five Questions",
    "",
    ...kit.questions.flatMap((question, index) => [
      `${index + 1}. ${question.question}`,
      `   - Positive signal: ${question.positiveSignal}`,
      `   - Negative signal: ${question.negativeSignal}`,
    ]),
    "",
    "## Pass Criteria",
    "",
    `- ${kit.passCriteria.minimumConversations} real buyer conversations.`,
    `- ${kit.passCriteria.minimumActivePain} buyers name active proof pain.`,
    `- ${kit.passCriteria.minimumRunWithinWeek} buyers would run a local gate this week.`,
    `- ${kit.passCriteria.minimumNamedBudgetOwner} buyer names a budget owner or paid pilot path.`,
    `- No more than ${kit.passCriteria.maximumHardRejects} hard reject.`,
    "",
    "## Decision Rule",
    "",
    `- If validated: ${kit.nextActionIfValidated}`,
    `- If invalidated: ${kit.nextActionIfInvalidated}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function writeProofloopBuyerValidationKit(
  kit: ProofloopBuyerValidationKit,
  options: WriteOptions = {},
): { jsonPath: string; markdownPath: string } {
  const root = resolve(options.root ?? process.cwd());
  const outDir = resolve(root, options.outDir ?? join(".proofloop", "intake", "buyer-validation"));
  const jsonPath = join(outDir, "kit.json");
  const markdownPath = join(outDir, "kit.md");
  writeJson(jsonPath, kit);
  writeText(markdownPath, renderProofloopBuyerValidationMarkdown(kit));
  return {
    jsonPath: relativePath(root, jsonPath),
    markdownPath: relativePath(root, markdownPath),
  };
}

function count(
  conversations: ProofloopBuyerConversationSignal[],
  key: keyof Pick<
    ProofloopBuyerConversationSignal,
    | "activePain"
    | "wouldRunThisWeek"
    | "namedBudgetOwner"
    | "wouldPayForManagedPrivateReceipts"
    | "dataResidencyOrByokRequired"
    | "hardReject"
  >,
): number {
  return conversations.filter((conversation) => conversation[key]).length;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}
