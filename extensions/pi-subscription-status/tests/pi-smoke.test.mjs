import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test } from "node:test";

const extension = resolve(import.meta.dirname, "../index.ts");

test("Pi loads the provider status extension offline without fetching account data", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-subscription-smoke-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync("pi", ["--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-mcp", "-e", extension, "--mode", "rpc", "--no-session"], {
    input: '{"id":"commands","type":"get_commands"}\n', encoding: "utf8", timeout: 15000,
    env: { ...process.env, PI_CODING_AGENT_DIR: root, HOME: root, USERPROFILE: root, PI_OFFLINE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  const response = result.stdout.trim().split("\n").map((line) => JSON.parse(line)).find((item) => item.id === "commands");
  assert.ok(response?.data?.commands?.some((command) => command.name === "falkenwarte-usage"), result.stdout);
});
