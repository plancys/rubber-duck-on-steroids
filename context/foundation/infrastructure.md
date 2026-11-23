---
project: rubber-duck-on-steroids
researched_at: 2026-11-02
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7.4 SSR with React 19 islands
  runtime: Node 26.13 local, workerd on Cloudflare Workers through @astrojs/cloudflare 14.4
---

## Recommendation

**Deploy on Cloudflare Workers. Start on the Free plan. Move to the Paid plan at $5 per month when a trigger below fires.**

Cloudflare Workers passes all five agent-friendly criteria: a non-interactive CLI for deploy, versions, rollback, tail, and secrets, a managed serverless runtime, docs as llms.txt and markdown on GitHub, a deterministic deploy command, and an official MCP server with a Claude Code plugin. The adapter and `wrangler.jsonc` are already in the repo, so the scaffold needs no switch. The Free plan carries a 10 ms CPU cap per request, the main risk from the cross-check. The Paid plan removes it, and the switch is a plan change in the dashboard with no code change. The interview set the weights: no persistent connections, cost matters but DX and a known provider matter too, no familiarity with any platform in the pool, a single region, and an external database (Supabase).

Plan switch triggers, any one of them:
- Workers Logs show CPU time over 10 ms on a real page, or Error 1102 appears in the logs.
- Daily requests approach 100,000, the Free plan limit.
- A page needs more than 50 subrequests, the Free plan limit per request.
- Previews exceed 100 per Worker.

Decision trail: the first cross-check on Cloudflare Workers surfaced three risks, and the user swapped to Vercel. A side-by-side comparison for the MVP and for a commercial future followed. Cloudflare costs $0 on Free and $5 per month on Paid with free team members and no egress fees, while Vercel costs $20 per seat for commercial use. The user then chose Cloudflare Workers on the Free plan, with the Paid plan as a later option. The Vercel cross-check stays in git history at commit `074d4aa`.

## Platform Comparison

Research date: 2026-11-02. Scores are Pass / Partial / Fail per the five criteria in `references/agent-friendly-criteria.md`. No platform failed a hard filter. The app has no persistent connections, and all six run Astro 7 SSR with an official adapter.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Pass | 5 Pass |
| Vercel | Pass | Pass | Pass | Pass | Pass | 5 Pass |
| Netlify | Partial | Pass | Pass | Pass | Pass | 4 Pass, 1 Partial |
| Fly.io | Pass | Pass | Pass | Pass | Partial | 4 Pass, 1 Partial |
| Railway | Partial | Pass | Pass | Pass | Pass | 4 Pass, 1 Partial |
| Render | Partial | Pass | Pass | Pass | Pass | 4 Pass, 1 Partial |

**Cloudflare Workers.** `wrangler deploy`, `wrangler rollback`, `wrangler tail`, and `wrangler secret put` cover the full loop without a browser. Docs ship as llms.txt and as markdown on GitHub. The API MCP server and the Claude Code plugin carry no beta label. Cost: $0 on Free at both 10k and 100k requests per month, with a 10 ms CPU cap per request, or $5 on Paid with 10M requests included. Static asset requests are free. The adapter in the repo already targets Workers. Workers Builds has Node 24 and 22 only, and the git integration supports GitHub and GitLab only.

**Vercel.** `vercel deploy --prod --yes`, `vercel rollback`, `vercel promote`, and `vercel logs --json` cover the loop. Docs ship as llms.txt. The MCP server launched as public beta on 2025-08-04 and carries no label today. Cost: $0 on Hobby for non-commercial use only, $20 per seat on Pro. The Astro adapter 11.0.17 supports Astro 7 but maps Node 24 at most, and it provides no `astro preview` server. Git integration supports GitHub, GitLab, and Bitbucket. Previews are protected by Vercel Authentication at no cost.

**Netlify.** Deploy and logs work from the CLI, but rollback needs `netlify api restoreSiteDeploy`, so CLI-first is Partial. Credits pricing charges 15 credits per production deploy. The Free plan holds 300 credits, so an auto-deploy template spends the allowance on deploys alone. Node 26 is not named in the docs. Git integration supports Bitbucket.

**Fly.io.** `fly deploy -y`, `fly releases`, `fly logs -j`, and app-scoped deploy tokens give the most complete CLI among the container hosts. Docs ship as llms.txt with source on GitHub. The hosted MCP server is beta (2026-10-23), so that criterion is Partial. No free tier. One 256 MB Machine costs about $2.20 per month, two with the default HA about $4.40. A Dockerfile and the Node adapter are required. No built-in previews.

