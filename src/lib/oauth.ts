import { OAUTH_PROVIDERS as OAUTH_PROVIDERS_SETTING } from "astro:env/server";

export type OAuthProviderId = "github" | "google";

export interface OAuthProvider {
  id: OAuthProviderId;
  label: string;
}

const PROVIDER_LABELS: Record<OAuthProviderId, string> = {
  github: "GitHub",
  google: "Google",
};

// Reads a comma-separated list of provider names. The function drops unknown and repeated names.
function parseProviders(setting: string | undefined): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  for (const raw of (setting ?? "").split(",")) {
    const name = raw.trim().toLowerCase();
    if (!Object.hasOwn(PROVIDER_LABELS, name)) continue;
    const id = name as OAuthProviderId;
    if (providers.some((provider) => provider.id === id)) continue;
    providers.push({ id, label: PROVIDER_LABELS[id] });
  }
  return providers;
}

/** The active OAuth providers, in the order of the OAUTH_PROVIDERS setting. */
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = parseProviders(OAUTH_PROVIDERS_SETTING);

/** Returns the active provider with this id, or null when the id is not active. */
export function findOAuthProvider(id: string | null): OAuthProvider | null {
  return OAUTH_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** The sign-in page with the OAuth error. It keeps a checked next path, as the password sign-in does. */
export function oauthFailedPath(next: string | null): string {
  return `/auth/signin?error=oauth_failed${next ? `&next=${encodeURIComponent(next)}` : ""}`;
}
