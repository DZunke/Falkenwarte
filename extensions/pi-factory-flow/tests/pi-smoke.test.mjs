import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test } from "node:test";

const extension = resolve(import.meta.dirname, "../index.ts");

test("Pi discovers the factory command and progress tool without a task", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-factory-smoke-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync("pi", ["--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-mcp", "-e", extension, "--mode", "rpc", "--no-session"], {
    input: '{"id":"commands","type":"get_commands"}\n{"id":"tools","type":"get_state"}\n', encoding: "utf8", timeout: 15000,
    env: { ...process.env, PI_CODING_AGENT_DIR: root, HOME: root, USERPROFILE: root, PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(events.find((item) => item.id === "commands")?.data?.commands?.some((command) => command.name === "factory"), result.stdout);
  assert.ok(!events.some((item) => item.method === "setWidget" && item.widgetKey === "falkenwarte-factory-flow" && item.widgetLines?.length), result.stdout);
  const worker = spawnSync("pi", ["--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-mcp", "-e", extension, "--mode", "rpc", "--no-session"], {
    input: '{"id":"commands","type":"get_commands"}\n', encoding: "utf8", timeout: 15000,
    env: { ...process.env, PI_CODING_AGENT_DIR: root, HOME: root, USERPROFILE: root, PI_OFFLINE: "1", PI_WORKFLOW_ROLE: "worker" },
  });
  assert.equal(worker.status, 0, worker.stderr);
  const workerCommands = worker.stdout.trim().split("\n").map((line) => JSON.parse(line)).find((event) => event.id === "commands")?.data?.commands ?? [];
  assert.ok(!workerCommands.some((command) => command.name === "factory"));

  mkdirSync(join(root, ".falkenwarte"));
  writeFileSync(join(root, ".falkenwarte", "README.md"), "# Test project\n");
  const started = spawnSync("pi", ["--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-mcp", "-e", extension, "--mode", "rpc", "--no-session"], {
    cwd: root, input: '{"id":"start","type":"prompt","message":"/factory start Test the Pi flow"}\n', encoding: "utf8", timeout: 15000,
    env: { ...process.env, PI_CODING_AGENT_DIR: root, HOME: root, USERPROFILE: root, PI_OFFLINE: "1" },
  });
  assert.equal(started.status, 0, started.stderr);
  assert.ok(started.stdout.trim().split("\n").map((line) => JSON.parse(line)).some((item) =>
    item.method === "setWidget" && item.widgetKey === "falkenwarte-factory-flow" && item.widgetLines?.some((line) => line.includes("Test the Pi flow"))), started.stdout);
});

test("automatic start fails closed before recording a run when the supplied environment lacks the reviewed workflow", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-factory-auto-block-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".falkenwarte"));
  writeFileSync(join(root, ".falkenwarte", "README.md"), "# Test project\n");
  writeFileSync(join(root, ".falkenwarte", "settings.json"), '{"schemaVersion":1,"review":{"delivery":"local"},"execution":{"autoStart":true}}');
  const result = spawnSync("pi", ["--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-mcp", "-e", extension, "--mode", "rpc", "--no-session"], {
    cwd: root, input: '{"id":"start","type":"prompt","message":"/factory start automatic ticket"}\n', encoding: "utf8", timeout: 15000,
    env: { ...process.env, PI_CODING_AGENT_DIR: root, HOME: root, USERPROFILE: root, PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("Git launch preflight failed"), result.stdout);
  assert.ok(!result.stdout.includes("Project flow started"), result.stdout);
  assert.equal(readdirSync(join(root, ".falkenwarte")).includes("runs"), false);
});

test("a project flow reopens after the first Pi process exits", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-factory-restart-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".falkenwarte"));
  writeFileSync(join(root, ".falkenwarte", "README.md"), "# Restart test\n");
  const run = (message) => spawnSync("pi", ["--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-mcp", "-e", extension, "--mode", "rpc", "--no-session"], {
    cwd: root, input: `${JSON.stringify({ id: "prompt", type: "prompt", message })}\n`, encoding: "utf8", timeout: 15000,
    env: { ...process.env, PI_CODING_AGENT_DIR: root, HOME: root, USERPROFILE: root, PI_OFFLINE: "1" },
  });
  const first = run("/factory start Survive restart");
  assert.equal(first.status, 0, first.stderr);
  const [id] = readdirSync(join(root, ".falkenwarte", "runs"));
  const second = run(`/factory reopen ${id}`);
  assert.equal(second.status, 0, second.stderr);
  assert.ok(second.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).some((event) =>
    event.widgetKey === "falkenwarte-factory-flow" && event.widgetLines?.some((line) => line.includes("Survive restart"))), second.stdout);
  assert.ok(second.stdout.includes("worker state is unverified"));
});

