---
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
---

## Why this stack

A solo developer building a web app for a handful of users, later about a hundred, on a six-week after-hours budget, asked to start from their own MVP Starter template. It has no vetted card, so it was assessed directly: TypeScript throughout, Astro's file-based conventions, widely used components and current documentation, so all four quality gates pass. Sign-in ships with the template; language-model features need manual setup; background jobs are not included and are the main piece to add. The web app deploys to Cloudflare Workers through the template's GitHub Actions pipeline with auto-deploy on merge. The user wants no tight coupling to any provider and minimal, ideally zero, running cost, so long-running course loading should be a separable service that could be hosted elsewhere; its hosting is undecided. Scaffolding is best-effort: the template is private with its own adoption steps, and this repository already exists, so the template must be brought in while keeping the context folder. The user cannot reliably spot an agent going against this stack's practice, so the agent instructions should spell out its conventions. Product type and scale were session answers; the PRD still lists them as TODO.
