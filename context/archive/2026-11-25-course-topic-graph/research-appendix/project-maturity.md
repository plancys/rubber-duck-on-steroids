# Appendix: maturity signals of the evaluated projects

This file is an appendix to `../research.md`, for the third follow-up of 2026-11-25. The researcher collected the data on 2026-11-25. Nothing in this file comes from a run of a project.

## Method

- Repository data: the GitHub REST API (`repos/{owner}/{repo}`, and the page count of `contributors`, `commits` and `releases`).
- Package data: the npm registry and its download API, the PyPI metadata, and `pypistats.org`.
- Code size: a script that follows the import statements of a start file. It follows relative imports and the `@/` alias. It splits each file on the newline character, so a file that ends with a newline counts 1 line more than `wc -l` gives. The counts of a whole folder come from `wc -l`.
- Repository speed: `git log` and `git diff --shortstat` in this repository.

How to read the columns:

- **Age** is the time from the creation of the repository to 2026-11-25, in months.
- **Contributors** includes anonymous contributors.
- **Main author** is the share of the commits on the default branch that the top contributor wrote.
- **Releases** is the number of GitHub releases. A repository with many packages counts each package release.
- **Downloads** include installs by build servers and mirrors. They show use. They do not count users.

## 1. Repositories

| Repository                      | Created    | Age | Stars  | Contributors | Commits | Main author | Releases | Latest release              |
| ------------------------------- | ---------- | --- | ------ | ------------ | ------- | ----------- | -------- | --------------------------- |
| openflowkit/openflowkit         | 2026-02-10 | 9   | 1,014  | 10           | 850     | 95%         | 5        | v2.2.0, 2026-11-07          |
| joshuaswarren/remnic            | 2026-02-05 | 10  | 235    | 22           | 6,201   | 76%         | 1,248    | v10.0.107, 2026-11-14       |
| mermaid-js/mermaid              | 2014-11-01 | 145 | 91,252 | 866          | 16,893  | 20%         | 229      | 2026-11-13 (a package tag)  |
| open-spaced-repetition/py-fsrs  | 2022-11-28 | 48  | 536    | 12           | 123     | 67%         | 38       | v6.3.3, 2026-11-13          |
| open-spaced-repetition/ts-fsrs  | 2023-03-05 | 45  | 894    | 22           | 500     | 70%         | 91       | npm 6.0.1, 2026-11-22       |
| topoteretes/cognee              | 2023-08-16 | 39  | 33,607 | 336          | 12,863  | 28%         | 162      | v1.6.10, 2026-11-18         |
| getzep/graphiti                 | 2024-08-08 | 28  | 33,090 | 65           | 1,116   | 32%         | 206      | v0.32.1, 2026-11-24         |
| ArnaudGuiovanna/tutor-mcp       | 2026-03-30 | 8   | 112    | 4            | 537     | 93%         | 24       | v0.7.6, 2026-11-13          |
| HKUDS/LightRAG                  | 2024-10-02 | 26  | 40,865 | 423          | 12,485  | 65%         | 86       | v1.5.8, 2026-11-23          |
| neo4j/neo4j-graphrag-python     | 2024-02-27 | 33  | 1,340  | 43           | 595     | 22%         | 40       | 1.24.0, 2026-11-10          |
| run-llama/llama_index           | 2022-11-02 | 49  | 53,006 | 2,011        | 7,978   | 16%         | 435      | v0.14.26, 2026-11-13        |
| microsoft/graphrag              | 2024-03-27 | 32  | 36,753 | 51           | 500     | 29%         | 44       | v3.3.0, 2026-10-08          |
| AuvaLab/itext2kg                | 2024-07-06 | 29  | 980    | 3            | 208     | 99%         | 10       | v1.1.0, 2026-09-04          |
| zijinz456/OpenTutor             | 2026-02-26 | 9   | 192    | 8            | 297     | 70%         | 0        | none                        |
| ai-for-edu/LearningMAP          | 2026-06-10 | 6   | 17     | 5            | 454     | 71%         | 0        | none                        |
| CAHLR/pyBKT                     | 2017-05-25 | 114 | 294    | 18           | 457     | 53%         | 4        | 1.4.3, 2026-08-05           |
| zcsabbagh/knowledge-graph-mcp   | 2025-12-29 | 11  | 2      | 1            | 8       | 100%        | 0        | none                        |
| plastic-labs/honcho             | 2023-09-10 | 38  | 8,278  | 76           | 986     | 21%         | 9        | v3.6.2, 2026-11-23          |
| memodb-io/memobase              | 2024-09-03 | 27  | 2,966  | 15           | 467     | 87%         | 0        | none. Last push: 2026-01-11 |
| mem0ai/mem0                     | 2023-06-20 | 41  | 69,468 | 412          | 2,684   | 17%         | 416      | v2.2.1, 2026-09-25          |
| letta-ai/letta-code             | 2025-10-25 | 13  | 3,915  | 53           | 4,239   | 32%         | 397      | v0.34.70, 2026-11-23        |
| bowen-upenn/PersonaMem          | 2024-08-29 | 27  | 209    | 6            | 353     | 93%         | 0        | none                        |
| jessholbrook/adaptive-explainer | 2026-05-10 | 7   | 0      | 1            | 7       | 100%        | 0        | none                        |
| dyoshikawa/rulesync             | 2025-06-18 | 17  | 1,649  | 104          | 8,912   | 61%         | 393      | v43.15.0, 2026-11-25        |
| xyflow/xyflow                   | 2019-07-15 | 88  | 39,156 | 174          | 7,073   | 60%         | 412      | npm 13.0.3, 2026-11-23      |
| dagrejs/dagre                   | 2012-09-27 | 170 | 5,865  | 52           | 1,305   | 23%         | 9        | npm 3.1.4, 2026-11-24       |
| kieler/elkjs                    | 2017-07-10 | 113 | 2,913  | 27           | 248     | 30%         | 18       | 0.12.2, 2026-11-25          |
| cytoscape/cytoscape.js          | 2011-08-23 | 183 | 11,308 | 185          | 6,907   | 78%         | 177      | v3.35.0, 2026-11-10         |

