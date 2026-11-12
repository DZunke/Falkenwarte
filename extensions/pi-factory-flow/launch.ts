import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { inspectWorkflowRun, listRuns, projectDirectory } from "./project.ts";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10000, maxBuffer: 256 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat" } });
  if (result.error || result.status !== 0) throw new Error(`Git launch preflight failed (${args[0]}): ${result.error?.message ?? result.stderr?.trim() ?? result.status}`);
  return result.stdout;
}

function trackedFile(cwd: string, path: string): string {
  let current = cwd;
  for (const segment of path.split("/")) {
    current = join(current, segment);
    if (!existsSync(current) || lstatSync(current).isSymbolicLink()) throw new Error(`Untrusted or missing launch resource: ${path}`);
  }
  if (!lstatSync(current).isFile() || lstatSync(current).size > 64 * 1024) throw new Error(`Invalid launch resource: ${path}`);
  git(cwd, ["ls-files", "--error-unmatch", "--", path]);
  return current;
}

export function inspectFlatRun(cwd: string, id: string): { runId: string; status: string } {
  const observed = inspectWorkflowRun(cwd, id);
  const root = realpathSync(resolve(cwd));
  const run = JSON.parse(readFileSync(join(root, ".pi", "workflows", id, "run.json"), "utf8"));
  const expected = ["plan.main", "implement.main", "candidate.main", "review.main"];
  if (run.name !== "falkenwarte-flat" || run.cwd !== root ||
    run.specPath !== join(root, "workflows", "falkenwarte-flat", "spec.json") ||
    !Array.isArray(run.tasks) || run.tasks.length !== expected.length ||
    run.tasks.some((item: any, index: number) => item.specId !== expected[index] || item.cwd !== root || item.worktree?.enabled !== false) ||
    run.tasks[1].agent !== "fw-implementer" || run.tasks[1].agentFile !== join(root, ".pi", "agents", "fw-implementer.md") ||
    run.tasks[3].agent !== "brunhilde-nordwald" || run.tasks[3].agentFile !== join(root, ".pi", "agents", "brunhilde-nordwald.md")) {
    throw new Error("Engine run does not match the exact in-place flat project workflow");
  }
  return observed;
}

/** Preparation only. Never starts a model, worker, Git write, or workflow. */
export function checkLaunchable(cwd: string, excludeFlowId?: string): { branch: string | null; head: string; workflow: "falkenwarte-flat" } {
  const root = realpathSync(resolve(cwd));
  projectDirectory(root);
  if (git(root, ["rev-parse", "--show-toplevel"]).trim() !== root) throw new Error("Start from the ticket worktree root");
  // The operator owns the checkout: primary, linked, or detached are all valid local work environments.
  const branchResult = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: root, encoding: "utf8", timeout: 10000 });
  if (branchResult.error || ![0, 1].includes(branchResult.status ?? -1)) throw new Error("Cannot inspect project branch");
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : null;
  const head = git(root, ["rev-parse", "--verify", "HEAD"]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error("Invalid project HEAD");
  if (branch !== null && (!branch || /[\x00-\x1f\x7f]/.test(branch))) throw new Error("Invalid project branch");
  const changes = git(root, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=no"]);
  if (changes.trim()) throw new Error("Ticket worktree must be clean before a new workflow launch");
  if (listRuns(root).some((run) => run.state === "open" && run.assignment.id !== excludeFlowId)) {
    throw new Error("Another project flow remains open in this checkout; close it before starting another ticket");
  }
  const engineRoot = join(root, ".pi", "workflows");
  if (existsSync(engineRoot)) {
    if (lstatSync(engineRoot).isSymbolicLink() || !lstatSync(engineRoot).isDirectory()) throw new Error("Unsafe workflow storage");
    for (const id of readdirSync(engineRoot).filter((name) => /^workflow_[a-z0-9_]+$/.test(name))) {
      const observed = inspectWorkflowRun(root, id);
      if (!["completed", "failed", "interrupted"].includes(observed.status)) {
        throw new Error(`Another workflow (${id}) is ${observed.status} in this checkout; inspect or stop it before launching`);
      }
    }
  }
  trackedFile(root, ".falkenwarte/settings.json"); // Automatic execution requires a reviewed, versioned opt-in.
  const spec = trackedFile(root, "workflows/falkenwarte-flat/spec.json");
  trackedFile(root, "workflows/falkenwarte-flat/helpers/candidate-bytes.mjs");
  const worker = trackedFile(root, ".pi/agents/fw-implementer.md");
  const reviewerFile = trackedFile(root, ".pi/agents/brunhilde-nordwald.md");
  const definition = readFileSync(worker, "utf8");
  const reviewerDefinition = readFileSync(reviewerFile, "utf8");
  if (!/^---\r?\n[\s\S]*?^name: fw-implementer\s*$/m.test(definition)) throw new Error("Project worker identity is not fw-implementer");
  if (!/^---\r?\n[\s\S]*?^name: brunhilde-nordwald\s*$/m.test(reviewerDefinition)) throw new Error("Project reviewer identity is not Brunhilde Nordwald");
  const workflow = JSON.parse(readFileSync(spec, "utf8")) as { name?: unknown; defaults?: { worktreePolicy?: unknown }; artifactGraph?: { stages?: unknown } };
  const stages = Array.isArray(workflow.artifactGraph?.stages) ? workflow.artifactGraph.stages : [];
  const writer = stages.find((stage) => stage?.id === "implement");
  const reviewer = stages.find((stage) => stage?.id === "review");
  if (workflow.name !== "falkenwarte-flat" || workflow.defaults?.worktreePolicy !== "off" ||
    stages.some((stage) => stage?.worktreePolicy && stage.worktreePolicy !== "off") ||
    writer?.worktreePolicy !== "off" || writer?.agent !== "fw-implementer" || reviewer?.agent !== "brunhilde-nordwald" ||
    !Array.isArray(reviewer?.tools) || reviewer.tools.length !== 0 ||
    reviewer?.inputPolicy?.requiredReads?.[0]?.source !== "candidate") {
    throw new Error("Project workflow no longer meets the reviewed isolation/read-evidence boundary");
  }
  return { branch, head, workflow: "falkenwarte-flat" };
}
