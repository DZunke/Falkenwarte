import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { parsePersonality, loadRegistry, importPersonality, saveDefault, filterSkills } from "../registry.ts";

// The registry accepts Pi's YAML frontmatter parser as a dependency. These tests
// use a small fixture adapter; the Pi smoke check exercises the real parser.
const parse = (content) => JSON.parse(content);
const document = (name, prompt = "# Instructions\nFollow the task.") => JSON.stringify({
  frontmatter: { name, title: `${name} title`, description: `${name} description`, prompt },
  body: "",
});
const directories = [];
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), "pi-personalities-"));
  directories.push(path);
  return path;
};
after(() => directories.forEach((path) => rmSync(path, { recursive: true, force: true })));

test("requires all four frontmatter fields and a clean name", () => {
  assert.equal(parsePersonality(document("test-role"), "test.md", parse).prompt, "# Instructions\nFollow the task.");
  assert.throws(() => parsePersonality(document("../bad"), "test.md", parse), /name must be/);
  assert.throws(() => parsePersonality(document("off"), "test.md", parse), /reserved/);
  assert.throws(() => parsePersonality(JSON.stringify({ frontmatter: { name: "good" }, body: "" }), "test.md", parse), /title/);
  assert.throws(() => parsePersonality(JSON.stringify({ frontmatter: { name: "good", title: "a", description: "b", prompt: " " }, body: "" }), "test.md", parse), /prompt/);
  assert.throws(() => parsePersonality(JSON.stringify({ frontmatter: { name: "good", title: "a", description: "b", prompt: "yes" }, body: "hidden" }), "test.md", parse), /Markdown body/);
});

test("frontmatter skill allow and deny lists are validated; deny wins", () => {
  const fixture = JSON.stringify({ frontmatter: {
    name: "albert", title: "Albert", description: "Domain explorer", prompt: "Explore the domain.",
    skills: { allow: ["agent-browser", "ddd-domain-discovery"], deny: ["agent-browser"] },
  }, body: "" });
  const role = parsePersonality(fixture, "albert.md", parse);
  assert.deepEqual(filterSkills([{ name: "agent-browser" }, { name: "ddd-domain-discovery" }, { name: "other" }], role.skills), [{ name: "ddd-domain-discovery" }]);
  assert.deepEqual(filterSkills([{ name: "a" }], { allow: [] }), []);
  assert.deepEqual(filterSkills([{ name: "a" }, { name: "b" }], { deny: ["b"] }), [{ name: "a" }]);
  for (const skills of [{ allow: "abc" }, { allow: ["bad/name"] }, { deny: ["a", "a"] }, { exclude: ["a"] }, []]) {
    assert.throws(() => parsePersonality(JSON.stringify({ frontmatter: {
      name: "albert", title: "Albert", description: "Domain explorer", prompt: "Explore.", skills,
    }, body: "" }), "albert.md", parse), /skills/);
  }
});

test("loads imported profiles before declared third-party sources, without silently replacing duplicates", () => {
  const agentDir = directory();
  const local = join(agentDir, "personalities");
  const external = join(directory(), "shared");
  mkdirSync(local);
  mkdirSync(external);
  writeFileSync(join(local, "one.md"), document("one", "local"));
  writeFileSync(join(external, "one.md"), document("one", "external"));
  writeFileSync(join(external, "two.md"), document("two"));
  writeFileSync(join(external, "bad.md"), "not JSON");
  writeFileSync(join(agentDir, "personalities.json"), JSON.stringify({ sources: [external] }));
  const result = loadRegistry(agentDir, parse);
  assert.deepEqual([...result.personalities.keys()], ["one", "two"]);
  assert.equal(result.personalities.get("one").prompt, "local");
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings.join("\n"), /duplicate name/);
});

test("imports external files once and does not overwrite an existing personality", () => {
  const agentDir = directory();
  const external = directory();
  writeFileSync(join(external, "role.md"), document("role"));
  const imported = importPersonality(agentDir, "role.md", external, parse);
  assert.equal(imported.path, join(agentDir, "personalities", "role.md"));
  assert.equal(readFileSync(imported.path, "utf8"), document("role"));
  assert.throws(() => importPersonality(agentDir, "role.md", external, parse), /already exists/);
  writeFileSync(join(external, "traversal.md"), document("../bad"));
  assert.throws(() => importPersonality(agentDir, "traversal.md", external, parse), /name must be/);
});

test("the configured default must refer to an available personality", () => {
  const agentDir = directory();
  mkdirSync(join(agentDir, "personalities"));
  writeFileSync(join(agentDir, "personalities", "one.md"), document("one"));
  writeFileSync(join(agentDir, "personalities.json"), JSON.stringify({ sources: [], default: "one" }));
  assert.equal(loadRegistry(agentDir, parse).defaultName, "one");
  writeFileSync(join(agentDir, "personalities.json"), JSON.stringify({ sources: [], default: "missing" }));
  const missing = loadRegistry(agentDir, parse);
  assert.equal(missing.defaultName, undefined);
  assert.match(missing.warnings.join("\n"), /not available/);
});

test("saving a default retains sources and rejects a malformed config", () => {
  const agentDir = directory();
  const filename = join(agentDir, "personalities.json");
  writeFileSync(filename, JSON.stringify({ sources: ["relative/role.md"], custom: "keep" }));
  saveDefault(agentDir, "reviewer");
  assert.deepEqual(JSON.parse(readFileSync(filename, "utf8")), { sources: ["relative/role.md"], custom: "keep", default: "reviewer" });
  assert.throws(() => saveDefault(agentDir, "off"), /available personality/);
  writeFileSync(filename, JSON.stringify({ sources: [42] }));
  assert.throws(() => saveDefault(agentDir, "reviewer"), /nothing was saved/);
  assert.deepEqual(JSON.parse(readFileSync(filename, "utf8")), { sources: [42] });
});

test("invalid configuration warns and leaves local personalities usable", () => {
  const agentDir = directory();
  mkdirSync(join(agentDir, "personalities"));
  writeFileSync(join(agentDir, "personalities", "one.md"), document("one"));
  writeFileSync(join(agentDir, "personalities.json"), JSON.stringify({ sources: [42] }));
  const result = loadRegistry(agentDir, parse);
  assert.equal(result.personalities.size, 1);
  assert.equal(result.warnings.length, 1);
});
