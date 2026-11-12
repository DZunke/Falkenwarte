import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { bindWorkflowRun, start } from "../flow.ts";
import { saveRun } from "../project.ts";
import { buildFinalReview } from "../final.ts";
import { inspectLocalPublication, publishReviewed } from "../publish.ts";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture(t, command, delivery = "local", autoStart = false) {
  const root = mkdtempSync(join(tmpdir(), "fw-final-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "ticket");
  mkdirSync(join(root, ".falkenwarte"));
  writeFileSync(join(root, ".falkenwarte", "README.md"), "# Project\n");
  writeFileSync(join(root, ".falkenwarte", "settings.json"), JSON.stringify({ schemaVersion: 1, review: { delivery }, execution: { autoStart }, verification: { commands: [command] } }));
  writeFileSync(join(root, ".gitignore"), ".pi/workflows/\n.falkenwarte/reviews/\n.falkenwarte/runs/\n");
  writeFileSync(join(root, "hello.txt"), "original\n");
  git(root, "add", ".");
  git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
  const baseCommit = git(root, "rev-parse", "HEAD");
  const content = "candidate\n";
  writeFileSync(join(root, "hello.txt"), content);
  const files = [{ path: "hello.txt", state: "present", bytes: Buffer.byteLength(content), sha256: hash(content), content }];
  const digest = hash(JSON.stringify({ baseCommit, files }));
  const runId = "workflow_fixture_a1b2";
  const engine = join(root, ".pi", "workflows", runId);
  mkdirSync(join(engine, "tasks", "task-3"), { recursive: true });
  mkdirSync(join(engine, "tasks", "task-4"), { recursive: true });
  writeFileSync(join(engine, "run.json"), JSON.stringify({ runId, status: "completed", name: "falkenwarte-flat", cwd: root,
    specPath: join(root, "workflows", "falkenwarte-flat", "spec.json"), tasks: [
    { taskId: "task-1", specId: "plan.main", status: "completed", cwd: root, worktree: { enabled: false } },
    { taskId: "task-2", specId: "implement.main", status: "completed", cwd: root, worktree: { enabled: false }, agent: "fw-implementer", agentFile: join(root, ".pi", "agents", "fw-implementer.md") },
    { taskId: "task-3", specId: "candidate.main", status: "completed", cwd: root, worktree: { enabled: false } },
    { taskId: "task-4", specId: "review.main", status: "completed", cwd: root, worktree: { enabled: false }, agent: "brunhilde-nordwald", agentFile: join(root, ".pi", "agents", "brunhilde-nordwald.md") },
  ] }));
  writeFileSync(join(engine, "tasks", "task-3", "control.json"), JSON.stringify({ schema: "helper-output-v1", value: {
    schema: "falkenwarte-candidate-bytes-v1", baseCommit, writerTaskId: "task-2", files, digest,
  } }));
  writeFileSync(join(engine, "tasks", "task-4", "control.json"), JSON.stringify({ digest, verdict: "needs_human", filesReviewed: ["hello.txt"] }));
  writeFileSync(join(engine, "tasks", "task-4", "read-ledger.jsonl"), `${JSON.stringify({ schema: "workflow-artifact-read-v1", runId,
    taskId: "task-4", source: "candidate", artifact: "control", path: "$", truncated: false, returnedBytes: 120 })}\n`);
  const assignment = bindWorkflowRun(start("Ticket review"), runId);
  saveRun(root, assignment, 0);
  return { root, assignment, digest };
}

test("final local package records host-run passing checks and matching candidate/reviewer bytes", (t) => {
  const { root, assignment, digest } = fixture(t, ["node", "-e", "process.exit(0)"]);
  const { directory, receipt } = buildFinalReview(root, assignment.id);
  assert.equal(receipt.verdict, "ready_for_human_review");
  assert.equal(receipt.candidateDigest, digest);
  assert.equal(receipt.checks.length, 1);
  assert.equal(receipt.checks[0].exitCode, 0);
  assert.match(readFileSync(join(directory, "index.html"), "utf8"), /Ready for human review, not approved or published/);
  assert.equal(JSON.parse(readFileSync(join(directory, "checks.json"), "utf8")).checks[0].stdoutBytes, 0);
  assert.throws(() => buildFinalReview(root, assignment.id), /already exists/);
});

test("final package includes raster evidence as a hash and local snapshot, never a visual approval claim", (t) => {
  const { root, assignment } = fixture(t, ["node", "-e", "process.exit(0)"]);
  const raster = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(15000)]);
  writeFileSync(join(root, "proof.png"), raster);
  const engine = join(root, ".pi", "workflows", assignment.engineRunId, "tasks");
  const candidatePath = join(engine, "task-3", "control.json");
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
  candidate.value.files.push({ path: "proof.png", state: "present", bytes: raster.length, sha256: hash(raster),
    mime: "image/png", limitation: "Raster image is hashed but not visually inspected by this text-only reviewer." });
  candidate.value.digest = hash(JSON.stringify({ baseCommit: candidate.value.baseCommit, files: candidate.value.files }));
  writeFileSync(candidatePath, JSON.stringify(candidate));
  writeFileSync(join(engine, "task-4", "control.json"), JSON.stringify({ digest: candidate.value.digest,
    verdict: "needs_human", filesReviewed: ["hello.txt", "proof.png"] }));
  const { directory, receipt } = buildFinalReview(root, assignment.id, ["proof.png"]);
  assert.equal(receipt.candidateDigest, candidate.value.digest);
  assert.deepEqual(readFileSync(join(directory, "untracked", "proof.png")), raster);
  assert.match(receipt.limitations.join(" "), /not visually approved/);
});

