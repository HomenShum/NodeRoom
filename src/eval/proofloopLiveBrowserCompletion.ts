export type AgentCompletionSignal = {
  completed: boolean;
  failed: boolean;
  statusText: string;
};

export function classifyAgentCompletion(input: {
  jobStatus: string;
  progressStatus: string;
  peopleText: string;
  streamText: string;
  latestStreamText: string;
}): AgentCompletionSignal {
  const jobStatus = input.jobStatus.trim();
  const progressStatus = input.progressStatus.trim();
  const peopleText = input.peopleText.trim();
  const combinedStreamText = [input.streamText.trim(), input.latestStreamText.trim()].filter(Boolean).join("\n");
  const statusText = [jobStatus, progressStatus, peopleText, combinedStreamText.slice(0, 240)].filter(Boolean).join(" | ");
  const jobStatusToken = firstStatusToken(jobStatus);
  const jobRunning = jobStatusToken === "queued" || jobStatusToken === "running" || jobStatusToken === "retrying" || jobStatusToken === "handoff" || jobStatusToken === "paused";
  const jobTerminalFailure = jobStatusToken === "failed" || jobStatusToken === "blocked" || jobStatusToken === "cancelled";

  const completed =
    jobStatusToken === "completed" ||
    /\bdone\b/i.test(progressStatus) ||
    /\bNodeAgent completed\b/i.test(combinedStreamText);
  const failed =
    jobTerminalFailure ||
    (!jobRunning && (
      /\bfailed\b/i.test(progressStatus) ||
      /\bNodeAgent needs attention\b/i.test(combinedStreamText)
    ));

  return { completed, failed, statusText };
}

function firstStatusToken(value: string): string | undefined {
  const match = value.match(/\b(completed|failed|blocked|cancelled|queued|running|retrying|handoff|paused)\b/i);
  return match?.[1]?.toLowerCase();
}
