/**
 * founder_profile — agent tool. Fetches per-founder professional background, education,
 * and social context via Apify's LinkedIn Profile Scraper actor (harvestapi~linkedin-profile-scraper).
 * Returns structured data the agent uses to populate per-founder deep-dive cells and generate
 * outreach talking points.
 *
 * Two modes:
 *  1. linkedinUrl provided → scrape that profile directly.
 *  2. No URL, but fullName provided → search by name via harvestapi~linkedin-profile-search-by-name,
 *     return candidate matches so the agent can pick the right one and call again with the URL.
 *
 * Requires APIFY_API_KEY in the environment. Falls back gracefully with an ok:false result
 * if the key is missing or the Apify run fails, so the agent can continue with fetch_source
 * as a fallback lane.
 */
import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";

const schema = z.object({
  linkedinUrl: z.string().optional().describe("LinkedIn profile URL (e.g. https://www.linkedin.com/in/jdoe). If omitted, the tool searches by name."),
  fullName: z.string().optional().describe("Founder's full name. Required if linkedinUrl is omitted. Used for name-based search and labeling."),
  company: z.string().optional().describe("Company name for context — helps disambiguate common names in search results"),
});

interface ApifyProfileResult {
  ok: boolean;
  fullName?: string;
  headline?: string;
  location?: string;
  education?: Array<{ school?: string; degree?: string; field?: string; startYear?: string; endYear?: string }>;
  experience?: Array<{ company?: string; title?: string; startYear?: string; endYear?: string; description?: string }>;
  skills?: string[];
  about?: string;
  followerCount?: number;
  connectionCount?: number;
  activity?: Array<{ type?: string; title?: string; url?: string; date?: string }>;
  profileUrl?: string;
  error?: string;
}

/** Scrape a LinkedIn profile URL via Apify harvestapi~linkedin-profile-scraper. */
async function fetchApifyLinkedInProfile(linkedinUrl: string, apiKey: string): Promise<ApifyProfileResult> {
  const actorId = "harvestapi~linkedin-profile-scraper";
  const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiKey}`;

  const body = { urls: [linkedinUrl] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const resp = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, error: `Apify HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }

    const items = await resp.json() as any[];
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, error: "Apify returned no results for this profile URL" };
    }

    const item = items[0];
    return mapApifyProfileItem(item, linkedinUrl);
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, error: "Apify request timed out after 60s" };
    }
    return { ok: false, error: `Apify fetch failed: ${err.message ?? String(err)}` };
  } finally {
    clearTimeout(timeout);
  }
}

/** Search LinkedIn by name via Apify harvestapi~linkedin-profile-search-by-name.
 *  Returns candidate matches so the agent can pick the right one. */
async function searchApifyLinkedInByName(fullName: string, company: string | undefined, apiKey: string): Promise<ApifyProfileResult & { candidates?: Array<{ fullName: string; headline: string; linkedinUrl: string }> }> {
  const actorId = "harvestapi~linkedin-profile-search-by-name";
  const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiKey}`;

  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? fullName;
  const lastName = parts.slice(1).join(" ") || fullName;

  const body: Record<string, unknown> = {
    firstName,
    lastName,
    profileScraperMode: "Short",
  };
  if (company) body.currentCompanies = [company];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const resp = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, error: `Apify search HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }

    const items = await resp.json() as any[];
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, error: `No LinkedIn profiles found for "${fullName}${company ? ` @ ${company}` : ""}". Try fetch_source on a public profile or company page to find the LinkedIn URL.` };
    }

    const candidates = items.slice(0, 5).map((item: any) => ({
      fullName: `${item.firstName ?? ""} ${item.lastName ?? ""}`.trim() || item.fullName || item.name || "Unknown",
      headline: item.headline ?? item.title ?? "",
      linkedinUrl: item.linkedinUrl ?? `https://www.linkedin.com/in/${item.publicIdentifier ?? item.username ?? ""}`,
    }));

    return {
      ok: true,
      fullName: candidates[0]?.fullName,
      headline: candidates[0]?.headline,
      profileUrl: candidates[0]?.linkedinUrl,
      candidates,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, error: "Apify search timed out after 60s" };
    }
    return { ok: false, error: `Apify search failed: ${err.message ?? String(err)}` };
  } finally {
    clearTimeout(timeout);
  }
}

