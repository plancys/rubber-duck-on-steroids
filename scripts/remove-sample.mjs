// Sample removal: removes the notes sample resource in one run, then deletes this script.
// Zero dependencies on purpose. Run with npm run remove:sample, or with: node scripts/remove-sample.mjs [--yes | --drop-table]
// The script checks all files before it changes one. A failed check stops the run with no change.
// The script never deletes the create migration of the notes table. It writes a drop migration only on request.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const USAGE = `Usage: node scripts/remove-sample.mjs [--yes | --drop-table] [--help]

Removes the notes sample resource: its pages, API routes, components, service, policy test,
and the marked blocks in the shared files. Then the script deletes itself.

  --yes         Remove the sample and keep the notes table. Do not ask.
  --drop-table  Remove the sample and add a migration that drops the notes table. Do not ask.
  --help        Show this text.

Without a flag, the script asks if it must add the drop migration. The default is no.`;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
// The folders and files that exist only for the notes sample.
const SAMPLE_PATHS = [
  "src/pages/dashboard/notes",
  "src/pages/api/notes",
  "src/components/notes",
  "src/lib/notes.ts",
  "supabase/tests/notes_rls_test.sql",
];
// Each of these files must have at least one marked block.
const REQUIRED_MARKED_FILES = [
  "src/pages/dashboard.astro",
  "scripts/smoke.mjs",
  "scripts/phone-check.mjs",
  "README.md",
  "AGENTS.md",
];
// These files can have marked blocks. The script removes the blocks that it finds.
const OPTIONAL_MARKED_FILES = [".github/workflows/ci.yml", "src/lib/nav.ts"];
const CREATE_MIGRATION = "20261103220000_create_notes.sql";
// A marker is a full comment line in the syntax of its file: //, #, <!-- --> or {/* */}.
const BEGIN_MARKER = /^\s*(?:\/\/|#|<!--|\{\/\*)\s*BEGIN sample-resource\b/;
const END_MARKER = /^\s*(?:\/\/|#|<!--|\{\/\*)\s*END sample-resource\b/;

let yes = false;
let dropTable = false;
for (const arg of process.argv.slice(2)) {
  if (arg === "--help" || arg === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else if (arg === "--yes") {
    yes = true;
  } else if (arg === "--drop-table") {
    dropTable = true;
  } else {
    console.error(`Unknown argument: ${arg}`);
    console.error(USAGE);
    process.exit(2);
  }
}
if (yes && dropTable) {
  console.error("Use --yes or --drop-table, not both.");
  console.error(USAGE);
  process.exit(2);
}

function fromRoot(path) {
  return resolve(ROOT, path);
}

// Split a text into lines and keep the line ends, so that the file keeps its line ends after the edit.
function splitLines(text) {
  return text.split(/(?<=\n)/);
}

function isBlank(line) {
  return line !== undefined && line.trim() === "";
}

// Find the marked blocks of a file. Each block is a pair of line indexes, BEGIN and END included.
// An error message goes into `errors` for a BEGIN without END, an END without BEGIN, or a BEGIN in a block.
function findBlocks(path, lines, errors) {
  const blocks = [];
  let begin = -1;
  lines.forEach((line, index) => {
    if (BEGIN_MARKER.test(line)) {
      if (begin !== -1) errors.push(`${path}:${index + 1}: BEGIN inside the block that starts on line ${begin + 1}.`);
      begin = index;
    } else if (END_MARKER.test(line)) {
      if (begin === -1) errors.push(`${path}:${index + 1}: END without BEGIN.`);
      else blocks.push([begin, index]);
      begin = -1;
    }
  });
  if (begin !== -1) errors.push(`${path}:${begin + 1}: BEGIN without END.`);
  return blocks;
}

// Remove the blocks from the lines. When a blank line is before and after a block, one of them goes too.
function removeBlocks(lines, blocks) {
  const result = [...lines];
  for (const [begin, end] of [...blocks].reverse()) {
    const extra = isBlank(result[begin - 1]) && isBlank(result[end + 1]) ? 1 : 0;
    result.splice(begin, end - begin + 1 + extra);
  }
  return result.join("");
}

// The migration timestamp in UTC, in the format YYYYMMDDHHmmss.
function migrationTimestamp() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

// A yes or no prompt. An empty answer gives no. Ctrl+C stops the run at once, before any change.
async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    process.stdout.write("\n");
    process.exit(130);
  });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

// ---------- Step 1: check all files before the first change ----------

const errors = [];
const presentPaths = SAMPLE_PATHS.filter((path) => existsSync(fromRoot(path)));
const edits = [];
let markerCount = 0;
for (const path of [...REQUIRED_MARKED_FILES, ...OPTIONAL_MARKED_FILES]) {
  const required = REQUIRED_MARKED_FILES.includes(path);
  if (!existsSync(fromRoot(path))) {
    if (required) errors.push(`${path}: the file does not exist.`);
    continue;
  }
  const lines = splitLines(readFileSync(fromRoot(path), "utf8"));
  const blocks = findBlocks(path, lines, errors);
  markerCount += lines.filter((line) => BEGIN_MARKER.test(line) || END_MARKER.test(line)).length;
  if (blocks.length > 0) edits.push({ path, text: removeBlocks(lines, blocks) });
  else if (required) errors.push(`${path}: the file has no sample-resource block.`);
}

if (presentPaths.length === 0 && markerCount === 0) {
  console.log("The sample resource is already removed.");
  process.exit(0);
}

const missingPaths = SAMPLE_PATHS.filter((path) => !presentPaths.includes(path));
for (const path of missingPaths) errors.push(`${path}: the sample path does not exist.`);

const packagePath = fromRoot("package.json");
let packageJson;
try {
  packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
} catch (error) {
  errors.push(`package.json: the script cannot read it: ${error instanceof Error ? error.message : String(error)}`);
}

if (errors.length > 0) {
  console.error("The script cannot remove the sample. It changed no file. Fix these items, then run it again:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

// ---------- Step 2: the drop question ----------

if (!yes && !dropTable) {
  if (!process.stdin.isTTY) {
    console.error("The script asks a question and needs a terminal. It changed no file.");
    console.error("Run it in a terminal, or add --yes to keep the notes table or --drop-table to drop it.");
    process.exit(1);
  }
  dropTable = await confirm("Add a migration that drops the notes table?");
}

// ---------- Steps 3 to 7: the changes ----------

const deleted = [];
const changed = [];
const created = [];

// The checks above passed, but a write can still fail, for example on a locked file.
// Then the script prints the git command that restores the files, so a second run can start clean.
const migration = `supabase/migrations/${migrationTimestamp()}_drop_notes.sql`;
try {
  for (const path of SAMPLE_PATHS) {
    rmSync(fromRoot(path), { recursive: true, force: true });
    deleted.push(path);
  }

  for (const { path, text } of edits) {
    writeFileSync(fromRoot(path), text);
    changed.push(path);
  }

  if (packageJson.scripts && "remove:sample" in packageJson.scripts) {
    delete packageJson.scripts["remove:sample"];
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    changed.push("package.json");
  }

  if (dropTable) {
    writeFileSync(
      fromRoot(migration),
      [
        "-- Drops the notes table of the removed sample resource.",
        `-- The table comes from ${CREATE_MIGRATION}. That migration stays, so that the local`,
        "-- migration history matches the history of each database that already applied it.",
        "drop table if exists public.notes;",
        "-- The table trigger goes with the table. The trigger function does not, so drop it too.",
        "drop function if exists public.set_notes_updated_at();",
        "",
      ].join("\n"),
    );
    created.push(migration);
  }

  // The last change: the script deletes its own file.
  rmSync(SCRIPT_PATH, { force: true });
  deleted.push(relative(ROOT, SCRIPT_PATH));
} catch (error) {
  const restorePaths = [
    ...SAMPLE_PATHS,
    ...edits.map((edit) => edit.path),
    "package.json",
    relative(ROOT, SCRIPT_PATH),
  ];
  console.error(`The removal stopped halfway: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Restore the files with this command from the repository root, then run the script again:");
  console.error(`  git checkout -- ${restorePaths.join(" ")}${dropTable ? ` && rm -f ${migration}` : ""}`);
  process.exit(1);
}

// ---------- Step 8: the summary ----------

console.log("The sample resource is removed.");
console.log("\nDeleted:");
for (const path of deleted) console.log(`  - ${path}`);
console.log("\nChanged:");
for (const path of changed) console.log(`  - ${path}`);
if (created.length > 0) {
  console.log("\nCreated:");
  for (const path of created) console.log(`  - ${path}`);
}
const nextSteps = [
  ...(dropTable ? ["Apply the migration and update the types: npx supabase migration up && npm run db:types"] : []),
  "Run npm run lint and npm run build.",
  "Commit the result.",
];
console.log("\nNext steps:");
nextSteps.forEach((text, index) => console.log(`  ${index + 1}. ${text}`));
if (dropTable) {
  console.log("\nWarning: the next deploy applies the drop migration.");
  console.log("It deletes all notes in the production database.");
} else {
  console.log("\nThe notes table stays in the database. src/db/database.types.ts stays correct.");
}
