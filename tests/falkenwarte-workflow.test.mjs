import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import candidateBytes from "../workflows/falkenwarte-flat/helpers/candidate-bytes.mjs";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
}
function project(t) {
  const root = mkdtempSync(join(tmpdir(), "falkenwarte-candidate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, ".gitignore"), ".pi/workflows/\n");
  writeFileSync(join(root, "existing.txt"), "baseline\n");
  git(root, "add", ".");
  git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  const id = "workflow_test_abc123";
  const directory = join(root, ".pi", "workflows", id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "run.json"), JSON.stringify({ runId: id, cwd: root, tasks: [
    { taskId: "task-2", specId: "implement.main", cwd: root, worktree: { enabled: false } },
  ] }));
  const context = { cwd: root, runId: id, signal: new AbortController().signal };
  return { root, directory, context };
}

test("flat workflow leaves worktree management to the operator and requires a reviewer artifact read", () => {
  const spec = JSON.parse(readFileSync(new URL("../workflows/falkenwarte-flat/spec.json", import.meta.url), "utf8"));
  const stages = spec.artifactGraph.stages;
  assert.equal(spec.defaults.worktreePolicy, "off");
  assert.equal(stages.find((stage) => stage.id === "implement").worktreePolicy, "off");
  assert.deepEqual(stages.find((stage) => stage.id === "review").tools, []);
  assert.equal(stages.find((stage) => stage.id === "review").agent, "brunhilde-nordwald");
  assert.equal(stages.find((stage) => stage.id === "review").inputPolicy.requiredReads[0].source, "candidate");
});

test("candidate helper captures bytes from the supplied checkout, refusing engine mismatches and unsafe files", async (t) => {
  const { root, directory, context } = project(t);
  const bytes = "Hello, operator-provided checkout!\n";
  writeFileSync(join(root, "greeting.txt"), bytes);
  const packet = await candidateBytes({ sources: { implement: { digest: "worker report" } }, context });
  assert.equal(packet.schema, "helper-output-v1");
  assert.equal(packet.value.writerTaskId, "task-2");
  assert.deepEqual(packet.value.files.map((file) => file.path), ["greeting.txt"]);
  assert.equal(packet.value.files[0].content, bytes);
  assert.equal(packet.value.files[0].sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.ok(packet.value.limitations.some((line) => line.includes("concurrent edits")));
  const raster = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(15000)]);
  writeFileSync(join(root, "proof.png"), raster);
  const withRaster = await candidateBytes({ sources: { implement: {} }, context });
  const image = withRaster.value.files.find((file) => file.path === "proof.png");
  assert.equal(image.mime, "image/png");
  assert.equal(image.sha256, createHash("sha256").update(raster).digest("hex"));
  assert.equal(image.content, undefined);
  rmSync(join(root, "proof.png"));
  writeFileSync(join(directory, "run.json"), JSON.stringify({ runId: context.runId, cwd: root, tasks: [
    { taskId: "task-2", specId: "implement.main", cwd: join(root, "foreign"), worktree: { enabled: true } },
  ] }));
  await assert.rejects(() => candidateBytes({ sources: { implement: {} }, context }), /operator-provided checkout/);
  writeFileSync(join(directory, "run.json"), JSON.stringify({ runId: context.runId, cwd: root, tasks: [
    { taskId: "task-2", specId: "implement.main", cwd: root, worktree: { enabled: false } },
  ] }));
  symlinkSync(join(root, "existing.txt"), join(root, "escape.txt"));
  await assert.rejects(() => candidateBytes({ sources: { implement: {} }, context }), /symlink/);
  rmSync(join(root, "escape.txt"));
  symlinkSync(join(root, "does-not-exist"), join(root, "dangling.txt"));
  await assert.rejects(() => candidateBytes({ sources: { implement: {} }, context }), /symlink/);
  rmSync(join(root, "dangling.txt"));
  writeFileSync(join(root, ".env.production"), "SECRET=never send\n");
  await assert.rejects(() => candidateBytes({ sources: { implement: {} }, context }), /sensitive-looking filename/);
});
