import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindWorkflowRun, start } from "../flow.ts";
import { loadRun, saveRun } from "../project.ts";
import { buildReviewEvidence } from "../review.ts";

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
}
function project(t) {
  const root = mkdtempSync(join(tmpdir(), "falkenwarte-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  mkdirSync(join(root, ".falkenwarte"));
  writeFileSync(join(root, ".falkenwarte", "README.md"), "# Project\n");
  writeFileSync(join(root, ".falkenwarte", "settings.json"), '{"schemaVersion":1,"review":{"delivery":"local"}}\n');
  writeFileSync(join(root, ".gitignore"), ".pi/\n.falkenwarte/runs/\n.falkenwarte/reviews/\n");
  writeFileSync(join(root, "hello.txt"), "before\n");
  git(root, "add", ".");
  git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  const id = "workflow_mysample_a1b2c3";
  const engine = join(root, ".pi", "workflows", id);
  mkdirSync(engine, { recursive: true });
  writeFileSync(join(engine, "run.json"), JSON.stringify({ runId: id, status: "completed", tasks: [
    { taskId: "task-1", specId: "implement.main", status: "completed", cwd: root, worktree: { enabled: false } },
  ] }));
  const assignment = bindWorkflowRun(start("Review <unsafe> & ticket"), id);
  saveRun(root, assignment, 0);
  return { root, assignment, engine };
}

test("local review draft records real changed bytes, diff, and supplied image only", (t) => {
  const { root, assignment } = project(t);
  writeFileSync(join(root, "hello.txt"), "after\n");
  writeFileSync(join(root, "new.txt"), "new content\n");
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("fixture")]);
  writeFileSync(join(root, "proof.png"), png);
  const { directory, evidence } = buildReviewEvidence(root, assignment.id, ["proof.png"]);
  assert.equal(evidence.reviewDelivery, "local");
  assert.equal(evidence.managedWorktree, false);
  assert.ok(evidence.limitations.some((line) => line.includes("operator-provided checkout")));
  assert.equal(evidence.files.length, 3);
  assert.equal(evidence.files.find((file) => file.path === "hello.txt")?.bytes, 6);
  assert.equal(evidence.files.find((file) => file.path === "proof.png")?.bytes, png.length);
  assert.match(readFileSync(join(directory, "changes.diff"), "utf8"), /\+after/);
  assert.doesNotMatch(readFileSync(join(directory, "changes.diff"), "utf8"), /new content/);
  const html = readFileSync(join(directory, "index.html"), "utf8");
  assert.match(html, /Review &lt;unsafe&gt; &amp; ticket/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /Not a completed review or published PR/);
  assert.match(html, /screenshots\//);
  assert.match(html, /href="untracked\/new\.txt"/);
  assert.equal(readFileSync(join(directory, "untracked", "new.txt"), "utf8"), "new content\n");
  writeFileSync(join(root, "new.txt"), "changed after bundle\n");
  assert.equal(readFileSync(join(directory, "untracked", "new.txt"), "utf8"), "new content\n");
  assert.ok(evidence.limitations.some((line) => line.includes("not attested")));
  assert.throws(() => buildReviewEvidence(root, assignment.id), /already exists/);
});

test("candidate and reviewer read trace are checked against the supplied checkout's actual bytes", (t) => {
  const { root, assignment, engine } = project(t);
  const content = "candidate bytes\n";
  writeFileSync(join(root, "hello.txt"), content);
  const baseCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  const files = [{ path: "hello.txt", state: "present", sha256: sha256(content), bytes: Buffer.byteLength(content), content }];
  const digest = sha256(JSON.stringify({ baseCommit, files }));
  writeFileSync(join(engine, "run.json"), JSON.stringify({ runId: assignment.engineRunId, status: "completed", tasks: [
    { taskId: "task-1", specId: "implement.main", status: "completed", cwd: root, worktree: { enabled: false } },
    { taskId: "task-2", specId: "candidate.main", status: "completed", cwd: root, worktree: { enabled: false } },
    { taskId: "task-3", specId: "review.main", status: "completed", cwd: root, worktree: { enabled: false } },
  ] }));
  mkdirSync(join(engine, "tasks", "task-2"), { recursive: true });
  mkdirSync(join(engine, "tasks", "task-3"), { recursive: true });
  writeFileSync(join(engine, "tasks", "task-2", "control.json"), JSON.stringify({ schema: "helper-output-v1", value: {
    schema: "falkenwarte-candidate-bytes-v1", baseCommit, writerTaskId: "task-1", files, digest,
  } }));
  writeFileSync(join(engine, "tasks", "task-3", "control.json"), JSON.stringify({ digest, verdict: "needs_human", filesReviewed: ["hello.txt"] }));
  const ledger = { schema: "workflow-artifact-read-v1", runId: assignment.engineRunId, taskId: "task-3", source: "candidate",
    artifact: "control", path: "$", truncated: true, returnedBytes: 120 };
  const ledgerPath = join(engine, "tasks", "task-3", "read-ledger.jsonl");
  writeFileSync(ledgerPath, `${JSON.stringify(ledger)}\n`);
  assert.throws(() => buildReviewEvidence(root, assignment.id), /untruncated candidate control read/);
  writeFileSync(ledgerPath, `${JSON.stringify({ ...ledger, truncated: false })}\n`);
  writeFileSync(join(root, "hello.txt"), "tampered\n");
  assert.throws(() => buildReviewEvidence(root, assignment.id), /no longer matches observed file bytes/);
  writeFileSync(join(root, "hello.txt"), content);
  const { directory, evidence } = buildReviewEvidence(root, assignment.id);
  assert.equal(evidence.reviewTrace.status, "verified-local");
  assert.equal(evidence.reviewTrace.candidateDigest, digest);
  assert.match(readFileSync(join(directory, "index.html"), "utf8"), /Local candidate\/reviewer trace: verified-local/);
});

test("auto-start review refuses a HEAD that drifted since assignment intake", (t) => {
  const { root, assignment } = project(t);
  writeFileSync(join(root, "hello.txt"), "candidate\n");
  const record = loadRun(root, assignment.id);
  saveRun(root, { ...assignment, launch: { head: "0".repeat(40), branch: "main" } }, record.revision);
  assert.throws(() => buildReviewEvidence(root, assignment.id), /HEAD or branch changed since/);
});

test("review draft refuses secret-looking untracked files", (t) => {
  const { root, assignment } = project(t);
  writeFileSync(join(root, ".env"), "PRIVATE=do-not-copy\n");
  assert.throws(() => buildReviewEvidence(root, assignment.id), /Sensitive-looking file/);
});

test("review draft fails closed for incomplete run, escaping screenshot, and symlink", (t) => {
  const { root, assignment, engine } = project(t);
  assert.throws(() => buildReviewEvidence(root, assignment.id, ["../outside.png"]), /escapes/);
  const bad = join(root, "bad.png");
  symlinkSync(join(root, "hello.txt"), bad);
  assert.throws(() => buildReviewEvidence(root, assignment.id, ["bad.png"]), /symlink/);
  rmSync(bad);
  writeFileSync(join(engine, "run.json"), JSON.stringify({ runId: assignment.engineRunId, status: "running" }));
  assert.throws(() => buildReviewEvidence(root, assignment.id), /not completed/);
});