The researcher read one more repository later, for the comparison table of `research.md` (R.3): `syntax-tree/mdast-util-from-markdown`, created 2020-08-31 (75 months), with 297 stars and 6 contributors. The researcher did not count its commits and releases.

## 2. Packages

Downloads of the last 7 days, read on 2026-11-25.

| Registry | Package                    | Downloads   | Latest version | Note                                                                            |
| -------- | -------------------------- | ----------- | -------------- | ------------------------------------------------------------------------------- |
| npm      | `mdast-util-from-markdown` | 100,499,523 | 2.1.0          | MIT                                                                             |
| npm      | `cytoscape`                | 29,167,603  | 3.35.0         | MIT                                                                             |
| npm      | `mermaid`                  | 28,517,796  | 12.3.0         | MIT                                                                             |
| npm      | `@xyflow/react`            | 22,653,787  | 13.0.3         | MIT. It needs React 18 or later. The older name `reactflow` has 3,660,375 more. |
| npm      | `elkjs`                    | 21,990,597  | 0.12.2         | EPL-2.0 or GPL-3.0-or-later                                                     |
| npm      | `@dagrejs/dagre`           | 9,494,230   | 3.1.4          | MIT. The first version on npm has the date 2017-12-26.                          |
| npm      | `ts-fsrs`                  | 362,677     | 6.0.1          | MIT. It needs Node 24 or later. 104 versions from 2023-03-05.                   |
| npm      | `@remnic/core`             | 15,301      | 9.69.56        | MIT                                                                             |
| npm      | `openflowkit`              | 291         | 0.3.0          | The command-line tool and the MCP server. It is not the map viewer.             |
| PyPI     | `llama-index-core`         | 1,319,702   | 0.14.26        |                                                                                 |
| PyPI     | `mem0ai`                   | 519,373     | 2.2.1          |                                                                                 |
| PyPI     | `graphiti-core`            | 241,132     | 0.32.1         | 198 releases                                                                    |
| PyPI     | `fsrs`                     | 117,032     | 6.3.3          | The package of py-fsrs                                                          |
| PyPI     | `neo4j-graphrag`           | 70,575      | 1.24.0         |                                                                                 |
| PyPI     | `honcho-ai`                | 57,805      | 2.9.0          |                                                                                 |
| PyPI     | `cognee`                   | 54,779      | 1.6.10         | 188 releases                                                                    |
| PyPI     | `lightrag-hku`             | 48,850      | 1.5.8          |                                                                                 |
| PyPI     | `graphrag`                 | 7,655       | 3.3.0          |                                                                                 |
| PyPI     | `pyBKT`                    | 798         | 1.4.3          |                                                                                 |
| PyPI     | `memobase`                 | 302         | 0.0.27         |                                                                                 |
| PyPI     | `itext2kg`                 | 78          | 1.1.0          |                                                                                 |

Version lines of `@xyflow/react` (npm registry):

