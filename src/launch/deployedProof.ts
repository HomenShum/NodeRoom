export type DeployedProofValidationInput = {
  deployedAuth: string | undefined;
  baseUrl: string | undefined;
  expectedAppCommit: string | undefined;
  expectedBackendRevision: string | undefined;
  expectedConvexUrl: string | undefined;
  gitCommit: string;
  gitBackendRevision: string;
  worktreeDirty: boolean;
};

export function validateDeployedProofInput(input: DeployedProofValidationInput): string[] {
  const errors: string[] = [];
  if (input.deployedAuth !== "1") errors.push("PLAYWRIGHT_DEPLOYED_AUTH must equal 1");
  if (!input.baseUrl) {
    errors.push("PLAYWRIGHT_BASE_URL is required");
  } else {
    try {
      const url = new URL(input.baseUrl);
      if (url.protocol !== "https:") errors.push("PLAYWRIGHT_BASE_URL must use https");
      if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) errors.push("PLAYWRIGHT_BASE_URL must target a deployed environment");
    } catch {
      errors.push("PLAYWRIGHT_BASE_URL must be a valid URL");
    }
  }
  if (!input.expectedAppCommit) errors.push("LAUNCH_EXPECTED_APP_COMMIT is required");
  if (!input.expectedBackendRevision) errors.push("LAUNCH_EXPECTED_BACKEND_REVISION is required");
  if (!input.expectedConvexUrl) {
    errors.push("LAUNCH_EXPECTED_CONVEX_URL is required");
  } else if (!convexDeploymentFromUrl(input.expectedConvexUrl)) {
    errors.push("LAUNCH_EXPECTED_CONVEX_URL must be an https://<deployment>.convex.cloud URL");
  }
  if (!input.gitCommit) errors.push("unable to resolve git HEAD");
  if (!input.gitBackendRevision) errors.push("unable to resolve the local Convex tree revision");
  if (input.worktreeDirty) errors.push("worktree must be clean so the deployed proof binds to one exact candidate");
  if (input.expectedAppCommit && input.gitCommit && input.expectedAppCommit !== input.gitCommit) {
    errors.push(`LAUNCH_EXPECTED_APP_COMMIT must equal git HEAD (${input.gitCommit})`);
  }
  if (input.expectedBackendRevision && input.gitBackendRevision && input.expectedBackendRevision !== input.gitBackendRevision) {
    errors.push(`LAUNCH_EXPECTED_BACKEND_REVISION must equal the local Convex tree revision (${input.gitBackendRevision})`);
  }
  return errors;
}

export function convexDeploymentFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) return undefined;
    const match = url.hostname.match(/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.convex\.cloud$/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}