test("RPC drives an issue task through explicit milestones without a model or GitHub write", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-factory-flow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".falkenwarte"));
  writeFileSync(join(root, ".falkenwarte", "README.md"), "# Test project\n");
  writeFileSync(join(root, ".falkenwarte", "settings.json"), '{"schemaVersion":1,"review":{"delivery":"local"}}\n');
  const child = spawn("pi", ["--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-mcp", "-e", extension, "--mode", "rpc", "--no-session"], {
    cwd: root, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PI_CODING_AGENT_DIR: root, HOME: root, USERPROFILE: root, PI_OFFLINE: "1" },
  });
  const prompts = [
    "/factory start https://github.com/DZunke/Falkenwarte/issues/1",
    "/factory start unrelated task",
    "/factory review-draft",
    "/factory advance planning Scoped Pi flow prototype",
    "/factory advance implementation Extension and tests added",
    "/factory stop",
    "/factory advance review Verification in progress",
    "/factory advance result No evidence yet",
    "/factory advance result Verification finished and limitations reported @evidence extensions/pi-factory-flow/tests/pi-smoke.test.mjs",
    "/factory close",
    "/factory list",
  ];
  const widgets = [];
  const notices = [];
  let clearedWidget = false;
  let buffer = "";
  let stderr = "";
  let index = 0;
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const send = () => child.stdin.write(`${JSON.stringify({ id: String(index), type: "prompt", message: prompts[index] })}\n`);
  const timer = setTimeout(() => child.kill(), 15000);
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      const event = JSON.parse(line);
      if (event.widgetKey === "falkenwarte-factory-flow") {
        if (event.widgetLines?.length) widgets.push(event.widgetLines);
        else if (widgets.length) clearedWidget = true;
      }
      if (event.method === "notify") notices.push(event.message);
      if (event.type === "response" && event.id === String(index)) {
        index++;
        if (index === prompts.length) child.stdin.end(); else send();
      }
    }
  });
  send();
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  assert.equal(exitCode, 0, stderr);
  assert.equal(index, prompts.length, stderr);
  assert.match(widgets.at(-1)?.join("\n") ?? "", /● result/);
  assert.match(widgets.at(-1)?.join("\n") ?? "", /Verification finished/);
  assert.ok(notices.some((message) => message?.includes("Close the current view")));
  assert.ok(notices.some((message) => message?.includes("Result needs an evidence")));
  assert.ok(notices.some((message) => message?.includes("Review draft blocked")));
  assert.ok(notices.some((message) => message?.includes("cannot stop workers")));
  assert.ok(clearedWidget);
  assert.ok(notices.some((message) => message?.includes("· closed · result")));
  const runs = readdirSync(join(root, ".falkenwarte", "runs"));
  assert.equal(runs.length, 1);
  const saved = JSON.parse(readFileSync(join(root, ".falkenwarte", "runs", runs[0], "run.json"), "utf8"));
  assert.equal(saved.state, "closed");
  assert.equal(saved.assignment.phase, "result");
});