- Version 12.0.0 has the date 2024-07-09. The last version of line 12 is 12.12.1, from 2026-11-02.
- Version 13.0.0 has the date 2026-11-16. The latest version is 13.0.3, from 2026-11-23.

The FSRS algorithm is an option inside Anki from version 23.10 ([Anki FAQ](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm)). `ts-fsrs` and py-fsrs come from the organization that develops FSRS. This research did not check which implementation Anki uses.

## 3. The size of the code that the second follow-up wanted to fork

Paths are relative to each project folder.

### OpenFlowKit map viewer

- The root package is an application, not a library: `"name": "openflowkit-app"` and `"private": true` (`package.json:2-3`).
- A separate build makes one script file from `src/viewer/map/standalone.tsx` (`vite.map-viewer.config.ts`). That build puts the ELK layout engine into the page.
- The import closure of `src/viewer/map/standalone.tsx`:

| Count                                     | Files | Lines  |
| ----------------------------------------- | ----- | ------ |
| With type imports, as the code stands     | 154   | 18,616 |
| With no type-only import statements       | 102   | 12,242 |
| The folder `src/viewer/map` alone         | 15    | 1,020  |
| `src/dsl/map/fold.ts` and its two imports | 3     | 481    |

- The largest groups in the closure: `src/opencanvas/domain` with 5,565 lines, `src/opencanvas/presentation` with 4,190 lines, and `src/dsl/discovery` with 1,771 lines.
- Outside packages in the closure: `react`, `react-dom`, `@tabler/icons-react` and `elkjs`.
- The map model describes a code repository. The node kinds are `part`, `group`, `folder`, `file`, `external` and `more`. The link kinds are `import`, `call`, `data` and `build` (`src/dsl/map/types.ts:4-5`).
- The fold step groups files by their import lines and by the words in their file names (`src/dsl/map/fold.ts:3-8,45`). The budget is 14 children for each box (`src/dsl/map/fold.ts:26`).
- The arrow budget for one box is the larger of 6 and 1.5 times the number of children. The arrows that carry the structure come first (`src/dsl/map/edgeBudget.ts:4-11`).
- Age of the map code: the first commit in `src/dsl/map` has the date 2026-10-08, and 13 commits touch that folder. The first commit in `src/viewer/map` has the date 2026-10-09, and 3 commits touch that folder.
- Tests: `src/dsl/map` has 14 test files with 1,927 lines. `src/viewer/map` has 2 test files with 34 lines.

### Remnic modules

The memory systems worker named three modules of `packages/remnic-core/src` as easy to copy.

| Module            | Own lines | Runtime closure      | Outside imports                                             | Test file beside it |
| ----------------- | --------- | -------------------- | ----------------------------------------------------------- | ------------------- |
| `memory-worth.ts` | 216       | 1 file, 216 lines    | none                                                        | yes                 |
| `trust-score.ts`  | 450       | 5 files, 5,041 lines | `node:path`, `node:fs`, `node:fs/promises`, `node:readline` | yes                 |
| `provenance.ts`   | 905       | 7 files, 1,810 lines | `zod`, `node:crypto`, `node:os`                             | no                  |

- With type imports, the closure of `trust-score.ts` and of `provenance.ts` has 1,047 files with 379,452 lines. The file `types.ts` has 3,890 lines.
- The correction code is a folder of 11 source files with 4,614 lines, test files not counted (`packages/remnic-core/src/correction/`).
- So one of the three modules is small and has no imports.

## 4. The speed of this repository

| Item                        | First commit of the work               | Last commit before the merge               | Size of the merge               |
| --------------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------- |
| F-01 `background-work-path` | 2026-11-24 13:52, phase 1 (`52a8708`)  | 2026-11-24 17:15, review fixes (`7921299`) | 43 files, 3,872 inserted lines  |
| S-01 `load-course-from-url` | 2026-11-24 21:05, the plan (`a085bdd`) | 2026-11-25 09:49, review fixes (`4f1ca1e`) | 98 files, 12,497 inserted lines |

- The phases of S-01 have these commit times: 21:22, 22:33 and 22:48 on 2026-11-24, then 08:40, 09:06 and 09:15 on 2026-11-25.
- One more commit of S-01 added a setup step at 15:59. Its merge has the time 16:13.
- 816 of the inserted lines of S-01 are in `context/`. The other lines are code, tests, SQL and docs.
- The history holds no time for the research and the plan of S-01. They ran between the merge of F-01 at 17:18 and the plan commit at 21:05.
- These are two items. They do not prove the speed of a slice that needs prompt work.
