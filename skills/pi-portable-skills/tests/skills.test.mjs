import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const domainNames = ["ddd-domain-discovery", "ddd-strategic-modeling", "domain-story-mapping"];
const names = ["agent-browser", ...domainNames, "adr-decision", "github-issues-projects", "team-issue-workshop"];

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
  assert.match(github, /Default to Pi's current Git checkout/);
  assert.match(github, /Never delete issues/);
});

test("team issue workshop delegates read-only expertise and requires approved, verified issue creation", () => {
  const workshop = readFileSync(join(root, "skills/team-issue-workshop/SKILL.md"), "utf8");
  const draft = readFileSync(join(root, "skills/team-issue-workshop/assets/issue-draft.md"), "utf8");
  const waldemar = readFileSync(join(root, "../../personalities/waldemar.md"), "utf8");
  const brunhilde = readFileSync(join(root, "../../personalities/brunhilde-nordwald.md"), "utf8");
  assert.ok(existsSync(join(root, "skills/team-issue-workshop/assets/issue-draft.md")));
  assert.match(workshop, /Albert Metzler/);
  assert.match(workshop, /Brunhilde Nordwald/);
  assert.match(workshop, /read-only, bounded/);
  assert.match(workshop, /git rev-parse --show-toplevel/);
  assert.match(workshop, /Do \*\*not\*\* ask which repository to use when a current checkout is available/);
  assert.match(workshop, /Ask which repository to use only if there is no current Git repository/);
  assert.match(workshop, /clarify that conflict before any remote write/);
  assert.match(workshop, /workflow: "parallel"/);
  assert.match(workshop, /Never issue two simultaneous foreground/);
  assert.match(workshop, /draft the Issue title and body in English by default/);
  assert.match(workshop, /exact title and full body/);
  assert.match(workshop, /do not add a repository line to the approval draft/);
  assert.match(workshop, /Open questions.*only for questions the user explicitly agrees to leave unresolved/);
  assert.match(draft, /^## Risks$/m);
  assert.match(draft, /^## Open questions \(only if the user explicitly keeps them open\)$/m);
  assert.doesNotMatch(draft, /^## Risks and open questions$/m);
  assert.match(workshop, /gh issue create --repo OWNER\/REPO/);
  assert.match(workshop, /gh issue view <exact-url>/);
  assert.match(workshop, /Do not auto-retry/);
  assert.match(waldemar, /Reply to the user in the language of their latest substantive message/);
  assert.match(waldemar, /Write work products in English by default/);
  assert.match(waldemar, /do not issue two concurrent foreground/);
  assert.match(waldemar, /^    - team-issue-workshop$/m);
  assert.match(brunhilde, /^    - team-issue-workshop$/m);
});
