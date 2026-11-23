import type { AMREntry } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase";

type ServerClient = NonNullable<ReturnType<typeof createClient>>;

// verifyOtp({ type: "recovery" }) gives the amr method "otp" on the Auth server, not the documented "recovery".
// The sign-up link (verifyOtp type "email") also gives "otp", so a fresh sign-up session passes too. That is an
// accepted risk: both links prove control of the inbox. A password sign-in gives "password" and stays out.
const EMAIL_LINK_METHODS = new Set(["otp", "recovery"]);
// A token refresh keeps amr, so the entry must also be recent. After this window, the user asks for a new link.
const MAX_LINK_AGE_SECONDS = 15 * 60;

/** Returns true only when the verified session comes from a recent email link. Any error or missing claim gives false. */
export async function isRecoverySession(supabase: ServerClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return false;
    const amr: (AMREntry | string)[] | undefined = data.claims.amr;
    if (!Array.isArray(amr)) return false;
    const now = Math.floor(Date.now() / 1000);
    // A string entry from a custom access token hook has no timestamp, so its age is unknown and it does not count.
    return amr.some(
      (entry) =>
        typeof entry !== "string" &&
        EMAIL_LINK_METHODS.has(entry.method) &&
        now - entry.timestamp < MAX_LINK_AGE_SECONDS,
    );
  } catch {
    return false;
  }
}
