import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { restoreAssignment, type Assignment } from "./flow.ts";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type ReviewDelivery = "local" | "pr";
export type ProjectSettings = { reviewDelivery: ReviewDelivery; autoStart: boolean; checks: string[][] };
export type RunRecord = { schemaVersion: 1; revision: number; state: "open" | "closed"; assignment: Assignment };

function safeDirectory(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe project directory: ${path}`);
}

function safeFile(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe project file: ${path}`);
}

export function projectDirectory(cwd: string): string {
  const root = resolve(cwd);
  const directory = join(root, ".falkenwarte");
  safeDirectory(directory);
  const marker = join(directory, "README.md");
  safeFile(marker);
  if (!existsSync(marker)) throw new Error("Initialize this project with Falkenwarte before starting a flow");
  return directory;
}

export function projectSettings(cwd: string): ProjectSettings {
  const file = join(projectDirectory(cwd), "settings.json");
  safeFile(file);
  if (!existsSync(file)) return { reviewDelivery: "local", autoStart: false, checks: [] }; // Existing projects remain manual by default.
  if (lstatSync(file).size > 4096) throw new Error("Falkenwarte settings exceed 4 KiB");
  let data: unknown;
  try { data = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error("Invalid .falkenwarte/settings.json"); }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    !["review,schemaVersion", "execution,review,schemaVersion", "review,schemaVersion,verification", "execution,review,schemaVersion,verification"].includes(Object.keys(data).sort().join(",")) ||
    !('schemaVersion' in data) || data.schemaVersion !== 1 ||
    !('review' in data) || !data.review || typeof data.review !== "object" || Array.isArray(data.review) ||
    Object.keys(data.review).join(",") !== "delivery" ||
    !('delivery' in data.review) || !["local", "pr"].includes(String(data.review.delivery)) ||
    ('execution' in data && (!data.execution || typeof data.execution !== "object" || Array.isArray(data.execution) ||
      Object.keys(data.execution).join(",") !== "autoStart" || !('autoStart' in data.execution) || typeof data.execution.autoStart !== "boolean")) ||
    ('verification' in data && (!data.verification || typeof data.verification !== "object" || Array.isArray(data.verification) ||
      Object.keys(data.verification).join(",") !== "commands" || !('commands' in data.verification) ||
      !Array.isArray(data.verification.commands) || data.verification.commands.length > 12 ||
      data.verification.commands.some((argv: unknown) => !Array.isArray(argv) || argv.length < 1 || argv.length > 20 ||
        argv.some((arg: unknown) => typeof arg !== "string" || !arg || arg.length > 200 || /[\x00-\x1f\x7f]/.test(arg)) ||
        !["node", "npm", "pnpm", "python3", "pytest", "go", "cargo"].includes(argv[0]))))) {
    throw new Error("Unsupported Falkenwarte settings; expected schemaVersion 1, review.delivery local|pr, optional execution.autoStart and verification.commands argv lists");
  }
  return { reviewDelivery: data.review.delivery as ReviewDelivery, autoStart: 'execution' in data ? (data.execution as { autoStart: boolean }).autoStart : false,
    checks: 'verification' in data ? (data.verification as { commands: string[][] }).commands : [] };
}

export function reviewDelivery(cwd: string): ReviewDelivery {
  return projectSettings(cwd).reviewDelivery;
}

function runPaths(cwd: string, id: string): { directory: string; file: string } {
  if (!RUN_ID.test(id)) throw new Error("Invalid project flow ID");
  const root = projectDirectory(cwd);
  const runs = join(root, "runs");
  safeDirectory(runs);
  const directory = join(runs, id);
  safeDirectory(directory);
  const file = join(directory, "run.json");
  safeFile(file);
  return { directory, file };
}

export function loadRun(cwd: string, id: string): RunRecord | undefined {
  const { file } = runPaths(cwd, id);
  if (!existsSync(file)) return undefined;
  if (lstatSync(file).size > 1024 * 1024) throw new Error("Project run record exceeds 1 MiB");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error("Invalid project run record"); }
  if (!value || typeof value !== "object" || !('schemaVersion' in value) || value.schemaVersion !== 1 ||
    !('revision' in value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
    !('state' in value) || !["open", "closed"].includes(String(value.state)) ||
    !('assignment' in value) || !restoreAssignment(value.assignment) ||
    (value.assignment as Assignment).id !== id) throw new Error("Unsupported or invalid project run record");
  return value as RunRecord;
}

