// @ts-check
import { defineConfig, envField, fontProviders } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare(),
  // The fonts of the looks. The build downloads them, and the app serves them. Layout.astro loads only the fonts of the active look.
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "Nunito",
      cssVariable: "--font-nunito",
      weights: [400, 600, 800],
      fallbacks: ["system-ui", "sans-serif"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Fraunces",
      cssVariable: "--font-fraunces",
      weights: [400, 600, 800],
      fallbacks: ["Georgia", "serif"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Inter",
      cssVariable: "--font-inter",
      weights: [400, 500, 600, 700, 800],
      fallbacks: ["system-ui", "sans-serif"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Archivo",
      cssVariable: "--font-archivo",
      weights: [400, 500, 600, 700, 800],
      fallbacks: ["Arial", "sans-serif"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Plus Jakarta Sans",
      cssVariable: "--font-plus-jakarta-sans",
      weights: [400, 600, 700, 800],
      fallbacks: ["system-ui", "sans-serif"],
    },
  ],
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // The commit SHA of the build. The deploy job sets it at build time. /healthcheck reports it.
      BUILD_VERSION: envField.string({ context: "server", access: "public", default: "dev" }),
      // The Send Email Hook values. All are optional, so a build without them passes.
      // Without them, /api/hooks/send-email answers 503.
      RESEND_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      SEND_EMAIL_HOOK_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
      EMAIL_FROM: envField.string({ context: "server", access: "secret", optional: true }),
      ADMIN_EMAIL: envField.string({ context: "server", access: "secret", optional: true }),
      // The percent of the Resend Free limits at which the hook sends an alert to ADMIN_EMAIL.
      EMAIL_QUOTA_ALERT_PERCENT: envField.number({ context: "server", access: "secret", default: 80 }),
      // When true, the cookie "look" selects the look of the page. CI and a local .dev.vars set it.
      // The build writes the value into the server code. The production build must not set it.
      ALLOW_LOOK_OVERRIDE: envField.boolean({ context: "server", access: "public", default: false }),
      // The OAuth providers that the sign-in and sign-up pages show, as a comma-separated list: "github,google".
      // The build writes the value into the server code. Without it, the pages show no OAuth button.
      OAUTH_PROVIDERS: envField.string({ context: "server", access: "public", optional: true }),
      // When true, /dashboard/job-check starts the demo job and shows its state. CI and a local .dev.vars set it.
      // The build writes the value into the server code. The production build keeps it off.
      ENABLE_JOB_CHECK: envField.boolean({ context: "server", access: "public", default: false }),
      // When true, a course URL can name a private address, such as localhost. CI sets it for the local fixture site.
      // The build writes the value into the server code. The production build keeps it off.
      ALLOW_PRIVATE_COURSE_URLS: envField.boolean({ context: "server", access: "public", default: false }),
      // The wake request that tells the worker to look for jobs. Both are optional, so a build without them passes.
      // Without them, the app sends no wake request, and a job waits until the worker looks for jobs by itself.
      WORKER_WAKE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      WORKER_WAKE_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
