import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeProject, planProject } from "../scripts/falkenwarte-project.mjs";

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "falkenwarte-project-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("project initialization is explicit, portable and repeatable", (t) => {
  const root = project(t);
  writeFileSync(join(root, "AGENTS.md"), "Project rules stay here\n");
  assert.equal(planProject(root).create.length, 7);
  assert.equal(initializeProject(root).create.length, 7);
  assert.equal(planProject(root).create.length, 0);
  assert.equal(initializeProject(root).create.length, 0);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "Project rules stay here\n");
  assert.match(readFileSync(join(root, ".falkenwarte/knowledge/decisions/README.md"), "utf8"), /Proposed/);
  const settings = join(root, ".falkenwarte/settings.json");
  assert.equal(JSON.parse(readFileSync(settings, "utf8")).review.delivery, "local");
  writeFileSync(settings, '{"schemaVersion":1,"review":{"delivery":"pr"}}\n');
  assert.equal(initializeProject(root).create.length, 0);
  assert.equal(JSON.parse(readFileSync(settings, "utf8")).review.delivery, "pr");
});

test("local Falkenwarte records and migration pointers have valid relative links", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const scan = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name);
    return entry.isDirectory() ? scan(filename) : entry.name.endsWith(".md") ? [filename] : [];
  });
  for (const file of [...scan(join(root, ".falkenwarte")), ...scan(join(root, "docs/adr"))]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^(https?:|mailto:)/.test(match[1])) continue;
      assert.ok(existsSync(resolve(dirname(file), decodeURIComponent(match[1]))), `${file}: missing ${match[1]}`);
    }
  }
  assert.match(readFileSync(join(root, "docs/adr/0001-portable-profile-as-source-of-truth.md"), "utf8"), /only a link/);
});

test("existing decisions, modified project files and symlinks are not overwritten", (t) => {
  const root = project(t);
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  writeFileSync(join(root, "docs/adr/0001-existing.md"), "keep");
  assert.throws(() => planProject(root), /no automatic migration/);
  rmSync(join(root, "docs"), { recursive: true });
  initializeProject(root);
  const marker = join(root, ".falkenwarte/README.md");
  writeFileSync(marker, "private project edits");
  assert.throws(() => initializeProject(root), /review instead of overwriting/);
  assert.equal(readFileSync(marker, "utf8"), "private project edits");
  rmSync(join(root, ".falkenwarte"), { recursive: true });
  const elsewhere = project(t);
  symlinkSync(elsewhere, join(root, ".falkenwarte"), "dir");
  assert.throws(() => planProject(root), /Refusing symlink/);
});
