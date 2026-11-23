# Repository Guidelines

An MVP baseline web app: Astro 7 server-rendered pages with React 19 islands, TypeScript, Tailwind 4, Supabase auth, deployed to Cloudflare Workers. Product scope: @context/foundation/prd.md. Stack decision: @context/foundation/tech-stack.md. Starter rules in full: @CLAUDE.md.scaffold.

## Hard rules

- Never commit secrets. `SUPABASE_URL` and `SUPABASE_KEY` go in `.env` and `.dev.vars`, both gitignored, copied from @.env.example.
- Do not edit the block between the `BEGIN` and `END` markers in @CLAUDE.md. The toolkit CLI rewrites it. Do not write under `context/archive/`.
- Every new Supabase table gets RLS with one policy per operation and role. Per-user data isolation is a PRD guardrail.
- Business logic must not change auth, deploy, or pipeline files.
- API routes export uppercase `GET` and `POST` and set `export const prerender = false`.
- Work on a branch. Do not commit on `main`.

## Build, test, and development commands

- `npm start`: the full local run via `scripts/local.mjs`. It checks Docker, starts local Supabase, applies pending migrations, writes `.env` and `.dev.vars` only when missing, then runs `astro dev`. `--setup-only` stops before `astro dev`. It skips Docker and Supabase when an env file has a cloud `SUPABASE_URL`. Ctrl+C stops only `astro dev`. `npx supabase stop` stops Supabase.
- In an agent session, Astro starts `astro dev` in the background and `npm start` exits 0. The port can differ from 4321. Stop the server with `npx astro dev stop`.
- `npm run dev`: dev server on the Cloudflare workerd runtime. `npm run build`: production SSR build.
- `npm run lint`, `npm run lint:fix`, `npm run format`: ESLint with type-checked rules, then Prettier. `npx astro check`: types. CI runs both.
- `npm run smoke`: auth-flow smoke test against a running server, `BASE_URL` default `http://localhost:4321`.
- `npm run phone-check`: `scripts/phone-check.mjs` opens every page at 375px and 320px in headless Chromium and checks the phone rules. Same `BASE_URL` default. One-time setup: `npx playwright install chromium`. CI runs it in the `smoke` job, before the smoke test.
- `npx supabase start`: local Supabase, needs Docker. Node version: @.nvmrc.
- `npx supabase test db`: pgTAP policy tests in `supabase/tests/`. CI runs them in the `smoke` job.
- `npm run db:types`: writes `src/db/database.types.ts` from the local schema. Run it after each schema change.
- `npm run setup:prod`: `scripts/setup-prod.mjs`, the production setup. It creates or reuses the Supabase project, sets the `production` environment secrets and variables in GitHub, and applies the Supabase auth settings and the Send Email Hook. It asks before it replaces a value. A human runs it. The README "Deployment > One-time setup" section has the manual steps.

<!-- BEGIN sample-resource -->

- `npm run remove:sample`: `scripts/remove-sample.mjs` removes the notes sample in one run. It asks whether to add a migration that drops the `notes` table. The default keeps the table. `--yes` keeps the table without the question. `--drop-table` drops it without the question. The script deletes itself.

<!-- END sample-resource -->

## Project structure

