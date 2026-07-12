import type { Job, Jobs, JobStatus } from "./mobileData";

export type LiveMobileJob = {
  id: string;
  status: string;
  entrypoint?: string;
  error?: string;
  modelPolicy: string;
};

export function projectMobileJobs(job: LiveMobileJob | null): Jobs {
  const out: Jobs = { running: [], queued: [], attention: [], completed: [] };
  if (!job) return out;
  const status = canonicalJobStatus(job.status);
  const mobileJob: Job = {
    id: job.id,
    status,
    title: job.entrypoint ?? "Agent job",
    sub: status + (job.error ? ` - ${job.error}` : ""),
    cost: "",
    route: job.modelPolicy as Job["route"],
    trace: job.id,
  };
  if (status === "running" || status === "retrying") out.running.push(mobileJob);
  else if (status === "queued") out.queued.push(mobileJob);
  else if (status === "completed") out.completed.push(mobileJob);
  else out.attention.push(mobileJob);
  return out;
}

function canonicalJobStatus(status: string): JobStatus {
  if (["queued", "running", "paused", "blocked", "retrying", "completed", "failed", "cancelled"].includes(status)) {
    return status as JobStatus;
  }
  return "unknown";
}
