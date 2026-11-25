import { env } from "cloudflare:workers";

// "extension" limits the extension routes, which take a token instead of a session.
export type AuthRoute = "signin" | "signup" | "reset" | "password" | "oauth" | "extension";

// The form of each auth route. The password change form and the tokens are on the settings page.
// The OAuth buttons are on the sign-in page. The other forms are under /auth.
function formPathFor(route: AuthRoute): string {
  if (route === "password" || route === "extension") return "/dashboard/settings";
  if (route === "oauth") return "/auth/signin";
  return `/auth/${route}`;
}

// astro dev, astro preview and CI send no CF-Connecting-IP. All of them share this one bucket.
const FALLBACK_IP = "local";

/** Returns true when this client IP used up its attempts for this auth route. */
export async function isAuthRateLimited(request: Request, route: AuthRoute): Promise<boolean> {
  const limiter = env.AUTH_RATE_LIMITER;
  const ip = request.headers.get("CF-Connecting-IP") ?? FALLBACK_IP;
  // Fail open: a missing or broken binding must not lock every user out. Supabase still limits auth calls.
  if (!limiter) {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn("AUTH_RATE_LIMITER binding is missing. Auth attempts are not limited per IP.");
    return false;
  }
  try {
    const { success } = await limiter.limit({ key: `${route}:${ip}` });
    return !success;
  } catch (error) {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn("AUTH_RATE_LIMITER check failed. Auth attempts are not limited per IP.", error);
    return false;
  }
}

/** Builds the 429 page with a link back to the form of this auth route. */
export function rateLimitedResponse(route: AuthRoute): Response {
  const formPath = formPathFor(route);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Too many attempts</title>
  </head>
  <body>
    <p>Too many attempts. Try again in a minute.</p>
    <p><a href="${formPath}">Back to the form</a></p>
  </body>
</html>
`;
  return new Response(html, {
    status: 429,
    headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "60" },
  });
}
