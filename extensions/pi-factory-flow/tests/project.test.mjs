import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../flow.ts";
import { inspectWorkflowRun, listRuns, loadRun, projectDirectory, projectSettings, reviewDelivery, saveRun, writeHandoff } from "../project.ts";

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "falkenwarte-run-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".falkenwarte"));
  writeFileSync(join(root, ".falkenwarte", "README.md"), "# Project\n");
  return root;
}

test("project configuration is declarative, local by default and fails closed", (t) => {
  const root = project(t);
  assert.equal(projectDirectory(root), join(root, ".falkenwarte"));
  assert.equal(reviewDelivery(root), "local");
  const file = join(root, ".falkenwarte", "settings.json");
  writeFileSync(file, '{"schemaVersion":1,"review":{"delivery":"pr"}}');
  assert.equal(reviewDelivery(root), "pr");
  assert.equal(projectSettings(root).autoStart, false);
  writeFileSync(file, '{"schemaVersion":1,"review":{"delivery":"pr"},"execution":{"autoStart":true}}');
  assert.equal(projectSettings(root).autoStart, true);
  writeFileSync(file, '{"schemaVersion":1,"review":{"delivery":"local"},"verification":{"commands":[["node","--test","tests/suite.test.mjs"]]}}');
  assert.deepEqual(projectSettings(root).checks, [["node", "--test", "tests/suite.test.mjs"]]);
  writeFileSync(file, '{"schemaVersion":1,"review":{"delivery":"local"},"verification":{"commands":[["bash","-c","echo unsafe"]]}}');
  assert.throws(() => projectSettings(root), /Unsupported/);
  writeFileSync(file, '{"schemaVersion":1,"review":{"delivery":"pr"},"execution":{"autoStart":"yes"}}');
  assert.throws(() => projectSettings(root), /Unsupported/);
  writeFileSync(file, '{"schemaVersion":1,"review":{"delivery":"remote"}}');
  assert.throws(() => reviewDelivery(root), /Unsupported/);
  writeFileSync(file, '{"schemaVersion":1,"review":{"delivery":"pr"},"command":"curl evil"}');
  assert.throws(() => reviewDelivery(root), /Unsupported/);
  rmSync(file);
  symlinkSync(join(root, ".falkenwarte", "README.md"), file);
  assert.throws(() => reviewDelivery(root), /Unsafe project file/);
});

test("project run survives a fresh reader; closed records and stale writers cannot reopen", (t) => {
  const root = project(t);
  const task = start("Inspect delivery");
  assert.equal(loadRun(root, task.id), undefined);
  assert.equal(saveRun(root, task, 0).revision, 1);
  assert.throws(() => saveRun(root, task, 0), /changed or closed/);
  const restored = loadRun(root, task.id);
  assert.equal(restored?.assignment.id, task.id);
  assert.equal(listRuns(root).length, 1);
  const handoff = writeHandoff(root, task.id);
  assert.match(readFileSync(handoff, "utf8"), /Worker\/process status: \*\*unknown\*\*/);
  assert.throws(() => writeHandoff(root, task.id), /EEXIST/);
  assert.equal(saveRun(root, task, restored.revision, "closed").state, "closed");
  assert.throws(() => saveRun(root, task, 2), /changed or closed/);
  assert.equal(JSON.parse(readFileSync(join(root, ".falkenwarte", "runs", task.id, "run.json"), "utf8")).state, "closed");
  assert.throws(() => loadRun(root, "../../escape"), /Invalid project flow ID/);
});

test("execution record binding is confined to this project's real engine run", (t) => {
  const root = project(t);
  const id = "workflow_mysample_a1b2c3";
  const directory = join(root, ".pi", "workflows", id);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "run.json");
  writeFileSync(file, JSON.stringify({ runId: id, status: "running" }));
  assert.deepEqual(inspectWorkflowRun(root, id), { runId: id, status: "running" });
  assert.throws(() => inspectWorkflowRun(project(t), id), /Missing/);
  writeFileSync(file, JSON.stringify({ runId: "workflow_wrong", status: "running" }));
  assert.throws(() => inspectWorkflowRun(root, id), /Mismatched/);
  rmSync(file);
  symlinkSync(join(root, ".falkenwarte", "README.md"), file);
  assert.throws(() => inspectWorkflowRun(root, id), /Unsafe project file/);
});

test("symlinked run storage is refused", (t) => {
  const root = project(t);
  const elsewhere = mkdtempSync(join(tmpdir(), "falkenwarte-elsewhere-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  symlinkSync(elsewhere, join(root, ".falkenwarte", "runs"), "dir");
  assert.throws(() => saveRun(root, start("Do not escape"), 0), /Unsafe project directory/);
});