**Railway.** `railway up --ci` and `railway logs --json` work from the CLI, but rollback to an older deployment is dashboard only, so CLI-first is Partial. Docs ship as llms.txt with source on GitHub. The MCP server carries no beta label. Hobby costs $5 per month. Config as code is deprecated with a hard cutoff on 2026-12-01. Git source is GitHub only.

**Render.** `render deploys create --wait` and `render logs --json` work, but rollback is API or dashboard only, and scoped API keys are early access, so CLI-first is Partial. Docs ship as llms.txt and agents.md. The MCP server carries no beta label. The cheapest paid instance costs $7 per month. The free tier spins down after 15 minutes. Node 26 is not named in the docs.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Five passes and the lowest cost at every scale in the comparison: $0 on Free for the MVP, $5 per month on Paid later, team members free, no egress fee, static assets free. The adapter, `wrangler.jsonc`, `.dev.vars`, and the smoke job already match. `astro dev` runs on workerd, the production runtime. The gaps: a runtime that is not Node with 128 MB memory, a build image without Node 26, and previews that are public by default.

#### 2. Vercel

Five passes and the smoothest loop for a solo developer. Bitbucket connects directly. The gaps: commercial use needs Pro at $20 per seat, the adapter runs Node 24 and has no `astro preview` server, and the scaffold needs an adapter switch plus a smoke job redesign. Vercel wins only when heavy Node-native processing must run inside the web functions.

#### 3. Fly.io

Four passes and one Partial. The CLI covers rollback and scoped tokens, and the price is $2 to $4 per month. The gaps: no free tier, a Dockerfile in the template, no built-in previews, and an MCP server in beta.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. The Free plan caps CPU at 10 ms per request. The limits page says SSR plus auth uses 10 to 20 ms. Requests over the cap fail with Error 1102, which looks like random flakiness. The Paid plan at $5 removes the cap.
2. Workers is not Node. Memory is 128 MB, there is no file system, and `nodejs_compat` is a polyfill layer. A dependency that needs a native Node API fails at runtime, not at build.
3. Workers Builds has Node 24 and 22 only. Local dev runs Node 26 from `.nvmrc`. A build on the git integration and a build in GitHub Actions can diverge.
4. Secrets live in three places: `.dev.vars`, GitHub Secrets for the CI build, and Workers secrets. Previews have their own set. A fresh clone needs all three before the pipeline is green.
5. The adapter churns per major version. v13 dropped Pages and changed the entrypoint. Each Astro major costs adapter work in the template.

### Pre-Mortem — How This Could Fail

The first weeks went well on the Free plan. Then the learning tool landed on the baseline: book uploads, embeddings, and LLM calls in the request path. CPU and memory limits produced Error 1102 and out-of-memory failures on real uploads. The fix needed a queue and a consumer Worker, which the template did not have. The team rewired the deploy, and the pipeline stayed red for a week. The guardrail "business logic touches no baseline files" broke.

At the same time, the git integration built on Node 24 while local dev ran Node 26. A dependency passed locally and failed in the build. Secrets were set by hand for production only, so the preview pointed at the production Supabase project. Nobody put Cloudflare Access on previews, and a public preview URL with a working login leaked. The next idea cloned the template, and the worker name `10x-astro-starter` collided with the first project.

### Unknown Unknowns

- The hand-off said `cloudflare-pages`. Adapter 14 cannot target Pages. The deploy command is `wrangler deploy`, never `wrangler pages deploy`. The hand-off now says `cloudflare-workers`.
- `astro dev` already runs on workerd since adapter v13. `wrangler dev` is legacy for this setup. Do not add it to scripts or docs.
- `wrangler.jsonc` has `compatibility_date` 2026-05-08, so the `nodejs_compat` flag is required and present. A date on or after 2026-08-04 enables it by default and changes other defaults. The Astro docs also list `global_fetch_strictly_public`.
- The git integration supports GitHub and GitLab only. The remote is Bitbucket. The move to GitHub is already decided.
- `wrangler preview` creates public preview URLs by default. Protect them with Cloudflare Access. The Free plan allows 100 previews per Worker, the Paid plan 500.
- `.nvmrc` asks for Node 26.13.0. Workers Builds does not preinstall Node 26. A deploy from GitHub Actions on Node 26 avoids the question, because the bundle runs on workerd either way.

## Operational Story

