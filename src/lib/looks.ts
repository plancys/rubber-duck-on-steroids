import type { AstroCookies } from "astro";
import { ALLOW_LOOK_OVERRIDE } from "astro:env/server";
import { site } from "@/lib/site";

// The looks of the app. Each look has a token block in src/styles/themes.css and a shell in src/themes/<look>/Shell.astro.
// scripts/phone-check.mjs has a copy of this list. Change both together.
export const LOOKS = ["warm", "editorial", "calm", "swiss", "dock"] as const;

export type Look = (typeof LOOKS)[number];

function isLook(value: string | undefined): value is Look {
  return LOOKS.some((look) => look === value);
}

// Returns the active look: site.theme, or the value of the cookie "look" when ALLOW_LOOK_OVERRIDE is true.
// The build writes ALLOW_LOOK_OVERRIDE into the server code. The production build must not set it.
export function activeLook(cookies?: AstroCookies): Look {
  if (ALLOW_LOOK_OVERRIDE) {
    const value = cookies?.get("look")?.value;
    if (isLook(value)) return value;
  }
  return site.theme;
}
