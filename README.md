# Rubber Duck on Steroids

![](./public/template.png)

A template for a new product idea. It gives you email and password auth, a protected sample resource, CI, and a deploy path.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v26.13.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/plancys/rubber-duck-on-steroids.git
cd rubber-duck-on-steroids
```

2. Install dependencies:

```bash
npm install
```

3. Start the app:

```bash
npm start
```

`npm start` starts a local Supabase, writes the env files, and starts the development server at `http://localhost:4321` by default. It needs [Docker](https://www.docker.com/). See [Supabase Configuration](#supabase-configuration) below for the details.

## Available Scripts

- `npm start` - Start local Supabase, write missing env files, and start the development server
- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth flow against a running server (`BASE_URL`, defaults to `http://localhost:4321`)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ │ └── AppLayout.astro # The shell of the signed-in pages
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ ├── lib/ # Supabase client, services, helpers
│ │ └── nav.ts # The page links of the signed-in bar
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

### Add a signed-in page

A signed-in page lives under `src/pages/dashboard/`. Three steps:

1. Import `AppLayout` from `src/layouts/AppLayout.astro` and put the page content inside it.
2. Add one entry to `navLinks` in `src/lib/nav.ts`.
3. Add one entry card to `src/pages/dashboard.astro`.

## Looks

The app has five looks. Each look sets the colors, the fonts, the radius, the shadows, and the arrangement of the signed-in pages:

| Look        | Arrangement                                                                    |
| ----------- | ------------------------------------------------------------------------------ |
| `warm`      | Warm soft, the default. A narrow centered column with a pill navigation.       |
| `editorial` | Editorial light. A masthead with a serif title and a ruled list of entries.    |
| `calm`      | Calm dark SaaS. A left sidebar with icon links and a grid of bordered cards.   |
| `swiss`     | Swiss grid. A left index rail with numbered links and a table-like entry list. |
| `dock`      | Dock. A top row with the brand and a bottom dock with icon links and Sign out. |

The `theme` value in `src/lib/site.ts` sets the active look. Change the value to change the look of a copy.

A look has three parts:

- A token block in `src/styles/themes.css`.
- A shell in `src/themes/<look>/Shell.astro`.
- An entry form in `src/components/Entry.astro` and `src/components/EntryList.astro`.

The pages use token classes, for example `bg-card` and `text-muted-foreground`, so one set of pages serves all five looks.

To see a different look on a local server, set `ALLOW_LOOK_OVERRIDE=true` in `.dev.vars`. Then set the cookie `look` in the browser to the name of a look. Without `ALLOW_LOOK_OVERRIDE`, the cookie has no effect. The production build must not set it.

The build writes the value of `ALLOW_LOOK_OVERRIDE` into the server code. After a change to the flag in `.dev.vars`, restart `npm run dev`. For `npm run preview`, run `npm run build` again before you start the preview.

To check the phone rules on all five looks, run the phone check with `LOOKS=all`. The server must have `ALLOW_LOOK_OVERRIDE=true` in its build:

```bash
LOOKS=all BASE_URL=http://localhost:4321 npm run phone-check
```

`LOOKS=calm,dock` checks only those looks. Without `LOOKS`, the check runs one time on the active look.

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM. Start Docker before you run the command.

```bash
npm start
```

`npm start` runs `scripts/local.mjs`. The script does these steps:

1. It checks that Docker runs.
2. It starts the local Supabase stack. The first run downloads the Docker images.
3. It applies the pending migrations to the local database. It does this on each start.
4. It writes `.env` and `.dev.vars` with the local `SUPABASE_URL` and `SUPABASE_KEY`, but only when a file does not exist. It never changes an existing file. When an existing file does not match the local stack, the script names the file and stops before the development server starts. Delete that file, then run `npm start` again.
5. It starts the development server with `astro dev`.

Ctrl+C stops only the development server. The local Supabase stack continues to run. To stop the stack:

```bash
npx supabase stop
```

To prepare Supabase and the env files without the development server, run `node scripts/local.mjs --setup-only`.

The local Studio UI is available at `http://localhost:54323`.

<!-- BEGIN sample-resource -->

The sample resource uses one table, `notes`. Its migration is in `supabase/migrations/`. `npm start` applies it to the local database.

<!-- END sample-resource -->

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

