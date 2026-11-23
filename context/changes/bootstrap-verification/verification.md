---
bootstrapped_at: 2026-11-23T21:48:14Z
starter_id: custom
starter_name: "MVP Starter (Astro + React + Supabase + Cloudflare Workers)"
project_name: rubber-duck-on-steroids
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: best-effort
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Copy of the frontmatter of `context/foundation/tech-stack.md`:

```yaml
starter_id: custom
custom_starter:
  name: "MVP Starter (Astro + React + Supabase + Cloudflare Workers)"
  docs_url: https://github.com/plancys/mvp-starter-deployable-on-edge-computing-crud-with-authorization
package_manager: npm
project_name: rubber-duck-on-steroids
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: best-effort
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: false
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
```

Why this stack:

A solo developer building a web app for a handful of users, later about a hundred, on a six-week after-hours budget, asked to start from their own MVP Starter template. It has no vetted card, so it was assessed directly: TypeScript throughout, Astro's file-based conventions, widely used components and current documentation, so all four quality gates pass. Sign-in ships with the template; language-model features need manual setup; background jobs are not included and are the main piece to add. The web app deploys to Cloudflare Workers through the template's GitHub Actions pipeline with auto-deploy on merge. The user wants no tight coupling to any provider and minimal, ideally zero, running cost, so long-running course loading should be a separable service that could be hosted elsewhere; its hosting is undecided. Scaffolding is best-effort: the template is private with its own adoption steps, and this repository already exists, so the template must be brought in while keeping the context folder. The user cannot reliably spot an agent going against this stack's practice, so the agent instructions should spell out its conventions. Product type and scale were session answers; the PRD still lists them as TODO.

## Pre-scaffold verification

| Signal      | Value                                                                                             | Severity | Notes                                                   |
| ----------- | ------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------- |
| npm package | not run                                                                                           | n/a      | A custom starter has no `create-*` generator on npm.    |
| GitHub repo | `plancys/mvp-starter-deployable-on-edge-computing-crud-with-authorization` last pushed 2026-11-13 | fresh    | From `custom_starter.docs_url`. Ten days before the run. |

## Scaffold log

**Resolved invocation**:

```bash
git clone --no-checkout /Users/kamil/Repositories-Private/mvp-starter-deployable-crud-with-authorization .bootstrap-scaffold
git -C .bootstrap-scaffold fetch origin refs/remotes/origin/main
git -C .bootstrap-scaffold checkout --detach a04ffdaf8b8c
git -C .bootstrap-scaffold remote set-url origin https://github.com/plancys/rubber-duck-on-steroids.git
cd .bootstrap-scaffold && ~/.nvm/versions/node/v26.13.0/bin/node scripts/adapt.mjs --yes \
  --name rubber-duck-on-steroids --title "Rubber Duck on Steroids" \
  --tagline "Learning paths adjusted to what you already know" \
  --description "Load a course, see it as a topic graph, check what you already know, and get a learning path that skips it." \
  --theme dock
```

**Strategy**: git-clone. The temporary copy was a git clone, and its `.git` directory was deleted before the files moved up.
**Exit code**: 0
**Files moved**: 125
**Conflicts (.scaffold siblings)**: `.claude/.10x-cli-manifest.json.scaffold`, `CLAUDE.md.scaffold`
**.gitignore handling**: moved silently
**.bootstrap-scaffold cleanup**: deleted

The user approved the commands before the run. The user selected these values: template version `a04ffda` (the newest `main`, the same commit as `main` on GitHub), the look `dock`, and the site texts above.

Source of the copy:

- The copy came from the local clone of the template, not from GitHub. Only committed files came along.
- The local clone has two uncommitted changes (`.env.example`, `supabase/config.toml`). They are not in this project.
- The files `.env`, `.dev.vars` and `node_modules` of the local clone are not in this project.

Differences from the default conflict policy:

- 67 files were the same in the copy and in this directory (66 in `.claude/`, and `.10x-cli.json`). They got no `.scaffold` sibling.
- The template has its own file with the name `CLAUDE.md.scaffold`. That file is now `CLAUDE.md.scaffold.orig`. The `CLAUDE.md` of the template is now `CLAUDE.md.scaffold`.
- `context/foundation/infrastructure.md` came from the template, because the user asked for it. This directory did not have that file.
- These four context files of the template were dropped: `context/archive/README.md`, `context/changes/README.md`, `context/foundation/README.md`, `context/foundation/tech-stack.md`.

What the setup script of the template did in the copy:

