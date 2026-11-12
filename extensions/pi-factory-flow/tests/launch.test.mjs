import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { start } from "../flow.ts";
import { checkLaunchable, inspectFlatRun } from "../launch.ts";
import { saveRun } from "../project.ts";

function git(cwd, ...args) {
  const done = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10000 });
  assert.equal(done.status, 0, done.stderr);
}

test("launch preflight inspects only the supplied clean checkout, without managing worktrees", (t) => {
  const root = mkdtempSync(join(tmpdir(), "fw-launch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  mkdirSync(join(root, ".falkenwarte"));
  writeFileSync(join(root, ".falkenwarte", "README.md"), "# Adopted project\n");
  writeFileSync(join(root, ".falkenwarte", "settings.json"), '{"schemaVersion":1,"review":{"delivery":"local"},"execution":{"autoStart":true}}');
  writeFileSync(join(root, ".gitignore"), ".pi/workflows/\n.falkenwarte/runs/\n.falkenwarte/reviews/\n");
  const repo = resolve(import.meta.dirname, "../../..");
  mkdirSync(join(root, ".pi", "agents"), { recursive: true });
  mkdirSync(join(root, "workflows"), { recursive: true });
  cpSync(join(repo, ".pi/agents/fw-implementer.md"), join(root, ".pi/agents/fw-implementer.md"));
  cpSync(join(repo, ".pi/agents/brunhilde-nordwald.md"), join(root, ".pi/agents/brunhilde-nordwald.md"));
  cpSync(join(repo, "workflows/falkenwarte-flat"), join(root, "workflows/falkenwarte-flat"), { recursive: true });
  git(root, "add", ".");
  git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  const expected = { branch: "main", head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), workflow: "falkenwarte-flat" };
  assert.deepEqual(checkLaunchable(root), expected);
  writeFileSync(join(root, "unrelated.txt"), "dirty\n");
  assert.throws(() => checkLaunchable(root), /must be clean/);
  rmSync(join(root, "unrelated.txt"));
  const engine = join(root, ".pi", "workflows", "workflow_fixture_a11");
  mkdirSync(engine, { recursive: true });
  writeFileSync(join(engine, "run.json"), '{"runId":"workflow_fixture_a11","status":"running"}');
  assert.throws(() => checkLaunchable(root), /Another workflow.*running/);
  writeFileSync(join(engine, "run.json"), '{"runId":"workflow_fixture_a11","status":"completed"}');
  assert.deepEqual(checkLaunchable(root), expected);
  const stagedRun = { runId: "workflow_fixture_a11", status: "completed", name: "falkenwarte-flat", cwd: root,
    specPath: join(root, "workflows", "falkenwarte-flat", "spec.json"),
    tasks: ["plan.main", "implement.main", "candidate.main", "review.main"].map((specId) => ({ specId, cwd: root, worktree: { enabled: false },
      ...(specId === "implement.main" ? { agent: "fw-implementer", agentFile: join(root, ".pi", "agents", "fw-implementer.md") } : {}),
      ...(specId === "review.main" ? { agent: "brunhilde-nordwald", agentFile: join(root, ".pi", "agents", "brunhilde-nordwald.md") } : {}) })) };
  writeFileSync(join(engine, "run.json"), JSON.stringify(stagedRun));
  assert.equal(inspectFlatRun(root, "workflow_fixture_a11").status, "completed");
  writeFileSync(join(engine, "run.json"), JSON.stringify({ ...stagedRun, name: "unrelated-workflow" }));
  assert.throws(() => inspectFlatRun(root, "workflow_fixture_a11"), /does not match/);
  const flow = start("First ticket");
  saveRun(root, flow, 0);
  assert.throws(() => checkLaunchable(root), /Another project flow/);
  assert.deepEqual(checkLaunchable(root, flow.id), expected);
  git(root, "switch", "--detach", "--quiet");
  assert.deepEqual(checkLaunchable(root, flow.id), { ...expected, branch: null });
});
