import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { loadRun, projectSettings } from "./project.ts";
import type { FileEvidence, ReviewEvidence } from "./review.ts";
import type { FinalReceipt } from "./final.ts";
import { inspectReviewTrace } from "./trace.ts";
import { inspectFlatRun } from "./launch.ts";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function boundedJson(path: string): any {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 128 * 1024) throw new Error("Unsafe or oversized final review receipt");
  return JSON.parse(readFileSync(path, "utf8"));
}
function command(cwd: string, program: string, args: string[], maxBuffer = 1024 * 1024): string {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", shell: false, timeout: 30000, maxBuffer,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", GH_PROMPT_DISABLED: "1" } });
  if (result.error || result.status !== 0) throw new Error(`${program} ${args[0]} failed: ${result.error?.message ?? result.stderr?.slice(0, 200) ?? result.status}`);
  return result.stdout.trim();
}
function pathInside(root: string, path: string): string {
  if (!path || path.startsWith("/") || /[\\\x00-\x1f\x7f]/.test(path)) throw new Error("Unsafe publication file path");
  const file = resolve(root, path);
  if (!file.startsWith(`${root}${sep}`)) throw new Error("Publication path escapes checkout");
  let current = root;
  for (const part of relative(root, file).split(sep)) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error("Publication path contains symlink");
  }
  return file;
}
function fileBytes(root: string, item: FileEvidence): Buffer | undefined {
  const path = pathInside(root, item.path);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error("Publication requires bounded regular files");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > 4 * 1024 * 1024) {
      throw new Error("Publication file changed while being inspected");
    }
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function names(bytes: Buffer): string[] {
  const items = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0");
  if (items.at(-1) === "") items.pop();
  return items;
}
function gitBytes(cwd: string, args: string[]): Buffer {
  const result = spawnSync("git", args, { cwd, encoding: "buffer", timeout: 15000, maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_EXTERNAL_DIFF: "", GIT_PAGER: "cat" } });
  if (result.error || result.status !== 0) throw new Error(`Publication Git snapshot failed (${args[0]})`);
  return result.stdout;
}
export type PublishPlan = { repo: string; branch: string; base: string; files: string[]; finalDirectory: string; digest: string };
/** Read-only, local proof: requires the *operator's* branch and an unchanged host-verified final bundle. */
export function inspectLocalPublication(cwd: string, flowId: string, repo: string, base: string): PublishPlan {
  const root = resolve(cwd);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^[A-Za-z0-9._/-]+$/.test(base)) throw new Error("Provide an exact GitHub OWNER/REPO and base branch");
  if (projectSettings(root).reviewDelivery !== "pr") throw new Error("Project review delivery is local, not pr");
  const record = loadRun(root, flowId);
  if (!record?.assignment.engineRunId) throw new Error("Flow has no bound engine run");
  if (command(root, "git", ["rev-parse", "--show-toplevel"]) !== root) throw new Error("Use the supplied checkout root");
  const branch = command(root, "git", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.length > 100) throw new Error("Unsafe publication branch");
  if (["main", "master", base].includes(branch)) throw new Error("Publish only from an operator-supplied non-base branch");
  const origin = command(root, "git", ["remote", "get-url", "origin"]);
  const matches = /^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(origin);
  if (!matches || matches[1].toLowerCase() !== repo.toLowerCase()) throw new Error("Origin is not the explicitly selected GitHub repository");
  const finalDirectory = join(root, ".falkenwarte", "reviews", flowId, `final-v${record.revision}`);
  const receipt = boundedJson(join(finalDirectory, "checks.json")) as FinalReceipt;
  const evidence = boundedJson(join(finalDirectory, "evidence.json")) as ReviewEvidence;
  if (inspectFlatRun(root, record.assignment.engineRunId).status !== "completed") throw new Error("Flat workflow has not completed");
  if (receipt.flowId !== flowId || receipt.engineRunId !== record.assignment.engineRunId ||
    receipt.verdict !== "ready_for_human_review" || !receipt.checks?.length || receipt.checks.some((check) => check.exitCode !== 0) ||
    evidence.flowId !== flowId || evidence.engineRunId !== receipt.engineRunId || evidence.reviewTrace.status !== "verified-local" ||
    evidence.reviewTrace.candidateDigest !== receipt.candidateDigest || evidence.baseCommit !== receipt.baseCommit) {
    throw new Error("Missing or mismatched final review receipts");
  }
  if (command(root, "git", ["rev-parse", "HEAD"]) !== receipt.baseCommit ||
    (record.assignment.launch && (record.assignment.launch.head !== receipt.baseCommit || record.assignment.launch.branch !== branch))) {
    throw new Error("HEAD or operator branch changed since factory intake and candidate capture");
  }
  const trace = inspectReviewTrace(root, record.assignment.engineRunId, evidence.files, evidence.baseCommit, evidence.writerTaskId);
  if (trace.status !== "verified-local" || trace.candidateDigest !== receipt.candidateDigest) throw new Error("Live reviewer trace no longer matches the final review");
  if (spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: root, timeout: 10000 }).status !== 0) {
    throw new Error("Index already contains staged changes; refuse to mix publication scopes");
  }
  const changed = [...new Set([...names(gitBytes(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"])),
    ...names(gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z", "--"]))])].sort();
  if (JSON.stringify(changed) !== JSON.stringify(evidence.files.map((item) => item.path))) throw new Error("Git changed-file inventory differs from the final review");
  for (const item of evidence.files) {
    const bytes = fileBytes(root, item);
    if (item.state === "deleted" ? bytes !== undefined : !bytes || bytes.length !== item.bytes || hash(bytes) !== item.sha256) {
      throw new Error(`Candidate file changed after verification: ${item.path}`);
    }
  }
  const diff = gitBytes(root, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--no-renames", "HEAD", "--"]);
  if (hash(diff) !== evidence.diffSha256) throw new Error("Git patch changed after verification");
  if (!changed.length) throw new Error("There are no reviewed project changes to publish");
  return { repo, branch, base, files: changed, finalDirectory, digest: receipt.candidateDigest };
}
/** Remote side effects require a separate exact operator /factory publish ... --confirm command. Never makes worktrees. */
export function publishReviewed(cwd: string, flowId: string, repo: string, base: string): { url: string; commit: string } {
  const root = resolve(cwd);
  const plan = inspectLocalPublication(root, flowId, repo, base);
  const metadata = JSON.parse(command(root, "gh", ["repo", "view", repo, "--json", "nameWithOwner,defaultBranchRef"]));
  if (metadata.nameWithOwner?.toLowerCase() !== repo.toLowerCase() || metadata.defaultBranchRef?.name !== base) {
    throw new Error("Confirmed GitHub repository/default branch differs from the explicit publication target");
  }
  const existing = JSON.parse(command(root, "gh", ["pr", "list", "--repo", repo, "--head", plan.branch, "--state", "open", "--json", "url"]));
  if (!Array.isArray(existing) || existing.length) throw new Error("An open PR already exists for this branch; inspect it before publishing");
  // Recheck immediately before the first local mutation. A failed later step is a partial operation; never auto-retry.
  inspectLocalPublication(root, flowId, repo, base);
  command(root, "git", ["add", "-A", "--", ...plan.files]);
  let commit: string;
  try {
    command(root, "git", ["commit", "-m", `feat(factory): deliver flow ${flowId.slice(0, 8)}`]);
    commit = command(root, "git", ["rev-parse", "HEAD"]);
  } catch (error) { throw new Error(`Files may now be staged, but no push was attempted: ${String(error)}`); }
  const title = loadRun(root, flowId)!.assignment.title;
  const body = `## Review\n\nFlow: ${flowId}\nCandidate SHA-256: ${plan.digest}\n\nHost-run checks and advisory review are recorded in the operator's local final package. Human approval is still required. No worktree was created or merged by the factory.\n`;
  const bodyFile = join(plan.finalDirectory, "pr-body.md");
  try { writeFileSync(bodyFile, body, { flag: "wx", mode: 0o600 }); }
  catch (error) { throw new Error(`Committed ${commit} locally, but PR body preparation failed; no push attempted. ${String(error)}`); }
  try { command(root, "git", ["push", "-u", "origin", `HEAD:refs/heads/${plan.branch}`]); }
  catch (error) { throw new Error(`Committed ${commit} locally; push failed, no PR claimed. ${String(error)}`); }
  let created: string;
  try { created = command(root, "gh", ["pr", "create", "--repo", repo, "--base", base, "--head", plan.branch, "--title", title, "--body-file", bodyFile]); }
  catch (error) { throw new Error(`Committed and pushed ${commit}; PR creation failed or is unknown. Inspect GitHub before retrying. ${String(error)}`); }
  try {
    const pr = JSON.parse(command(root, "gh", ["pr", "view", created, "--repo", repo, "--json", "url,state,headRefName,baseRefName,headRefOid"]));
    if (pr.url !== created || pr.state !== "OPEN" || pr.headRefName !== plan.branch || pr.baseRefName !== base || pr.headRefOid !== commit) {
      throw new Error("PR verification did not match the pushed commit and selected branches");
    }
  } catch (error) { throw new Error(`PR may exist at ${created}; verification failed. Do not repeat publication blindly. ${String(error)}`); }
  return { url: created, commit };
}
