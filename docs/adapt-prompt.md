# Adapt prompt

Paste all of the text below into your agent in the root of the new repository. Run `npm run adapt` first.

---

This repository is a new copy of a web app template. `npm run adapt` set the project name, the title, the tagline and the description. It also deleted the idea files of the template in `context/`. Your task is to turn this copy into a brief for my new idea. Do the steps in this order. Do one step at a time.

1. Read these files fully: `AGENTS.md`, `CLAUDE.md`, `context/foundation/tech-stack.md` and `context/foundation/infrastructure.md`. Obey the rules in `AGENTS.md` and `CLAUDE.md` for all of the work.
2. Ask me about my idea. Then run these skills with me, in this order: `/10x-shape`, then `/10x-prd`, then `/10x-roadmap`. Each skill writes its file in `context/foundation/`. Do not make a product decision for me. When I do not have an answer, record the question in the open questions.
3. Rewrite the introduction of `README.md` for my idea: the text between the `# ` title and the "Tech Stack" section. Rewrite the first paragraph of `AGENTS.md` for my idea, and keep the links to `prd.md` and `tech-stack.md`. Do not change the build, deploy and security rules in these two files.
4. Ask me when to remove the notes sample resource: now, or after my first own resource. The notes sample is a model for a first resource. When I say now, run `npm run remove:sample -- --yes`. This command keeps the `notes` table. Then run `npm run lint` and `npm run build`.
5. Tell me to do the steps in the `README.md` section "Deployment > One-time setup" for my own accounts. I do these steps myself. Do not run `npm run setup:prod`.
6. Delete `docs/adapt-prompt.md`. Then make a branch and commit all of the changes, including the changes from `npm run adapt`. Do not push. Do not commit on `main`.

When you finish, show me a list of the files that you changed and the open questions.
