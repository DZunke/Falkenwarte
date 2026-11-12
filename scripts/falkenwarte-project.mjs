#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "falkenwarte-project");
const FILES = [
  "README.md", "settings.json", "knowledge/README.md", "knowledge/decisions/README.md", "knowledge/domain/README.md",
  "knowledge/domain/stories/README.md", "knowledge/domain/models/README.md",
];

function assertSafePath(root, relative) {
  let part = root;
  for (const segment of relative.split("/")) {
    part = join(part, segment);
    if (!existsSync(part)) continue;
    const stat = lstatSync(part);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink inside target project: ${relative}`);
  }
}

function existingDecisions(root) {
  for (const location of ["docs/adr", "docs/decisions"]) {
    const directory = join(root, location);
    if (!existsSync(directory)) continue;
    assertSafePath(root, location);
    if (readdirSync(directory).some((name) => /^\d{4}-.*\.md$/.test(name))) return location;
  }
  return undefined;
}

export function planProject(projectDir) {
  const root = realpathSync(resolve(projectDir));
  if (!lstatSync(root).isDirectory()) throw new Error("Target project must be an existing directory");
  const marker = join(root, ".falkenwarte", "README.md");
  assertSafePath(root, ".falkenwarte");
  if (!existsSync(marker)) {
    const legacy = existingDecisions(root);
    if (legacy) throw new Error(`Existing ${legacy} ADRs need a project-specific decision; no automatic migration`);
  }
  const create = [];
  const conflicts = [];
  for (const relative of FILES) {
    const targetRelative = `.falkenwarte/${relative}`;
    assertSafePath(root, targetRelative);
    const destination = join(root, targetRelative);
    const source = readFileSync(join(TEMPLATE, relative), "utf8");
    if (!existsSync(destination)) create.push({ relative: targetRelative, destination, source });
    else if (relative !== "settings.json" && readFileSync(destination, "utf8") !== source) conflicts.push(targetRelative);
  }
  return { root, create, conflicts };
}

export function initializeProject(projectDir) {
  const plan = planProject(projectDir);
  if (plan.conflicts.length) throw new Error(`Existing Falkenwarte files differ; review instead of overwriting: ${plan.conflicts.join(", ")}`);
  for (const file of plan.create) {
    // Repeat path checks immediately before each write; never follow a pre-existing project symlink.
    assertSafePath(plan.root, file.relative);
    mkdirSync(dirname(file.destination), { recursive: true });
    writeFileSync(file.destination, file.source, { flag: "wx" });
  }
  return plan;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const [command = "plan", projectDir = process.cwd(), ...rest] = process.argv.slice(2);
    if (rest.length || !["plan", "init"].includes(command)) throw new Error("Usage: node scripts/falkenwarte-project.mjs <plan|init> [project-directory]");
    const result = command === "init" ? initializeProject(projectDir) : planProject(projectDir);
    console.log(`${command === "init" ? "Created" : "Would create"}: ${result.create.map((file) => file.relative).join(", ") || "nothing"}`);
    if (result.conflicts.length) console.log(`Existing files need review: ${result.conflicts.join(", ")}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