- `src/pages/`: Astro pages. `src/pages/api/auth/`: sign-in, sign-up, sign-out, reset, new-password, and change-password endpoints. `src/pages/dashboard.astro`: the protected page.
- Password reset: `src/pages/auth/reset.astro`, `src/pages/auth/confirm.ts`, `src/pages/auth/new-password.astro`. `src/lib/recovery.ts`: the guard that accepts only a session from a recent email link. The reset link and the sign-up link both count, because both prove control of the inbox.
- Password change: `src/pages/dashboard/settings.astro`: the settings page with the change form. `src/pages/api/auth/change-password.ts`: the route checks the current password before it saves the new one. Then it signs out all other sessions of the user. Two Supabase settings break it: `secure_password_change = true` makes each change fail, and the `password_changed` notification needs its type in `buildEmail`.
- OAuth login: `src/pages/api/auth/oauth.ts`: the route that starts the GitHub or Google sign-in. `src/pages/auth/callback.ts`: the route that ends it. `src/lib/oauth.ts`: the active provider list from `OAUTH_PROVIDERS`. `OAUTH_PROVIDERS` is a public build-time setting, for example `github,google`. Without it, the pages show no OAuth button. A human registers the OAuth apps and enters the client secrets in `npm run setup:prod`. An agent does not do these steps. The README section "OAuth login" has the steps.
- Auth emails: `src/pages/api/hooks/send-email.ts`: the Supabase Send Email Hook route. It sends the sign-up and reset emails through Resend. `src/lib/email-hook.ts`: the signature check, the email texts, and the quota alert. The hook refuses every other email type with 400, so a new email flow needs its type in `buildEmail`.
- `src/layouts/Layout.astro`: `<head>` and the config banner. `src/layouts/AppLayout.astro`: the shell of the signed-in pages. `src/lib/nav.ts`: the page links and the account links. A new signed-in page imports `AppLayout`, adds one entry to `navLinks`, and adds one `Entry` to the dashboard. An account page, such as Settings, adds one entry to `accountLinks` and gets no dashboard entry. The account links show right before Sign out.
- Looks: `theme` in `src/lib/site.ts` names the active look: `warm`, `editorial`, `calm`, `swiss` or `dock`. `src/lib/looks.ts`: `LOOKS` and `activeLook()`. `src/styles/themes.css`: one token block for each look. `src/themes/<look>/Shell.astro`: the shell of each look. `AppLayout.astro` picks it. `src/components/Entry.astro` and `src/components/EntryList.astro`: a dashboard entry and its container, in the form of the active look. The cookie `look` overrides the look only when `ALLOW_LOOK_OVERRIDE` is true. Production does not set it. `LOOKS=all npm run phone-check` checks all five looks.
- `src/components/`: Astro for static content, React only for interactivity. `src/components/ui/`: shadcn components.
- `src/lib/`: Supabase client, `cn()` helper, services. `src/middleware.ts`: session lookup and `PROTECTED_ROUTES`.
- `supabase/`: local config and migrations. `supabase/tests/`: pgTAP policy tests. `src/db/`: generated database types. `scripts/smoke.mjs`: the smoke test. `context/`: foundation docs and change logs.

<!-- BEGIN sample-resource -->

- Sample resource (notes): `src/pages/dashboard/notes/`, `src/pages/api/notes/`, `src/components/notes/`, `src/lib/notes.ts`, the Notes entry in `src/lib/nav.ts`, and the Notes card in `src/pages/dashboard.astro`. `npm run remove:sample` removes all of it.

<!-- END sample-resource -->

## Coding style and naming

- Prettier per @.prettierrc.json: 120 columns, double quotes, semicolons. ESLint strict type-checked. Unused variables start with `_`. A `console` call is a warning.
- Import with the `@/*` alias. Merge Tailwind classes with `cn()` from `@/lib/utils`, never by string concatenation.
- Use token classes, never a color name class. For example, use `bg-card`, `text-muted-foreground`, `bg-primary text-primary-foreground` and `border-border`, not `bg-white` or `text-purple-500`. A look changes the app only through the tokens in `src/styles/themes.css`.
- React components: PascalCase `.tsx`, no Next.js directives. Hooks in `src/components/hooks/`. Shared types in `src/types.ts`.
- Migrations: `YYYYMMDDHHmmss_short_description.sql`. Pre-commit: husky runs lint-staged (`eslint --fix`, `prettier --write`).

## Testing

- No unit test runner yet. The smoke script and the phone check are the only automated tests. CI runs both against the production preview with a local Supabase.
- `npm run phone-check` checks the phone rules on every page. No sideways scroll at 320px, and no element reaches past the right edge. The bar (`data-testid="shell-nav"`) is at most 64px high. Every link and button is at least 44px high and wide. Every input has a font size of at least 16px. A new link or button uses `min-h-11 min-w-11`.

## Commit and pull request guidelines

- Subject: imperative, sentence case, no type prefix, as in `git log`. Body: name the tool that generated the files. Agent commits end with a `Co-Authored-By:` trailer.
- CI gate (@.github/workflows/ci.yml): the `ci` job (lint, `astro check`, build) and the `smoke` job run in parallel. The build needs the `SUPABASE_URL` and `SUPABASE_KEY` repository secrets.

## Security and configuration

- Secrets are server-only via the `astro:env` schema in @astro.config.mjs. Never read them in client code.
- CI deploys `main` to production in the `deploy` job of @.github/workflows/ci.yml. An agent does not run `npx wrangler deploy` by hand.
- `/healthcheck` shows the live version as the commit SHA.
- Human actions only: `npx wrangler rollback`, the Cloudflare API token, and the production secrets. The README "Deployment" section has the steps.
- A human registers the GitHub and Google OAuth apps and enters their client secrets in `npm run setup:prod`.
- The human runs `npm run setup:prod`. An agent does not run it. `SUPABASE_ACCESS_TOKEN` goes only in the env of that one command. It never goes to CI, to a GitHub secret, or to a file.
