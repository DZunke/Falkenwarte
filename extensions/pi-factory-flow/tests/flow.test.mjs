import assert from "node:assert/strict";
import { test } from "node:test";
import { advance, advanceMatching, bindRun, bindWorkflowRun, compact, display, matchingWorkflowLaunch, recordAgents, recordVerifiedPr, rowsFromSubagent, rowsFromNotice, restoreAssignment, start, terminalRows } from "../flow.ts";

test("task identity, self-reported milestones, evidence and review loop", () => {
  assert.throws(() => start(" "));
  assert.throws(() => start("task\u001b[31m"));
  assert.throws(() => start("test", "https://example.org/1"));
  assert.throws(() => start("test", "https://github.com/a/b%0Aevil/issues/1"));
  let task = start("Show factory flow", "https://github.com/DZunke/Falkenwarte/issues/1");
  assert.match(task.id, /^[0-9a-f-]{36}$/);
  assert.equal(restoreAssignment(task)?.id, task.id);
  assert.equal(restoreAssignment({ title: "legacy", phase: "idea", entries: [], agents: [] }), undefined);
  assert.equal(restoreAssignment({ ...task, boundRunIds: undefined }), undefined);
  assert.throws(() => advanceMatching(task, "another-flow", "planning", "Wrong task"), /No matching/);
  assert.throws(() => advanceMatching(undefined, task.id, "planning", "Stopped task"), /No matching/);
  assert.throws(() => advance(task, "review", "skipped build"));
  assert.throws(() => advance(task, "idea", "unsafe\nterminal"));
  for (const phase of ["planning", "implementation", "review", "implementation", "review"]) task = advance(task, phase, `Reported ${phase}`);
  assert.throws(() => advance(task, "result", "No evidence"));
  task = advance(task, "result", "Tests and review reported", "Orchestrator", "extensions/pi-factory-flow/tests/flow.test.mjs");
  assert.equal(task.phase, "result");
  assert.equal(task.entries.length, 6);
  assert.match(display(task).join("\n"), /self-reported/);
  assert.doesNotMatch(display(task).join("\n"), /✓/);
  assert.match(compact(task).at(-1), /flow.test.mjs/);
  assert.throws(() => advance(task, "pr", "Fake PR"));
  assert.throws(() => advance(task, "idea", "reset"));
});

test("a verified PR receipt, not a self-report, is required for the pr phase", () => {
  const initial = start("Scoped review");
  assert.throws(() => advance(initial, "pr", "I opened a PR", "Model"), /requires a verified publication receipt/);
  const published = recordVerifiedPr(initial, "https://github.com/example/repo/pull/42", "a".repeat(40));
  assert.equal(published.phase, "pr");
  assert.equal(published.published.url, "https://github.com/example/repo/pull/42");
  assert.ok(restoreAssignment(published));
  assert.throws(() => recordVerifiedPr(published, published.published.url, "a".repeat(40)), /unique verified/);
});

test("engine launch attribution requires the exact flow ID and a named workflow", () => {
  const first = start("First ticket");
  const second = start("Second ticket");
  const call = { workflow: "spec-review", task: `Falkenwarte flow ID: ${first.id}\nFirst ticket` };
  assert.equal(matchingWorkflowLaunch(call, first.id), true);
  assert.equal(matchingWorkflowLaunch(call, second.id), false);
  assert.equal(matchingWorkflowLaunch({ task: call.task }, first.id), false);
  assert.equal(matchingWorkflowLaunch({ ...call, task: `Other instruction\n${call.task}` }, first.id), false);
  const bound = bindWorkflowRun(first, "workflow_mysample_a1b2c3");
  assert.equal(bound.engineRunId, "workflow_mysample_a1b2c3");
  assert.equal(restoreAssignment(bound)?.engineRunId, bound.engineRunId);
  assert.match(display(bound).join("\n"), /inspect \/workflow workflow_mysample_a1b2c3/);
  assert.throws(() => bindWorkflowRun(bound, "workflow_another_b2c3d4"), /only one exact/);
  assert.throws(() => bindWorkflowRun(first, "../../other"), /only one exact/);
});

test("receipts remain session activity until an observed run is explicitly bound; parallel indices stay distinct", () => {
  const rows = rowsFromSubagent({ runId: "run-1", results: [
    { agent: "brunhilde-nordwald", progress: { status: "running" }, index: 0 },
    { agent: "brunhilde-nordwald", progress: { status: "running" }, index: 1 },
    { exitCode: 0 },
  ] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.index), [0, 1]);
  assert.deepEqual(rowsFromSubagent({ runId: "run-1", results: [
    { agent: "brunhilde-nordwald", index: 0, exitCode: 0, execution: { status: "completed" } },
    { agent: "brunhilde-nordwald", index: 1, exitCode: 1, execution: { status: "failed" } },
  ] }, true).map((row) => row.status), ["completed", "failed"]);
  assert.equal(rowsFromSubagent({ results: [{ agent: "albert-metzler", exitCode: 0 }] }, true)[0].status, "completed");
  const task = start("Task");
  assert.throws(() => bindRun(task, "guessed", rows));
  assert.match(display(task, rows).join("\n"), /session activity \(unlinked\)/);
  assert.equal(task.agents.length, 0);
  const bound = bindRun(task, "run-1", rows);
  assert.equal(bound.agents.length, 2);
  assert.equal(recordAgents(bound.agents, [{ agent: "brunhilde-nordwald", status: "completed", runId: "run-1", index: 0 }]).length, 2);
  assert.doesNotMatch(display(bound, rows).join("\n"), /session activity \(unlinked\)/);
  assert.match(compact(advance(bound, "idea", "Reviewed the receipt")).at(-1), /Reviewed the receipt/);
  assert.equal(terminalRows(rows, [], true).every((row) => row.status === "failed/unknown"), true);
  assert.equal(terminalRows(rows, [{ ...rows[0], status: "completed" }], false)[1].status, "unknown");
  assert.deepEqual(rowsFromNotice({ runs: [{ childRuns: [
    { agent: "brunhilde-nordwald", status: "completed", runId: "child-1" },
    { agent: "brunhilde-nordwald", status: "failed", runId: "child-2" },
  ] }] }).map((row) => row.runId), ["child-1", "child-2"]);
});
