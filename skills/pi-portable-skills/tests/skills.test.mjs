import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const domainNames = ["ddd-domain-discovery", "ddd-strategic-modeling", "domain-story-mapping"];
const names = ["agent-browser", ...domainNames, "adr-decision", "github-issues-projects"];

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
  const content = domainNames.map((name) => readFileSync(join(root, "skills", name, "SKILL.md"), "utf8")).join("\n");
  for (const expert of ["Eric Evans", "Vaughn Vernon", "Alberto Brandolini", "Jeff Patton"]) {
    assert.ok(content.includes(expert), `${expert} must be credited`);
  }
  assert.match(content, /unknowns|questions|assumptions|uncertainty/i);
});

test("decision and GitHub workflows link durable evidence without silently mutating remote state", () => {
  const adr = readFileSync(join(root, "skills/adr-decision/SKILL.md"), "utf8");
  const github = readFileSync(join(root, "skills/github-issues-projects/SKILL.md"), "utf8");
  assert.ok(existsSync(join(root, "skills/adr-decision/assets/adr-template.md")));
  assert.ok(existsSync(join(root, "skills/github-issues-projects/references/commands.md")));
  assert.match(adr, /until the user approves/);
  assert.match(github, /actual task repository/);
  assert.match(github, /Never delete issues/);
});
