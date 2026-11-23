import type { AuthError } from "@supabase/supabase-js";

export type AuthErrorKey =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "weak_password"
  | "user_already_exists"
  | "not_configured"
  | "rate_limited"
  | "link_invalid"
  | "confirm_link_invalid"
  | "same_password"
  | "current_password_invalid"
  | "password_mismatch"
  | "oauth_failed"
  | "unknown";

const AUTH_ERROR_TEXTS: Record<AuthErrorKey, string> = {
  invalid_credentials: "Email or password is incorrect",
  email_not_confirmed: "Confirm your email before you sign in",
  weak_password: "Password must be at least 8 characters",
  user_already_exists: "An account with this email already exists",
  not_configured: "Sign-in is not available right now",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  link_invalid: "This reset link is not valid or it expired. Ask for a new one.",
  confirm_link_invalid: "This confirmation link is not valid or it expired. Sign up again to get a new one.",
  same_password: "Choose a password that is different from the old one.",
  current_password_invalid: "Current password is incorrect.",
  password_mismatch: "The new passwords do not match.",
  oauth_failed: "The sign-in with the provider did not work. Try again.",
  unknown: "Something went wrong. Try again.",
};

export type AuthNoticeKey = "password_changed" | "password_updated";

const AUTH_NOTICE_TEXTS: Record<AuthNoticeKey, string> = {
  password_changed: "Password changed. Sign in with your new password.",
  password_updated: "Password changed. Other devices are signed out.",
};

const CODE_TO_KEY: Record<string, AuthErrorKey> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  weak_password: "weak_password",
  user_already_exists: "user_already_exists",
  email_exists: "user_already_exists",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  same_password: "same_password",
  otp_expired: "link_invalid",
};

/** Maps a Supabase auth error to a fixed error key. Unknown codes give "unknown". */
export function toAuthErrorKey(error: AuthError): AuthErrorKey {
  const code = error.code;
  if (code && Object.hasOwn(CODE_TO_KEY, code)) {
    return CODE_TO_KEY[code];
  }
  return "unknown";
}

/** Maps an error key from the URL to a fixed text. Unknown keys give the generic text. */
export function authErrorText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(AUTH_ERROR_TEXTS, key)) {
    return AUTH_ERROR_TEXTS[key as AuthErrorKey];
  }
  return AUTH_ERROR_TEXTS.unknown;
}

/** Maps a notice key from the URL to a fixed text. Unknown keys give no text. */
export function authNoticeText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(AUTH_NOTICE_TEXTS, key)) {
    return AUTH_NOTICE_TEXTS[key as AuthNoticeKey];
  }
  return null;
}
