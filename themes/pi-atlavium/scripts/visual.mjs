import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { generatePreviews } from "./preview.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const update = process.argv.includes("--update");
const generated = join(root, "previews/generated");
const current = join(root, "previews/current");
const baseline = join(root, "previews/baselines");
const session = `pi-atlavium-visual-${process.pid}`;

function browser(...args) {
  const run = spawnSync(process.env.AGENT_BROWSER_BIN ?? "agent-browser", ["--session", session, ...args], {
    encoding: "utf8", timeout: 45000,
  });
  if (run.error || run.status !== 0) {
    throw new Error(`agent-browser ${args.join(" ")} failed: ${run.error ?? run.stderr ?? run.stdout}`);
  }
}

await generatePreviews(generated);
mkdirSync(current, { recursive: true });
if (update) mkdirSync(baseline, { recursive: true });

const files = [];
try {
  for (const name of ["atlavium-light", "atlavium"]) {
    for (const surface of ["terminal", "export"]) {
      const filename = `${name}-${surface}.png`;
      const page = join(generated, `${name}-${surface}.html`);
      const screenshot = join(current, filename);
      browser("open", pathToFileURL(page).href);
      browser("set", "viewport", "1280", "900", "1");
      browser("wait", "--text", "Atlavium review");
      browser("screenshot", ...(surface === "export" ? ["--full"] : []), screenshot);
      files.push(filename);
    }
  }
} finally {
  try { browser("close"); } catch { /* Keep the original failure. */ }
}

const mismatches = [];
for (const filename of files) {
  const screenshot = join(current, filename);
  const expected = join(baseline, filename);
  if (update) copyFileSync(screenshot, expected);
  else if (!existsSync(expected) || !readFileSync(screenshot).equals(readFileSync(expected))) mismatches.push(filename);
}
if (mismatches.length) {
  throw new Error(`Visual snapshots changed: ${mismatches.join(", ")}. Compare previews/current with previews/baselines; run npm run visual:update only after reviewing the images.`);
}
console.log(`${update ? "Updated" : "Matched"} ${files.length} terminal/HTML-export screenshots at 1280×900.`);
