<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 4, Lesson 5 (DDD Modernisation)

Surface the domain the legacy code never named, then use it as input for the next cycle.

```
domain distillation -> invariant aggregate / anti-corruption layer -> /10x-shape -> /10x-roadmap -> /10x-research -> /10x-plan
```

### Task Router - Where to start

| Skill / prompt | Use it when |
| --- | --- |
| `/10x-domain-distillation` | One-run domain map. It writes the ubiquitous language with its sources, Core/Supporting/Generic subdomains, invariants and whether the code enforces them, model-vs-code drift, and a fix-first ranking to `context/domain/domain-distillation.md`, plus `context/domain/glossary.md`. Use `--replace` to refresh; the previous run moves to `context/archive/`. |
| `m4l5-1-domain-distillation` | The same distillation as a single prompt, run step by step. |
| `m4l5-2-invariant-aggregate-refactor` | A core business rule is enforced in many places or not at all. Plans a guardian aggregate that owns it. |
| `m4l5-3-anti-corruption-layer` | An external dependency leaks into the domain. Plans an Anti-Corruption Layer around it. |
| `/10x-shape` -> `/10x-roadmap` -> `/10x-research` -> `/10x-plan` | Feeding the `context/domain/` artifacts into the next cycle. |

### Hard rules

- **Discover the domain; don't assume it.** Start with no entity names, aggregates or paths, and cite where every term comes from (a document or the code).
- **Produce a map or a plan, not code.** These artifacts don't modify production code; the change happens later through `/10x-plan` -> `/10x-implement`.
- **Use the glossary's terms.** Once `context/domain/glossary.md` exists, use its terms in code, plans and conversations, and avoid the names it marks "don't call it".

<!-- END @przeprogramowani/10x-cli -->
