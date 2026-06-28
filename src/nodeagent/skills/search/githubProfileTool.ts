/**
 * GitHub profile research tool for the NodeAgent.
 *
 * Fetches a developer's public GitHub profile, repositories, contribution
 * activity, languages, and organization memberships via the GitHub REST API.
 * No authentication required for public data (60 req/hr unauthenticated);
 * if GITHUB_TOKEN is set, rate limit rises to 5,000 req/hr.
 *
 * Tool name: `github_profile`
 * Args:
 *   username (required) — GitHub login, e.g. "octocat"
 *   includeRepos (optional, default true) — fetch public repos (top 30 by stars)
 *   includeContributions (optional, default true) — fetch repos contributed to (GraphQL)
 *   includeLanguages (optional, default true) — aggregate language stats across repos
 */

import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";

const GITHUB_API = "https://api.github.com";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  topics: string[];
  created_at: string;
  updated_at: string;
  pushed_at: string;
  homepage: string | null;
  fork: boolean;
  archived: boolean;
  license: { name: string } | null;
}

interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  bio: string | null;
  twitter_username: string | null;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  html_url: string;
  avatar_url: string;
}

interface GitHubEvent {
  id: string;
  type: string;
  repo: { name: string };
  created_at: string;
  payload: {
    action?: string;
    ref?: string;
    ref_type?: string;
    pull_request?: { title: string; html_url: string; merged: boolean };
    issue?: { title: string; html_url: string };
    commits?: { sha: string; message: string }[];
  };
}

interface GitHubProfileResult {
  ok: boolean;
  error?: string;
  username: string;
  user?: {
    name: string | null;
    bio: string | null;
    company: string | null;
    blog: string | null;
    location: string | null;
    twitter: string | null;
    publicRepos: number;
    followers: number;
    following: number;
    createdAt: string;
    htmlUrl: string;
    avatarUrl: string;
  };
  repos?: Array<{
    name: string;
    url: string;
    description: string | null;
    language: string | null;
    stars: number;
    forks: number;
    topics: string[];
    updatedAt: string;
    homepage: string | null;
    license: string | null;
    fork: boolean;
    archived: boolean;
  }>;
  languages?: Array<{ language: string; bytes: number; percentage: number }>;
  recentActivity?: Array<{
    type: string;
    repo: string;
    createdAt: string;
    detail: string;
  }>;
  orgsContributedTo?: string[];
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function ghFetch<T>(path: string): Promise<T | { error: string }> {
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return { error: "Not found" };
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") return { error: "GitHub API rate limit exceeded. Set GITHUB_TOKEN for higher limits." };
      return { error: "Forbidden" };
    }
    if (!res.ok) return { error: `GitHub API error: ${res.status}` };
    return await res.json() as T;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `GitHub fetch failed: ${msg}` };
  }
}

async function fetchUser(username: string): Promise<GitHubUser | { error: string }> {
  return ghFetch<GitHubUser>(`/users/${encodeURIComponent(username)}`);
}

async function fetchRepos(username: string): Promise<GitHubRepo[] | { error: string }> {
  const result = await ghFetch<GitHubRepo[]>(`/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed`);
  if ("error" in result) return result;
  return result
    .filter((r) => !r.fork)
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 30);
}

async function fetchEvents(username: string): Promise<GitHubEvent[] | { error: string }> {
  return ghFetch<GitHubEvent[]>(`/users/${encodeURIComponent(username)}/events/public?per_page=30`);
}

async function fetchOrgs(username: string): Promise<string[] | { error: string }> {
  const result = await ghFetch<Array<{ login: string }>>(`/users/${encodeURIComponent(username)}/orgs`);
  if ("error" in result) return result;
  return result.map((o) => o.login);
}

