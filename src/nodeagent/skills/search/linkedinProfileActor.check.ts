import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPTIONAL_LINKEDIN_PROFILE_ACTOR,
  linkedInProfileCall,
  linkedInProfileItemForTool,
} from "./linkedinProfileActor";

const PROFILE_URL = "https://www.linkedin.com/in/example-person";

describe("linkedIn profile adapter", () => {
  it("keeps the default actor body when the env value does not match", () => {
    const call = linkedInProfileCall(PROFILE_URL, undefined);
    assert.equal(call.optional, false);
    assert.equal(call.actorPath, "harvestapi~linkedin-profile-scraper");
    assert.deepEqual(call.body, { urls: [PROFILE_URL] });
  });

  it("sends profileUrls and maps a profile row when the optional actor is selected", () => {
    const call = linkedInProfileCall(PROFILE_URL, OPTIONAL_LINKEDIN_PROFILE_ACTOR);
    assert.equal(call.optional, true);
    assert.equal(call.actorPath, "johnvc~linkedin-profile-api");
    assert.deepEqual(call.body, { profileUrls: [PROFILE_URL] });

    const mapped = linkedInProfileItemForTool([
      { result_type: "error", name: "skip" },
      {
        result_type: "profile",
        name: "Example Person",
        firstName: "Example",
        lastName: "Person",
        headline: "Example role",
        summary: "Example summary",
        location: "Example City",
        followers: 3,
        connections: 2,
        publicUrl: PROFILE_URL,
        email: null,
        experience: [
          {
            title: "Example role",
            company: "Example Co",
            start_date: "2020",
            end_date: "2024",
          },
        ],
        education: [{ title: "Example School", start_year: "2016", end_year: "2020" }],
      },
    ]);

    assert.deepEqual(mapped, {
      firstName: "Example",
      lastName: "Person",
      fullName: "Example Person",
      headline: "Example role",
      about: "Example summary",
      location: "Example City",
      followerCount: 3,
      connectionsCount: 2,
      experience: [
        {
          company: "Example Co",
          title: "Example role",
          location: undefined,
          startYear: "2020",
          endYear: "2024",
        },
      ],
      education: [
        {
          school: "Example School",
          startYear: "2016",
          endYear: "2020",
        },
      ],
      publicUrl: PROFILE_URL,
    });
  });
});