/** Map a raw Apify profile item to our ApifyProfileResult. */
function mapApifyProfileItem(item: any, linkedinUrl: string): ApifyProfileResult {
  const loc = item.location;
  const locText = typeof loc === "string" ? loc : loc?.linkedinText ?? loc?.parsed?.text ?? undefined;

  return {
    ok: true,
    fullName: `${item.firstName ?? ""} ${item.lastName ?? ""}`.trim() || item.fullName || item.name || undefined,
    headline: item.headline ?? item.title ?? undefined,
    location: locText,
    education: (item.education ?? []).map((e: any) => ({
      school: e.school ?? e.organization ?? e.organizationName ?? undefined,
      degree: e.degree ?? undefined,
      field: e.fieldOfStudy ?? e.field ?? undefined,
      startYear: e.startYear?.toString() ?? e.date1 ?? undefined,
      endYear: e.endYear?.toString() ?? e.date2 ?? undefined,
    })),
    experience: (item.experience ?? item.positions ?? item.currentPosition ?? []).map((e: any) => ({
      company: e.company ?? e.companyName ?? e.organizationName ?? undefined,
      title: e.title ?? e.position ?? e.positionTitle ?? undefined,
      startYear: e.startDate?.year?.toString() ?? e.startYear?.toString() ?? undefined,
      endYear: e.endDate?.year?.toString() ?? e.endYear?.toString() ?? (e.endDate?.text === "Present" ? "present" : undefined),
      description: e.description ?? undefined,
    })),
    skills: item.skills ?? item.topSkills ?? [],
    about: item.about ?? item.summary ?? undefined,
    followerCount: item.followerCount ?? undefined,
    connectionCount: item.connectionsCount ?? item.connectionCount ?? undefined,
    activity: (item.activity ?? item.posts ?? []).slice(0, 10).map((a: any) => ({
      type: a.type ?? a.postType ?? undefined,
      title: a.title ?? a.text ?? a.caption ?? undefined,
      url: a.url ?? a.link ?? undefined,
      date: a.timestamp ?? a.date ?? undefined,
    })),
    profileUrl: linkedinUrl,
  };
}

export const apifyFounderProfileTool: AgentTool = {
  name: "founder_profile",
  description:
    "Fetch a founder's professional profile via Apify LinkedIn scraper. Two modes: " +
    "(1) Pass linkedinUrl to scrape a known profile — returns education, work history, skills, about, activity. " +
    "(2) Omit linkedinUrl, pass fullName — searches LinkedIn by name and returns candidate matches with URLs. " +
    "Pick the right candidate and call again with its linkedinUrl for full profile data. " +
    "Use for per-founder deep research: background, education, career trajectory, conviction signals, and outreach talking points. " +
    "Requires APIFY_API_KEY. If the tool returns ok:false, fall back to fetch_source on their LinkedIn or other public profiles.",
  schema,
  async execute(args: z.infer<typeof schema>, rt: RoomTools) {
    const apiKey = process.env.APIFY_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error: "APIFY_API_KEY is not set. Set it in Convex environment variables to enable LinkedIn profile scraping. Use fetch_source as a fallback.",
      } as ApifyProfileResult;
    }

    // Mode 2: No URL — search by name first
    if (!args.linkedinUrl) {
      if (!args.fullName) {
        return { ok: false, error: "Either linkedinUrl or fullName must be provided." } as ApifyProfileResult;
      }
      const searchResult = await searchApifyLinkedInByName(args.fullName, args.company, apiKey);
      return searchResult as any;
    }

    // Mode 1: URL provided — scrape directly
    const result = await fetchApifyLinkedInProfile(args.linkedinUrl, apiKey);

    if (result.ok) {
      await rt.recordCapture?.({
        url: args.linkedinUrl,
        goal: `Founder profile: ${args.fullName ?? "unknown"}${args.company ? ` @ ${args.company}` : ""}`,
        ok: true,
        title: `LinkedIn · ${result.fullName ?? args.fullName ?? args.linkedinUrl}`,
        data: result as unknown as Record<string, unknown>,
        steps: [
          ...(result.experience ?? []).slice(0, 5).map((e) => ({
            phase: "Experience",
            label: `${e.title ?? "?"} @ ${e.company ?? "?"} (${e.startYear ?? "?"}-${e.endYear ?? "present"})`,
            status: "ok",
          })),
          ...(result.education ?? []).slice(0, 3).map((e) => ({
            phase: "Education",
            label: `${e.degree ?? e.field ?? "Degree"} @ ${e.school ?? "?"} (${e.startYear ?? "?"}-${e.endYear ?? "?"})`,
            status: "ok",
          })),
          ...(result.activity ?? []).slice(0, 3).map((a) => ({
            phase: "Activity",
            label: a.title?.slice(0, 80) ?? "(post)",
            status: "ok",
            detail: a.url ?? undefined,
          })),
        ],
      });
    }

    return result;
  },
};