async function aggregateLanguages(repos: GitHubRepo[]): Promise<Array<{ language: string; bytes: number; percentage: number }>> {
  const langMap = new Map<string, number>();
  for (const repo of repos.slice(0, 15)) {
    if (!repo.language) continue;
    const result = await ghFetch<Record<string, number>>(`/repos/${encodeURIComponent(repo.full_name)}/languages`);
    if ("error" in result) continue;
    for (const [lang, bytes] of Object.entries(result)) {
      langMap.set(lang, (langMap.get(lang) ?? 0) + bytes);
    }
  }
  const total = Array.from(langMap.values()).reduce((a, b) => a + b, 0);
  return Array.from(langMap.entries())
    .map(([language, bytes]) => ({ language, bytes, percentage: total > 0 ? Math.round((bytes / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
}

function summarizeEvent(event: GitHubEvent): string {
  switch (event.type) {
    case "PushEvent": {
      const count = event.payload.commits?.length ?? 0;
      return `Pushed ${count} commit${count !== 1 ? "s" : ""} to ${event.repo.name}`;
    }
    case "PullRequestEvent": {
      const pr = event.payload.pull_request;
      return `${event.payload.action ?? "Updated"} PR "${pr?.title ?? "?"}" on ${event.repo.name}`;
    }
    case "IssuesEvent": {
      const issue = event.payload.issue;
      return `${event.payload.action ?? "Updated"} issue "${issue?.title ?? "?"}" on ${event.repo.name}`;
    }
    case "CreateEvent":
      return `Created ${event.payload.ref_type ?? "ref"} ${event.payload.ref ?? ""} in ${event.repo.name}`;
    case "ForkEvent":
      return `Forked ${event.repo.name}`;
    case "WatchEvent":
      return `Starred ${event.repo.name}`;
    case "ReleaseEvent":
      return `Published release in ${event.repo.name}`;
    default:
      return `${event.type} on ${event.repo.name}`;
  }
}

const schema = z.object({
  username: z.string().min(1).describe("GitHub username (login), e.g. 'octocat'"),
  includeRepos: z.boolean().optional().default(true).describe("Fetch top 30 public repos by stars"),
  includeContributions: z.boolean().optional().default(true).describe("Fetch orgs contributed to"),
  includeLanguages: z.boolean().optional().default(true).describe("Aggregate language stats across top repos"),
});

export const githubProfileTool: AgentTool = {
  name: "github_profile",
  description:
    "Fetch a developer's public GitHub profile: bio, company, location, followers, " +
    "top repositories (by stars), language distribution, recent activity (pushes, PRs, issues), " +
    "and organizations contributed to. Use for person deep dives: understanding a founder's " +
    "codebase, tech stack, open-source contributions, and engineering trajectory. " +
    "If GITHUB_TOKEN env var is set, rate limit is 5k/hr; otherwise 60/hr (public data only).",
  schema,
  async execute(args: z.infer<typeof schema>, rt: RoomTools) {
    const username = args.username.trim();

    const userResult = await fetchUser(username);
    if ("error" in userResult) {
      return {
        ok: false,
        error: userResult.error,
        username,
      } as GitHubProfileResult;
    }

    const result: GitHubProfileResult = {
      ok: true,
      username,
      user: {
        name: userResult.name,
        bio: userResult.bio,
        company: userResult.company,
        blog: userResult.blog,
        location: userResult.location,
        twitter: userResult.twitter_username,
        publicRepos: userResult.public_repos,
        followers: userResult.followers,
        following: userResult.following,
        createdAt: userResult.created_at,
        htmlUrl: userResult.html_url,
        avatarUrl: userResult.avatar_url,
      },
    };

    if (args.includeRepos) {
      const reposResult = await fetchRepos(username);
      if (!("error" in reposResult)) {
        result.repos = reposResult.map((r) => ({
          name: r.name,
          url: r.html_url,
          description: r.description,
          language: r.language,
          stars: r.stargazers_count,
          forks: r.forks_count,
          topics: r.topics ?? [],
          updatedAt: r.pushed_at,
          homepage: r.homepage,
          license: r.license?.name ?? null,
          fork: r.fork,
          archived: r.archived,
        }));

        if (args.includeLanguages && reposResult.length > 0) {
          result.languages = await aggregateLanguages(reposResult);
        }
      }
    }

    const eventsResult = await fetchEvents(username);
    if (!("error" in eventsResult)) {
      result.recentActivity = eventsResult.slice(0, 15).map((e) => ({
        type: e.type,
        repo: e.repo.name,
        createdAt: e.created_at,
        detail: summarizeEvent(e),
      }));
    }

    if (args.includeContributions) {
      const orgsResult = await fetchOrgs(username);
      if (!("error" in orgsResult)) {
        result.orgsContributedTo = orgsResult;
      }
    }

    await rt.recordCapture?.({
      url: userResult.html_url,
      goal: `GitHub profile: ${username}`,
      ok: true,
      title: `GitHub · ${userResult.name ?? username}`,
      data: result as unknown as Record<string, unknown>,
      steps: [
        ...(result.repos ?? []).slice(0, 5).map((r) => ({
          phase: "Repository",
          label: `${r.name} (${r.stars}★, ${r.language ?? "?"})`,
          status: "ok" as const,
          detail: r.url,
        })),
        ...(result.languages ?? []).slice(0, 3).map((l) => ({
          phase: "Language",
          label: `${l.language} (${l.percentage}%)`,
          status: "ok" as const,
        })),
        ...(result.recentActivity ?? []).slice(0, 3).map((a) => ({
          phase: "Activity",
          label: a.detail.slice(0, 80),
          status: "ok" as const,
        })),
      ],
    });

    return result;
  },
};
