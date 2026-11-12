import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const names = ["agent-browser", "ddd-domain-discovery", "ddd-strategic-modeling", "domain-story-mapping"];

test("portable skill package pins its browser CLI and exposes discoverable skill directories", () => {
  assert.deepEqual(pkg.pi.skills, ["./skills"]);
  assert.equal(pkg.dependencies["agent-browser"], "0.42.0");
  assert.equal(lock.packages["node_modules/agent-browser"].version, "0.42.0");
  assert.ok(existsSync(join(root, "scripts", "browser.mjs")));
  for (const name of names) {
    const source = readFileSync(join(root, "skills", name, "SKILL.md"), "utf8");
    assert.match(source, new RegExp(`^name: ${name}$`, "m"));
    assert.match(source, /^description: .{40,}$/m);
    assert.ok(source.startsWith("---\n") && source.includes("\n---\n\n# "));
  }
});

test("the modeling skills credit their sources and distinguish facts from assumptions", () => {
  const content = names.slice(1).map((name) => readFileSync(join(root, "skills", name, "SKILL.md"), "utf8")).join("\n");
  for (const expert of ["Eric Evans", "Vaughn Vernon", "Alberto Brandolini", "Jeff Patton"]) {
    assert.ok(content.includes(expert), `${expert} must be credited`);
  }
  assert.match(content, /unknowns|questions|assumptions|uncertainty/i);
});