- **Preview deploys**: `npx wrangler preview` (Wrangler 4.135 or later) creates one Preview per branch with its own vars, secrets, and bindings, on a `workers.dev` hostname with `X-Robots-Tag: noindex`. The URL is public by default. Put a Cloudflare Access policy on the preview hostnames before the first preview with real data. The git integration also builds previews for non-production branches, on GitHub and GitLab only.
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` live in Workers secrets, set with `npx wrangler secret put <KEY>`, and in `.dev.vars` for local dev, which git ignores. The CI job holds `CLOUDFLARE_API_TOKEN` (from the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID` in GitHub Secrets. Each Preview carries its own secrets, so a preview never reads production values. Rotate a value with `wrangler secret put` again, which deploys a new version.
- **Rollback**: `npx wrangler versions list --json` lists the last 100 versions. `npx wrangler rollback <VERSION_ID> --message ""` reverts production in seconds without a prompt. Supabase migrations do not roll back with the Worker.
- **Approval**: production deploys run automatically on merge to `main` from GitHub Actions with `wrangler deploy`, per the hand-off. Human-only actions: delete the Worker, rotate the API token or the Supabase keys, change the domain, the plan, or the Access policy. The agent may create previews, tail logs, list versions, and roll back when asked.
- **Logs**: `npx wrangler tail <worker> --format json --status error` streams runtime errors. Workers Logs in the dashboard keep each invocation with its CPU time, because `observability` is enabled in `wrangler.jsonc`. The API MCP server at `https://mcp.cloudflare.com/mcp` answers structured questions about deployments and logs.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Free plan CPU cap of 10 ms fails SSR requests with Error 1102 | Devil's advocate | H | M | Read the CPU time per invocation in Workers Logs after the smoke test. Keep pages light. Move to the Paid plan when a page exceeds 10 ms, a plan change with no code change. |
| A dependency needs a native Node API and fails on workerd | Devil's advocate | M | H | Keep the baseline to fetch and the Supabase client. Run every new dependency under `astro dev` on workerd before merge. |
| Workers Builds on Node 24 differs from local Node 26 | Devil's advocate | H | M | Deploy from GitHub Actions on Node 26 with `wrangler deploy`. Do not connect Workers Builds to the same Worker. |
| Secrets live in three places and a fresh clone misses one | Devil's advocate | H | M | Name the three places in the infra manual (FR-005) and in the adapt checklist (FR-012). |
| The adapter changes shape at each Astro major | Devil's advocate | M | M | Pin the adapter major in `package.json`. Run the smoke test after each upgrade. |
| Heavy ingestion for the learning tool hits CPU and memory limits | Pre-mortem | M | M | Keep the baseline request and response only. Plan Queues plus a consumer Worker, or an external worker, when ingestion arrives. |
| Preview URLs are public and serve a working login | Unknown unknowns | M | H | Add a Cloudflare Access policy on the preview hostnames before the first preview with real data. |
| A preview points at the production Supabase project | Unknown unknowns | M | H | Create a second Supabase project for previews. Set preview-scoped secrets. |
| The worker name `10x-astro-starter` collides between projects | Pre-mortem | H | L | Rename `name` in `wrangler.jsonc` as the first step of the adapt checklist. |
| The remote is Bitbucket and the git integration needs GitHub or GitLab | Unknown unknowns | H | M | Move the repo to GitHub, as decided. Until then, deploy only from CI with `wrangler deploy`. |
| A compatibility date bump changes runtime defaults | Unknown unknowns | L | M | Keep `nodejs_compat` explicit. Run the smoke test after each date bump. |
| The `wrangler deploy --assets` flag is still beta | Research finding | L | L | The repo uses the `assets` block in `wrangler.jsonc`, not the flag. |
| The tech-stack hand-off named Pages, not Workers | Research finding | H | L | `deployment_target` now says `cloudflare-workers`. |

## Getting Started

1. Account and token. Stay on the Workers Free plan. Create an API token from the "Edit Cloudflare Workers" template. After the repo moves to GitHub, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub Secrets.
2. Name and config. Set `name` in `wrangler.jsonc` to `mvp-starter-deployable-crud-with-authorization`. Keep `main` at `@astrojs/cloudflare/entrypoints/server`, the `nodejs_compat` flag, the `assets` block, and `observability`. `npm run dev` runs on workerd. Do not add `wrangler dev`.
3. Secrets. Run `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`. For local dev, copy `.env.example` to `.dev.vars` and fill the values.
4. First deploy. Run `npm run build && npx wrangler deploy`. Open the `workers.dev` URL, check the landing page and `/auth/signin`. Run `BASE_URL=https://<worker>.workers.dev npm run smoke`.
5. Pipeline. In `.github/workflows/ci.yml` set `branches: [main]`, keep lint, `astro check`, build, and the smoke job, and add a deploy job on push to `main` that runs `npx wrangler deploy` with the two secrets. For branch previews run `npx wrangler preview` and protect the hostnames with Cloudflare Access.

Alignment note: `context/foundation/tech-stack.md` now says `deployment_target: cloudflare-workers`, the adapter's only target.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
