/**
 * Optional LinkedIn profile lookup for founder_profile URL scrapes.
 *
 * The default actor stays harvestapi/linkedin-profile-scraper.
 * Set NODEROOM_LINKEDIN_PROFILE_ACTOR to johnvc/linkedin-profile-api
 * to send profileUrls and map a profile row onto the tool's fields.
 * Name search is unchanged.
 */

export const OPTIONAL_LINKEDIN_PROFILE_ACTOR = "johnvc/linkedin-profile-api";
export const LINKEDIN_PROFILE_ACTOR_ENV = "NODEROOM_LINKEDIN_PROFILE_ACTOR";

const DEFAULT_ACTOR_PATH = "harvestapi~linkedin-profile-scraper";
const OPTIONAL_ACTOR_PATH = "johnvc~linkedin-profile-api";

export interface LinkedInProfileCall {
  actorPath: string;
  body: Record<string, unknown>;
  optional: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function linkedInProfileCall(
  linkedinUrl: string,
  envValue: string | undefined,
): LinkedInProfileCall {
  if (envValue === OPTIONAL_LINKEDIN_PROFILE_ACTOR) {
    return {
      actorPath: OPTIONAL_ACTOR_PATH,
      optional: true,
      body: { profileUrls: [linkedinUrl] },
    };
  }
  return {
    actorPath: DEFAULT_ACTOR_PATH,
    optional: false,
    body: { urls: [linkedinUrl] },
  };
}

function yearText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Map one optional-actor dataset onto the fields mapApifyProfileItem already reads. */
export function linkedInProfileItemForTool(items: unknown[]): Record<string, unknown> | null {
  for (const item of items) {
    if (!isRecord(item) || item.result_type !== "profile") continue;
    const experience = Array.isArray(item.experience)
      ? item.experience.filter(isRecord).map((role) => ({
          company: role.company,
          title: role.title,
          location: role.location,
          startYear: yearText(role.start_date),
          endYear: yearText(role.end_date),
        }))
      : [];
    const education = Array.isArray(item.education)
      ? item.education.filter(isRecord).map((school) => ({
          // The published education object stores the school line in title.
          school: typeof school.title === "string" ? school.title : undefined,
          startYear: yearText(school.start_year),
          endYear: yearText(school.end_year),
        }))
      : [];
    return {
      firstName: item.firstName,
      lastName: item.lastName,
      fullName: item.name,
      headline: item.headline,
      about: typeof item.about === "string" ? item.about : item.summary,
      location: item.location,
      followerCount: item.followers,
      connectionsCount: item.connections,
      experience,
      education,
      publicUrl: item.publicUrl,
    };
  }
  return null;
}