export function saveRun(cwd: string, assignment: Assignment, expectedRevision: number, state: "open" | "closed" = "open"): RunRecord {
  // The lock prevents two Pi processes from replacing one assignment concurrently.
  const { directory, file } = runPaths(cwd, assignment.id);
  const runs = join(projectDirectory(cwd), "runs");
  mkdirSync(runs, { recursive: true, mode: 0o700 });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, ".write-lock");
  mkdirSync(lock, { mode: 0o700 }); // A stale lock fails closed; no automatic recovery by guessing ownership.
  let temporary: string | undefined;
  try {
    const prior = loadRun(cwd, assignment.id);
    if ((prior?.revision ?? 0) !== expectedRevision || prior?.state === "closed") throw new Error("Project flow changed or closed; reload before writing");
    const record: RunRecord = { schemaVersion: 1, revision: expectedRevision + 1, state, assignment };
    temporary = join(directory, `.run-${randomUUID()}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
    return record;
  } finally {
    if (temporary && existsSync(temporary)) rmSync(temporary);
    rmdirSync(lock);
  }
}

const markdown = (value: string) => value.replace(/[\\`*_{}\[\]()#+.!<>|]/g, "\\$&").replace(/\n/g, " ");

export function writeHandoff(cwd: string, id: string): string {
  const record = loadRun(cwd, id);
  if (!record) throw new Error("Project flow not found");
  const reviews = join(projectDirectory(cwd), "reviews");
  safeDirectory(reviews);
  mkdirSync(reviews, { recursive: true, mode: 0o700 });
  const directory = join(reviews, id);
  safeDirectory(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `handoff-v${record.revision}.md`);
  safeFile(file);
  const task = record.assignment;
  const lines = [
    `# Falkenwarte handoff: ${markdown(task.title)}`,
    "",
    `- Flow ID: ${id}`,
    `- Record: ${record.state}, revision ${record.revision}`,
    `- Self-reported phase: ${task.phase}`,
    `- Review delivery preference: ${reviewDelivery(cwd)}`,
    ...(task.issue ? [`- Issue: ${task.issue}`] : []),
    "- Worker/process status: **unknown** until checked against the actual execution engine.",
    "",
    "## Reported milestones (not independent verification)",
    ...task.entries.map((entry) => `- ${entry.at}: ${markdown(entry.actor)} / ${entry.phase}: ${markdown(entry.summary)}${entry.evidence ? ` — reference: ${markdown(entry.evidence)} (not verified here)` : ""}`),
    ...(task.entries.length ? [] : ["- None recorded."]),
    "", "## Execution backend",
    ...(task.engineRunId ? [`- pi-workflow run: ${task.engineRunId} (inspect /workflow ${task.engineRunId}; do not infer status from this handoff)`] : ["- No verified execution run bound."]),
    "", "## Explicitly bound observed runs",
    ...task.boundRunIds.map((runId) => `- ${markdown(runId)} (inspect the engine receipt before steering or resuming)`),
    ...(task.boundRunIds.length ? [] : ["- None; do not attribute unbound session activity to this flow."]),
    "", "## Next action", "Inspect current code, tests, run receipts and open decisions before continuing; this document does not certify completion or a review package.", "",
  ];
  writeFileSync(file, lines.join("\n"), { flag: "wx", mode: 0o600 });
  return file;
}

export function inspectWorkflowRun(cwd: string, id: string): { runId: string; status: string } {
  if (!/^workflow_[a-z0-9_]+$/.test(id) || id.length > 100) throw new Error("Invalid pi-workflow run ID");
  const project = resolve(cwd);
  const pi = join(project, ".pi");
  const workflows = join(pi, "workflows");
  const directory = join(workflows, id);
  for (const path of [pi, workflows, directory]) safeDirectory(path);
  const file = join(directory, "run.json");
  safeFile(file);
  if (!existsSync(file) || lstatSync(file).size > 1024 * 1024) throw new Error("Missing or oversized project workflow record");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error("Invalid project workflow record"); }
  if (!value || typeof value !== "object" || !('runId' in value) || value.runId !== id ||
    !('status' in value) || typeof value.status !== "string") throw new Error("Mismatched project workflow record");
  return { runId: id, status: value.status };
}

export function candidateLocation(cwd: string, id: string): { root: string; managed: boolean; taskId: string } {
  inspectWorkflowRun(cwd, id);
  const origin = resolve(cwd);
  const run = JSON.parse(readFileSync(join(origin, ".pi", "workflows", id, "run.json"), "utf8")) as { tasks?: unknown };
  const writer = Array.isArray(run.tasks) ? run.tasks.find((value) => value && typeof value === "object" && value.specId === "implement.main") : undefined;
  if (!writer || writer.status !== "completed" || typeof writer.taskId !== "string" || !/^task-[0-9]+$/.test(writer.taskId) || !writer.worktree || typeof writer.worktree !== "object") {
    throw new Error("No identifiable implementation task in project workflow");
  }
  if (writer.worktree.enabled !== true) {
    if (writer.worktree.enabled === false && writer.cwd === origin) return { root: origin, managed: false, taskId: writer.taskId };
    throw new Error("Invalid implementation worktree state");
  }
  const runDirectory = join(origin, ".pi", "workflows", id);
  const worktrees = join(runDirectory, "worktrees");
  const expected = join(worktrees, writer.taskId);
  safeDirectory(worktrees);
  safeDirectory(expected);
  if (writer.cwd !== expected || writer.worktree.path !== expected || !existsSync(expected)) {
    throw new Error("Implementation worktree identity mismatch");
  }
  return { root: expected, managed: true, taskId: writer.taskId };
}

export function listRuns(cwd: string): RunRecord[] {
  const runs = join(projectDirectory(cwd), "runs");
  safeDirectory(runs);
  if (!existsSync(runs)) return [];
  return readdirSync(runs).filter((id) => RUN_ID.test(id)).flatMap((id) => {
    const record = loadRun(cwd, id);
    return record ? [record] : [];
  });
}