- It set the name `rubber-duck-on-steroids` in `package.json`, `package-lock.json`, `wrangler.jsonc` and `supabase/config.toml`.
- It set the title, the tagline, the description and the look in `src/lib/site.ts`.
- It pointed the docs link and the clone block of the README at `plancys/rubber-duck-on-steroids`.
- It deleted the idea files of the template: 15 folders in `context/archive`, `context/changes/bootstrap-verification`, `prd.md`, `roadmap.md` and `shape-notes.md`.
- It removed the template-adapt blocks and deleted `scripts/adapt.mjs`.

Dependency install, run after the move:

- Command: `npm install`, with Node 26.13.0 (the version in `.nvmrc`) and npm 11.20.0. Exit code: 0.
- npm printed this warning: 3 packages have install scripts not yet covered by `allowScripts`. The packages are `esbuild@0.28.2`, `fsevents@2.3.3` and `workerd@1.20261023.1`.
- The tools start: `esbuild` 0.28.2, `workerd` 2026-10-23, `astro` 7.4.4.
- No build, lint or test command ran.

## Post-scaffold audit

**Tool**: `npm audit --json` (exit code 1, because the tool found advisories)
**Summary**: 0 CRITICAL, 0 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/3/0 direct of total 0/0/10/0

The dependency tree has 782 packages: 335 production, 317 development and 158 optional.

#### CRITICAL findings

None.

#### HIGH findings

None.

#### MODERATE findings

| Package                              | Kind       | Affected range            | Cause                                                                                              | Fix available |
| ------------------------------------ | ---------- | ------------------------- | -------------------------------------------------------------------------------------------------- | ------------- |
| `astro`                              | direct     | `<=7.4.6`                 | GHSA-mh32-jxcr-mh9f (XSS via attribute injection in dynamic tag names), and one more Astro advisory | yes           |
| `eslint`                             | direct     | `10.0.0-alpha.0 - 10.14.0` | via `minimatch`                                                                                    | yes           |
| `typescript-eslint`                  | direct     | `<=8.72.2`                | via its `@typescript-eslint/*` packages                                                            | yes           |
| `minimatch`                          | transitive | `7.0.0 - 11.0.0`          | GHSA-g3hv-75wg-m249 (possible denial of service)                                                   | yes           |
| `@eslint/config-array`               | transitive | `0.23.0 - 0.23.5`         | via `minimatch`                                                                                    | yes           |
| `@typescript-eslint/eslint-plugin`   | transitive | `6.16.0 - 8.72.2`         | via `@typescript-eslint/type-utils`, `@typescript-eslint/utils`                                    | yes           |
| `@typescript-eslint/parser`          | transitive | `6.16.0 - 8.72.2`         | via `@typescript-eslint/typescript-estree`                                                         | yes           |
| `@typescript-eslint/type-utils`      | transitive | `6.16.0 - 8.72.2`         | via `@typescript-eslint/typescript-estree`, `@typescript-eslint/utils`                             | yes           |
| `@typescript-eslint/typescript-estree` | transitive | `6.16.0 - 8.72.2`       | via `minimatch`                                                                                    | yes           |
| `@typescript-eslint/utils`           | transitive | `6.16.0 - 8.72.2`         | via `@typescript-eslint/typescript-estree`                                                         | yes           |

The installed version of `astro` is 7.4.4. The audit output cut off the title of the second Astro advisory, so this log does not name it. No fix command ran.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                               | Value                |
| ---------------------------------- | -------------------- |
| bootstrapper_confidence            | best-effort          |
| quality_override                   | false                |
| path_taken                         | custom               |
| self_check_answers.typed           | true                 |
| self_check_answers.from_official_starter | true           |
| self_check_answers.conventions     | true                 |
| self_check_answers.docs_current    | true                 |
| self_check_answers.can_judge_agent | false                |
| team_size                          | solo                 |
| deployment_target                  | cloudflare-workers   |
| ci_provider                        | github-actions       |
| ci_default_flow                    | auto-deploy-on-merge |
| has_auth                           | true                 |
| has_payments                       | false                |
| has_realtime                       | false                |
| has_ai                             | true                 |
| has_background_jobs                | true                 |

The template brought a GitHub Actions workflow and a Cloudflare Workers configuration. The bootstrap run did not make them. It did not change them after the setup script of the template.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- This directory is already a git repository, so `git init` is not necessary. The bootstrap run made no commit.
- Compare `CLAUDE.md` with `CLAUDE.md.scaffold`. The file of the template starts with `@AGENTS.md` and the hard rules of the template. Decide which parts to keep, then delete the `.scaffold` and `.scaffold.orig` files.
- Compare `.claude/.10x-cli-manifest.json` with its `.scaffold` sibling.
- Use Node 26.13.0 for this project. Run `nvm use` in the project root.
- Address the audit findings per your project's risk tolerance. The full list is in this log.
- `docs/adapt-prompt.md` came with the template. Its second step runs `/10x-shape` and `/10x-prd`, and this project already has those files.