test("Pi session start finalizes an already-completed auto-start run after process restart", (t) => {
  const { root, assignment } = fixture(t, ["node", "-e", "process.exit(0)"], "local", true);
  const extension = resolve(import.meta.dirname, "../index.ts");
  const home = mkdtempSync(join(tmpdir(), "fw-pi-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = spawnSync("pi", ["--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-mcp", "-e", extension, "--mode", "rpc", "--no-session"], {
    cwd: root, input: '{"id":"list","type":"prompt","message":"/factory list"}\n', encoding: "utf8", timeout: 15000,
    env: { ...process.env, PI_CODING_AGENT_DIR: home, HOME: home, USERPROFILE: home, PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  const path = join(root, ".falkenwarte", "reviews", assignment.id, "final-v1", "checks.json");
  assert.equal(existsSync(path), true, result.stdout);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).checks[0].exitCode, 0);
});

test("publication readiness stays read-only and rejects wrong target, staged or changed bytes", (t) => {
  const { root, assignment } = fixture(t, ["node", "-e", "process.exit(0)"], "pr");
  git(root, "remote", "add", "origin", "https://github.com/example/repo.git");
  buildFinalReview(root, assignment.id);
  assert.throws(() => inspectLocalPublication(root, assignment.id, "example/other", "main"), /Origin is not/);
  const plan = inspectLocalPublication(root, assignment.id, "example/repo", "main");
  assert.equal(plan.branch, "ticket");
  assert.deepEqual(plan.files, ["hello.txt"]);
  git(root, "add", "hello.txt");
  assert.throws(() => inspectLocalPublication(root, assignment.id, "example/repo", "main"), /staged changes/);
  git(root, "reset", "-q", "HEAD", "--", "hello.txt");
  writeFileSync(join(root, "hello.txt"), "changed later\n");
  assert.throws(() => inspectLocalPublication(root, assignment.id, "example/repo", "main"), /Candidate file changed/);
});

test("explicit publication path verifies a simulated PR and pushes only the reviewed branch", (t) => {
  const { root, assignment } = fixture(t, ["node", "-e", "process.exit(0)"], "pr");
  git(root, "remote", "add", "origin", "https://github.com/example/repo.git");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  buildFinalReview(root, assignment.id);
  const bare = mkdtempSync(join(tmpdir(), "fw-fake-remote-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  git(bare, "init", "--bare", "-q");
  const bin = mkdtempSync(join(tmpdir(), "fw-fake-bin-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const actualGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(bin, "git"), `#!/usr/bin/env node\nconst { spawnSync }=require('node:child_process');\nconst a=process.argv.slice(2);\nconst args=a[0]==='push'?['push',process.env.FW_FAKE_BARE,'HEAD:refs/heads/ticket']:a;\nconst r=spawnSync(process.env.FW_REAL_GIT,args,{stdio:'inherit'});process.exit(r.status??1);\n`, { mode: 0o755 });
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env node\nconst { execFileSync }=require('node:child_process');\nconst a=process.argv.slice(2);\nif(a[0]==='repo'&&a[1]==='view')console.log(JSON.stringify({nameWithOwner:'example/repo',defaultBranchRef:{name:'main'}}));\nelse if(a[0]==='pr'&&a[1]==='list')console.log('[]');\nelse if(a[0]==='pr'&&a[1]==='create')console.log('https://github.com/example/repo/pull/12');\nelse if(a[0]==='pr'&&a[1]==='view')console.log(JSON.stringify({url:'https://github.com/example/repo/pull/12',state:'OPEN',headRefName:'ticket',baseRefName:'main',headRefOid:execFileSync(process.env.FW_REAL_GIT,['rev-parse','HEAD'],{encoding:'utf8'}).trim()}));\nelse process.exit(2);\n`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.FW_FAKE_BARE = bare;
  process.env.FW_REAL_GIT = actualGit;
  let result;
  try { result = publishReviewed(root, assignment.id, "example/repo", "main"); }
  finally { process.env.PATH = oldPath; delete process.env.FW_FAKE_BARE; delete process.env.FW_REAL_GIT; }
  assert.equal(result.url, "https://github.com/example/repo/pull/12");
  assert.equal(result.commit, git(root, "rev-parse", "HEAD"));
  assert.equal(result.commit, git(bare, "rev-parse", "refs/heads/ticket"));
  assert.match(readFileSync(join(root, ".falkenwarte", "reviews", assignment.id, "final-v1", "pr-body.md"), "utf8"), /Human approval is still required/);
});

test("failed checks and changed candidate bytes block final delivery", (t) => {
  const failed = fixture(t, ["node", "-e", "process.exit(7)"]);
  assert.throws(() => buildFinalReview(failed.root, failed.assignment.id), /failed \(7\)/);
  assert.equal(existsSync(join(failed.root, ".falkenwarte", "reviews", failed.assignment.id, "final-v1")), false);
  const changed = fixture(t, ["node", "-e", "require('fs').writeFileSync('hello.txt','altered\\n')"]);
  assert.throws(() => buildFinalReview(changed.root, changed.assignment.id), /no longer matches observed file bytes/);
  assert.equal(existsSync(join(changed.root, ".falkenwarte", "reviews", changed.assignment.id, "final-v1")), false);
});