When `.env` or `.dev.vars` has a cloud `SUPABASE_URL`, `npm start` skips Docker and the local database. When only one of the two files exists, the script copies it to the other file. Then it starts the development server.

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                       | Description                                                                      |
| --------------------------- | -------------------------------------------------------------------------------- |
| `/auth/signin`              | Email/password sign-in form                                                      |
| `/auth/signup`              | Email/password sign-up form                                                      |
| `/auth/confirm-email`       | Post-signup "check your inbox" page                                              |
| `/auth/reset`               | Form that sends a password reset link                                            |
| `/auth/confirm`             | Checks the reset link or the sign-up link from the email                         |
| `/auth/new-password`        | New password form. It opens only from a reset link                               |
| `/dashboard`                | Example protected page (redirects to `/auth/signin` if unauthenticated)          |
| `/dashboard/settings`       | Password change form. It asks for the current password                           |
| `/api/auth/change-password` | Checks the current password, saves the new one, and signs out the other sessions |
| `/api/hooks/send-email`     | Supabase Send Email Hook. Sends the sign-up and reset emails through Resend      |
| `/api/auth/oauth`           | Starts the GitHub or Google sign-in. See [OAuth login](#oauth-login)             |
| `/auth/callback`            | Ends the GitHub or Google sign-in and opens the app                              |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

### Health check

| Route          | Description                                           |
| -------------- | ----------------------------------------------------- |
| `/healthcheck` | Public. Returns the status and the build version JSON |

<!-- BEGIN sample-resource -->

### Sample resource

The notes pages show one resource that each user owns. A user sees, changes, and deletes only their own notes. Row Level Security in the database enforces this rule. The Notes entry in the bar and the Notes card on the dashboard are `sample-resource` blocks.

| Route                   | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `/dashboard/notes`      | The list of notes of the signed-in user, and the create form |
| `/dashboard/notes/[id]` | The edit form of one note. Another user's note gives a 404   |

<!-- END sample-resource -->

### Database changes

1. Add a migration file to `supabase/migrations/`. Name it `YYYYMMDDHHmmss_short_description.sql`. Give each new table RLS with one policy per operation and role.
2. Apply the migration to the local database:

```bash
npx supabase db reset
```

`npm start` also applies a new migration. When you edit a migration that the local database already has, run `npx supabase db reset`.

3. Run the policy tests in `supabase/tests/`:

```bash
npx supabase test db
```

4. Update the TypeScript types in `src/db/database.types.ts`:

```bash
npm run db:types
```

<!-- BEGIN sample-resource -->

### Remove the sample resource

Remove the notes sample in one step when you start your own resource:

```bash
npm run remove:sample
```

The script deletes the notes pages, API routes, components, service and policy test. It also deletes the notes parts of the dashboard, the smoke test, the CI workflow, this README and `AGENTS.md`. Then it deletes itself and prints the files that it changed and the next steps.

The script asks one question: `Add a migration that drops the notes table? [y/N]`. The default is no, so the table stays in the database. Two flags skip the question:

- `--yes`: removes the sample and keeps the table.
- `--drop-table`: removes the sample and writes a migration that drops the table. The next deploy deletes the notes in production. Check the migration in the PR diff before you merge, because the merge starts that deploy.

Without a terminal, the script needs one of the two flags. Otherwise it stops before it changes a file.

The script does not delete the migration `supabase/migrations/20261103220000_create_notes.sql`. A database that already has this migration keeps it in its history. When the remote history has a migration that the local folder does not have, `npx supabase db push` fails.

When you keep the table, `src/db/database.types.ts` stays correct, because the table still exists. When you drop the table, apply the migration and update the types:

```bash
npx supabase migration up && npm run db:types
```

Run `npm run lint` and `npm run build`, then commit the result.

<!-- END sample-resource -->

### Production auth settings

`npm run setup:prod` applies Confirm email, the minimum password length, Site URL, Redirect URLs, the Send Email Hook, and then the email rate limit. To apply a setting by hand, open the hosted Supabase project, under **Authentication**:

- **Confirm email**: on.
- **Minimum password length**: 8. This matches the sign-up form and `supabase/config.toml`.
- **Rate limit for sending emails** (**Authentication → Rate Limits**): 30 an hour. Supabase checks this limit before it calls the Send Email Hook, so the default limit of the built-in sender blocks sign-ups after a few emails. Supabase accepts a new limit only when the Send Email Hook is on or custom SMTP is set. Set the hook first.
- **Site URL**: the production URL of the app. While the Send Email Hook is off, the reset email template uses `{{ .SiteURL }}`, so a wrong Site URL breaks the reset link. With the hook on, the hook builds the links from the URL that Supabase calls.
- **Redirect URLs**: the production URL of the app, and `PRODUCTION_URL/auth/callback**` for the OAuth login.
- **Reset password email template**: use the link from `supabase/templates/recovery.html`: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
- **Send Email Hook**: set it before real users sign up or reset a password. The default Supabase email sender sends only to the addresses of the project team, and it has a low hourly limit. Under **Authentication → Hooks**, add a Send Email hook of the type HTTPS with the URL `PRODUCTION_URL/api/hooks/send-email`. Supabase then calls the app instead of its own mailer, and the app sends the email through [Resend](https://resend.com/). The route checks the hook signature with `SEND_EMAIL_HOOK_SECRET` and sends only the sign-up and reset emails. Supabase sends every auth email type through the hook, so the hook refuses magic link, invite, email change, and reauthentication emails with 400. A new email flow needs its type in `buildEmail` in `src/lib/email-hook.ts`. It needs these Worker values:
  - `SEND_EMAIL_HOOK_SECRET`: the hook secret in the form `v1,whsec_<base64>`. `npm run setup:prod` generates it and sets the same value in GitHub and in Supabase. Without it, the route answers 503.
  - `RESEND_API_KEY` and `EMAIL_FROM`: the Resend API key and a sender address on a domain that Resend verified. Without them, the route answers 503.
  - `ADMIN_EMAIL` (optional): the address that gets an alert when the app uses `EMAIL_QUOTA_ALERT_PERCENT` (default `80`) of the Resend Free limits of 100 emails a day or 3,000 a month. The hook sends one alert for each limit until the quota resets: midnight UTC for the daily limit, the first day of the month for the monthly limit. It records each alert in the KV namespace `QUOTA_ALERTS`. Without that binding, it sends no alert.
- **Sign-up link**: the hook sends `PRODUCTION_URL/auth/confirm?token_hash=<hash>&type=email`. A valid link opens `/dashboard`.
- **Mail link scanners**: some mail systems, for example Outlook Safe Links, open links before the user does. This uses up the one-time reset link, and the user sees "This reset link is not valid or it expired". The user can ask for a new link. This is an accepted risk.

Do not rely on Supabase to limit sign-in attempts. The app limits sign-in, sign-up, and password reset attempts with a Cloudflare Workers rate-limit binding.

### OAuth login

The sign-in and sign-up pages can show "Continue with GitHub" and "Continue with Google". The `OAUTH_PROVIDERS` setting names the providers, for example `github,google`. The build reads the setting. Without it, the pages show no OAuth button.

A human registers each OAuth app and enters each client secret. An agent does not do these steps.

#### Callback URLs

Each provider sends the user back to Supabase, not to the app. Give the provider the Supabase callback URL:

| Environment | Supabase callback URL                                |
| ----------- | ---------------------------------------------------- |
| Local       | `http://127.0.0.1:54321/auth/v1/callback`            |
| Production  | `https://<project-ref>.supabase.co/auth/v1/callback` |

The production URL is `SUPABASE_URL` plus `/auth/v1/callback`. `npm run setup:prod` shows it before it asks for the client values. The script builds that URL from the project ref. With a custom Supabase domain, give the provider your custom domain plus `/auth/v1/callback`.

A GitHub OAuth app accepts only one callback URL. Register one GitHub OAuth app for local work and one for production.

#### Register a GitHub OAuth app

1. Open <https://github.com/settings/developers>, then **OAuth Apps → New OAuth App**.
2. **Homepage URL**: `http://localhost:4321` for local work, or `PRODUCTION_URL` for production.
3. **Authorization callback URL**: the Supabase callback URL from the table above.
4. Keep **Allow wildcard matching**, **Enable Device Flow** and **Expire user access tokens** off.
5. Select **Register application**. Copy the client ID.
6. Select **Generate a new client secret**. Copy the secret now. GitHub shows it only once.

#### Register a Google OAuth client

1. Open <https://console.cloud.google.com> and select or create a project.
2. Go to **APIs & Services → OAuth consent screen**. In the new console, this is **Google Auth Platform**.
3. Set the user type to **External**. Add your own address as a test user while the app is in testing.
4. Go to **Clients → Create client**. Set the type to **Web application**.
5. Under **Authorized redirect URIs**, add the Supabase callback URL from the table above.
6. Select **Create**. Copy the client ID and the client secret.

#### Local setup

1. Put the client values in `supabase/.env`. Do not commit them:

```
SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID=<client id>
SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET=<client secret>
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<client id>
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<client secret>
```

2. In `supabase/config.toml`, set `enabled = true` in `[auth.external.github]`, `[auth.external.google]` or both.
3. Set `OAUTH_PROVIDERS` in `.env` and `.dev.vars`, for example `OAUTH_PROVIDERS=github,google`.
4. Restart Supabase: `npx supabase stop`, then `npx supabase start`. Then restart the dev server.

#### Production setup

Run `npm run setup:prod`. See [One-time setup](#one-time-setup). Step 5c asks for the client ID and the client secret of each provider. An empty client ID skips that provider. The secret prompt hides the characters. The script turns on each provider in Supabase, adds `PRODUCTION_URL/auth/callback**` to the Redirect URLs, and sets the GitHub variable `OAUTH_PROVIDERS`. The next deploy builds the buttons.

#### Accounts

- When the provider email matches an existing account, Supabase links the provider to that account. The user keeps the same data.
- A user who signs up with a provider has no password. To add a password, the user selects **Forgot password** on the sign-in page.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/). The `deploy` job in `.github/workflows/ci.yml` deploys `main` to production. Do not deploy by hand.

### One-time setup

`scripts/setup-prod.mjs` does each provider step that a script can do safely. Some steps stay manual. Do the setup in this order:

1. Do the manual steps in the table "Steps that stay manual" below. You need the Cloudflare API token, the `workers.dev` subdomain, the Resend sending-only key, and a Supabase access token.
2. Log in to the CLIs: `gh auth login` and `npx wrangler login`.
3. Run the setup script. Set the access token for this one command only:

```bash
SUPABASE_ACCESS_TOKEN=<token> npm run setup:prod
```

4. Merge to `main`, or open **Actions → CI → Run workflow** and select `main`. The deploy job deploys the Worker with the new values.
5. Run the setup script again. The deployed hook route now answers, and the script turns on the Send Email Hook.

The script runs these steps in this order. Each step reads the current state first. It asks before it replaces a value.

1. **Prerequisites**: `SUPABASE_ACCESS_TOKEN`, the `gh` login, and the `wrangler` login. It names each missing item and stops before it writes.
2. **Supabase project**: it lists your projects, with the project that has the Worker name first. You pick one, or it creates one (default region `eu-central-1`) with a random database password. It shows the password only once. The script stops when the token cannot see the project in `SUPABASE_PROJECT_REF`, because the token then belongs to another Supabase account. It also asks before it uses a project whose Site URL belongs to another app. The default answer is no.
3. **Supabase keys and database URL**: the project URL, the `anon` or publishable key, and the Session pooler URL.
4. **Cloudflare**: the account ID from `wrangler whoami`, `PRODUCTION_URL` from the subdomain, and the API token.
5. **Resend**: `EMAIL_FROM`, `ADMIN_EMAIL`, the API key, and a generated `SEND_EMAIL_HOOK_SECRET`. A new secret goes to Supabase first, with the hook off. If you decline that write, the script stops before GitHub changes.
   - **OAuth providers** (step 5c): it shows the Supabase callback URL, then asks for the GitHub and the Google client ID and secret. An empty client ID skips the provider. A provider that is on stays on unless you answer no. It turns on the providers in Supabase, then puts the providers that are on in `OAUTH_PROVIDERS`. See [OAuth login](#oauth-login).
6. **GitHub**: the `production` environment with the branch rule `main`, then the secrets and the variables.
7. **Supabase auth settings**: Site URL, Redirect URLs with the OAuth callback, Confirm email, and the minimum password length.
8. **Send Email Hook**: it turns on the hook only when the deployed route answers 401 to a call without a signature. In the run that makes a new secret, the hook stays off, because the deployed Worker does not have the secret yet. Run the deploy, then run setup again. With the hook on, the script sets the email rate limit of 30 an hour. Supabase accepts that value only after the hook is on.
9. **Summary**: one line for each step, and the manual steps that are still open.

The script never writes a file. It never prints a key, token, or password, except the new database password. It sends each secret to `gh` over stdin. Ctrl+C stops it at once.

#### Steps that stay manual

| Step                                                                                                                                                                      | Why it stays manual                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Create the Cloudflare account.                                                                                                                                            | An account needs a person, an email, and the terms of service.                                                           |
| Create the Cloudflare API token: **My Profile → API Tokens → Create Token**, template **Edit Cloudflare Workers**, only your account, no zones, no DNS or billing access. | A script needs a token that can create tokens. That token has more access than the deploy needs.                         |
| Find the `workers.dev` subdomain: **Workers & Pages** → account subdomain.                                                                                                | The script cannot read it without the API token. It asks you for the value.                                              |
| Create the Resend account.                                                                                                                                                | An account needs a person, an email, and the terms of service.                                                           |
| Add the domain in Resend and set its DNS records at your DNS provider.                                                                                                    | The records go to a DNS provider that the script has no access to. Resend verifies the domain after the records go live. |
| Create the Resend API key with **Sending access** only.                                                                                                                   | Resend shows a key only once. You paste it into the hidden prompt.                                                       |
| Create the Supabase access token: **Account → Access Tokens**. Revoke it after the setup.                                                                                 | The token has access to all your Supabase projects. You create it, you use it for one run, and you revoke it.            |
| Save the database password in a password manager.                                                                                                                         | The script shows the password only once and never writes it to a file.                                                   |

#### Secrets and variables

The script sets these values in the `production` environment. To set a value by hand, use **Settings → Environments → production**.

| Name                        | Type     | Where the value comes from                                                                                                                                                               |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`      | Secret   | The token from the manual steps. Cloudflare shows it only once.                                                                                                                          |
| `CLOUDFLARE_ACCOUNT_ID`     | Secret   | `npx wrangler whoami`, or the Cloudflare dashboard → **Workers & Pages** → **Account ID**.                                                                                               |
| `SUPABASE_URL`              | Secret   | `https://<project ref>.supabase.co`. Supabase project → **Settings → API** → **Project URL**.                                                                                            |
| `SUPABASE_KEY`              | Secret   | The `anon` or publishable key. Never the `service_role` key or a secret key.                                                                                                             |
| `SUPABASE_DB_URL`           | Secret   | The **Session pooler** string: Supabase project → **Connect** → **Session pooler**. Replace `[YOUR-PASSWORD]` with the percent-encoded database password, for example `@` becomes `%40`. |
| `RESEND_API_KEY`            | Secret   | The Resend API key with **Sending access** only.                                                                                                                                         |
| `SEND_EMAIL_HOOK_SECRET`    | Secret   | `v1,whsec_` and base64 of 32 random bytes. The script generates it and stores the same value in the Supabase hook.                                                                       |
| `SUPABASE_PROJECT_REF`      | Variable | The ref of the production Supabase project. The setup script writes it and checks it on the next run.                                                                                    |
| `PRODUCTION_URL`            | Variable | `https://<worker name>.<subdomain>.workers.dev`. The Worker name is `name` in `wrangler.jsonc`. The first deploy prints the same URL.                                                    |
| `EMAIL_FROM`                | Variable | A sender address on the domain that Resend verified.                                                                                                                                     |
| `ADMIN_EMAIL`               | Variable | Optional. The address that gets the Resend quota alert.                                                                                                                                  |
| `OAUTH_PROVIDERS`           | Variable | Optional. The OAuth providers that are on, for example `github,google`. The build reads it. See [OAuth login](#oauth-login).                                                             |
| `EMAIL_QUOTA_ALERT_PERCENT` | Variable | Optional. The quota percent that sends the alert. The default is `80`. The script does not set it. Set it by hand.                                                                       |

> **Warning: use the Session pooler string for `SUPABASE_DB_URL`.** The direct string with the host `db.<project ref>.supabase.co` uses only IPv6. GitHub runners cannot reach it, and the migration step fails.

The first deploy needs `PRODUCTION_URL`, so the script sets it before you merge or run the workflow.

### The pipeline

On each push to `main`, the workflow runs these jobs:

1. `ci` and `smoke` run in parallel.
2. When both pass, `deploy` starts. It builds the app with the commit SHA as `BUILD_VERSION`.
3. `deploy` applies the pending migrations with `npx supabase db push`. A failed migration stops the job before the new code goes live.
4. `deploy` runs `npx wrangler deploy`. It sends `SUPABASE_URL` and `SUPABASE_KEY` to the Worker as secrets. It also sends `RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET`, `EMAIL_FROM`, `ADMIN_EMAIL`, `EMAIL_QUOTA_ALERT_PERCENT`, `WORKER_WAKE_URL`, and `WORKER_WAKE_SECRET` when they are set.
5. `deploy` reads `PRODUCTION_URL/healthcheck` every 5 seconds for up to 60 seconds. The job passes when the `version` field equals the commit SHA.

When `ci` and `smoke` pass, `deploy-worker` also starts, next to `deploy`. It deploys the background worker to Google Cloud Run when a file in `worker/` changed, and on each manual run. See [Background worker](#background-worker).

A newer merge waits for a running deploy. It does not cancel it.

To deploy again without a new commit, open **Actions → CI → Run workflow** and select `main`. A manual run fails when a required value is missing. The email values are optional. The error names each missing value.

On a fresh copy of this repository, `CLOUDFLARE_API_TOKEN` is not set. A push to `main` then skips the deploy steps and shows a notice. The job stays green. When the token is set but another value is missing, the job fails.

> **Warning: destructive migrations.** The migrations run before the new Worker goes live. During the deploy, the old Worker version runs against the new schema. A migration that drops or renames a column that the old code uses breaks production. Release a destructive change in two steps. First, deploy code that does not use the column. Then, in a later release, add the migration that drops it.

### Rollback

1. List the Worker versions:

```bash
npx wrangler versions list
```

2. Roll back to a known good version:

```bash
npx wrangler rollback <VERSION_ID> --message "<reason>"
```

3. Open `PRODUCTION_URL/healthcheck` and check that `version` shows the commit SHA that you expect.

A rollback reverts only the Worker. Supabase migrations do not roll back with the Worker. To undo a schema change, add a new migration. A rollback, the API token, and the secrets are human actions.

### Worker name and namespace

`wrangler.jsonc` has two values that each project must own:

- `name`: the Worker name. It is also part of `PRODUCTION_URL`.
- `ratelimits[0].namespace_id`: a value that is unique in the Cloudflare account.

The KV binding `QUOTA_ALERTS` has no `id`. The first deploy creates the namespace in the new account, so a new project changes nothing for it.

### Background worker

The background worker does the long work of a job outside the web app. It is a plain Node process in `worker/`, with no dependency. It takes jobs from the `jobs` table through the Supabase REST API, one job at a time. The web app sends `POST /wake` to the worker after it creates a job. `GET /health` answers `ok` while the worker runs.

In production, the worker runs on [Google Cloud Run](https://cloud.google.com/run) as the service `rubber-duck-on-steroids-worker`. The `deploy-worker` job in `.github/workflows/ci.yml` deploys it. The service runs at most one instance, and no instance when it has no work. Google bills the time that an instance is on: the job time plus up to 15 idle minutes after the last request.

> **Warning: the Supabase service key passes all access rules.** It skips Row Level Security, so it can read and change the data of every user. It goes only to the worker: it lives in Google Secret Manager, and Cloud Run reads it from there. Never put it in `.env`, `.dev.vars`, a Cloudflare Worker secret, or a file. Cloud Run shows the environment variables of the service to each account that can view the Google project. Give no other account access to the project.

#### Run the worker on your machine

1. Start the local Supabase and the app with `npm start`.
2. In `.dev.vars`, set these values, then restart `npm start`:

```
ENABLE_JOB_CHECK=true
WORKER_WAKE_URL=http://localhost:8788/wake
WORKER_WAKE_SECRET=local-wake-secret
```

3. In a second terminal, start the worker:

```bash
npm run worker
```

The script reads the local service key into memory and starts the worker on port 8788. Ctrl+C releases the current job and stops the worker.

4. Sign in, open `http://localhost:4321/dashboard/job-check`, and start a demo job.

To check the container image, build it and run it against the local Supabase. `npx supabase status -o env` shows the local service key as `SERVICE_ROLE_KEY`. Use only the local key on your machine.

```bash
docker build -t rubber-duck-worker worker/
docker run --rm -p 8788:8788 --add-host=host.docker.internal:host-gateway \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  -e SUPABASE_SERVICE_KEY=<local service key> \
  -e WORKER_WAKE_SECRET=local-wake-secret \
  rubber-duck-worker
```

Then open `http://localhost:8788/health`. It answers `ok`.

#### One-time Google setup

A human does these steps. An agent does not. You need a Google account with a payment card and the [gcloud CLI](https://cloud.google.com/sdk/docs/install). Replace `<PROJECT_ID>`, `<PROJECT_NUMBER>`, and `<OWNER>/<REPO>` with your values, for example `plancys/rubber-duck-on-steroids`.

1. Create a Google Cloud project, and link a billing account to it.
2. Set a budget alert: **Billing → Budgets & alerts → Create budget**. Select the project, set a small amount, for example 5 USD, and keep the email alerts on. The alert sends an email. It does not stop the service.
3. Log in, and select the project. The second command shows the project number:

```bash
gcloud auth login
gcloud config set project <PROJECT_ID>
gcloud projects describe <PROJECT_ID> --format="value(projectNumber)"
```

4. Turn on the services. Cloud Run runs the worker. Cloud Build builds the image. Artifact Registry keeps the image. The IAM Credentials API lets GitHub use the deploy service account. Secret Manager keeps the two worker secrets.

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com secretmanager.googleapis.com
```

5. Let Cloud Build build for Cloud Run. Cloud Build uses the Compute Engine default service account:

```bash
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
  --role=roles/run.builder
```

6. Create the service account for the deploy, and give it the deploy roles. The deploy turns off the invoker IAM check, so the account needs `roles/run.admin`. The last command lets the account start the service with the default runtime account.

```bash
gcloud iam service-accounts create github-deploy --display-name="GitHub deploy of the worker"
for role in roles/run.sourceDeveloper roles/run.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding <PROJECT_ID> \
    --member=serviceAccount:github-deploy@<PROJECT_ID>.iam.gserviceaccount.com \
    --role="$role"
done
gcloud iam service-accounts add-iam-policy-binding <PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
  --member=serviceAccount:github-deploy@<PROJECT_ID>.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountUser
```

7. Set up Workload Identity Federation for this repository. GitHub then signs in with a short-lived token, and no Google key leaves Google. The condition accepts only this repository.

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc rubber-duck-on-steroids \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '<OWNER>/<REPO>'"
gcloud iam service-accounts add-iam-policy-binding github-deploy@<PROJECT_ID>.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/attribute.repository/<OWNER>/<REPO>"
```

8. Show the provider name. It is the value of `GCP_WORKLOAD_IDENTITY_PROVIDER`:

```bash
gcloud iam workload-identity-pools providers describe rubber-duck-on-steroids \
  --location=global --workload-identity-pool=github --format="value(name)"
```

9. Store the two worker secrets in Secret Manager, and let the worker read them. The worker runs as the Compute Engine default service account. Use your own wake secret from `openssl rand -hex 32`, and use the same value for the GitHub secret `WORKER_WAKE_SECRET`:

```bash
printf '%s' '<SUPABASE_SERVICE_KEY>' | gcloud secrets create worker-supabase-service-key --data-file=-
printf '%s' '<WAKE_SECRET>' | gcloud secrets create worker-wake-secret --data-file=-
for secret in worker-supabase-service-key worker-wake-secret; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor
done
```

The service key is the `service_role` key or a secret key (`sb_secret_...`): Supabase project → **Settings → API Keys**. To change a value later, run `gcloud secrets versions add <name> --data-file=-`, then deploy the worker again.

#### Worker secrets and variables

Set these values in **Settings → Environments → production**. `SUPABASE_URL` is already there from the [One-time setup](#one-time-setup).

| Name                             | Type     | Where the value comes from                                                                                                                                   |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Secret   | The provider name from step 8, in the form `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/rubber-duck-on-steroids`.      |
| `GCP_SERVICE_ACCOUNT`            | Secret   | `github-deploy@<PROJECT_ID>.iam.gserviceaccount.com`.                                                                                                        |
| `WORKER_WAKE_SECRET`             | Secret   | A random value: `openssl rand -hex 32`. The `deploy` job sends it to the Cloudflare Worker. Use the value of the Secret Manager secret `worker-wake-secret`. |
| `GCP_PROJECT_ID`                 | Variable | The Google project ID.                                                                                                                                       |
| `GCP_REGION`                     | Variable | The Cloud Run region, for example `europe-west3`. Select a region near the Supabase project.                                                                 |
| `WORKER_WAKE_URL`                | Variable | The worker address with `/wake` at the end. Set it after the first worker deploy.                                                                            |
| `ENABLE_JOB_CHECK`               | Variable | Only for the production check. The value is `true`. Remove it after the check.                                                                               |

#### First deploy of the worker

1. Set the values of the table above, but not `WORKER_WAKE_URL` and `ENABLE_JOB_CHECK`.
2. Open **Actions → CI → Run workflow** and select `main`. A manual run always deploys the worker. The `deploy-worker` job shows the worker address in a notice.
3. Open the worker address with `/health` at the end. It answers `ok`.
4. Set the variable `WORKER_WAKE_URL` to the worker address with `/wake` at the end.
5. Run the workflow again. The `deploy` job sends `WORKER_WAKE_URL` and `WORKER_WAKE_SECRET` to the Cloudflare Worker.

After the first deploy, a push to `main` deploys the worker only when a file in `worker/` changed. Before the Google setup, a push skips the worker deploy and shows a notice. The job stays green. A manual run fails the `deploy-worker` job when a value is missing, and the error names each missing value. The `deploy` job does not depend on `deploy-worker`.

#### Production check

The check page `/dashboard/job-check` is off in production. Turn it on only for a check:

1. Set the variable `ENABLE_JOB_CHECK` to `true`. Use exactly `true`. Another value, for example `TRUE`, fails the build.
2. Open **Actions → CI → Run workflow** and select `main`. The build reads the variable. The manual run also deploys the worker with `WORKER_ALLOW_DEMO=true`, so the worker runs demo jobs.
3. Sign in to the production app, and open `PRODUCTION_URL/dashboard/job-check`. Start a demo job. Wait until it shows "Done".
4. Remove the variable `ENABLE_JOB_CHECK`.
5. Run the workflow again. Open `PRODUCTION_URL/dashboard/job-check`. It answers 404. The worker now refuses demo jobs, also a demo row that a user inserts through the Supabase API.
6. One day later, read the cost of the project on the Google billing page.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that walks the whole auth flow (sign-up, sign-in, protected page, sign-out, password reset) over HTTP. Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 npm run smoke
```

It needs a reachable Supabase instance (local or cloud) with email confirmation disabled.

<!-- BEGIN sample-resource -->

The notes steps use two users to prove that one user cannot see, change, or delete the notes of another user.

<!-- END sample-resource -->

The password reset steps read the reset email from Mailpit. Local Supabase starts Mailpit at `http://127.0.0.1:54324`. Set `MAILPIT_URL` to use a different address.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## Phone check

`scripts/phone-check.mjs` opens every page in headless Chromium at 375x667 and 320x568 with the `playwright` library. It signs up and signs in through the forms, and it measures each page. Install Chromium once:

```bash
npx playwright install chromium
```

Run the check against the dev server or the production preview:

```bash
BASE_URL=http://localhost:4321 npm run phone-check
```

The check applies five rules to each page:

- No sideways scroll: the page is not wider than the viewport, down to 320px.
- No visible element reaches past the right edge of the viewport.
- The bar (`data-testid="shell-nav"`) is at most 64px high when it is closed.
- Every visible link and button is at least 44px high and 44px wide.
- Every input has a font size of at least 16px, so iOS does not zoom in on focus.

The output has one line per page and viewport, with the element and the measured value on a failure. The check skips a page that answers 404.

## CI

GitHub Actions runs two jobs on every push and PR to `main`, and on a manual run:

- **ci** — lint, `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI, runs the policy tests with `npx supabase test db`, builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required. The job installs Chromium and runs `npm run phone-check` against the same preview, before the smoke test.

<!-- BEGIN sample-resource -->

The **smoke** job runs two times. The `full` run uses the code as it is. The `without-sample` run first removes the sample resource with `node scripts/remove-sample.mjs --yes`, then runs lint and `astro check`. Then it runs the same steps as the `full` run.

<!-- END sample-resource -->

A third job, **deploy**, runs after both jobs pass, on a push to `main` or a manual run on `main`. It skips on a pull request. See [Deployment](#deployment).

## License

MIT
