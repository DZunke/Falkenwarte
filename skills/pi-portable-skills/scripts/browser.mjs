#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "agent-browser", "bin", "agent-browser.js");
if (!existsSync(cli)) {
  console.error("agent-browser is missing. Run node scripts/portable-pi.mjs update from the portable profile checkout.");
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit" });
  if (result.error) console.error(`agent-browser: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
}
