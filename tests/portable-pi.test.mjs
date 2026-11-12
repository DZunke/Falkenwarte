import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { apply, capture, prepare, resourcePaths, checkRemoteUpdates, pinRemote, verifyInstalled, managedPackageSources, ROOT } from "../scripts/portable-pi.mjs";
import { contrast } from "../themes/pi-atlavium/scripts/colors.mjs";

function fixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), "portable-pi-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, "arbitrary checkout", "pi-extensions");
  const agent = path.join(base, "another home", ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  for (const dirname of ["config", "personalities", "extensions/pi-footer"]) cpSync(path.join(ROOT, dirname), path.join(repo, dirname), { recursive: true });
  for (const dirname of ["extensions/pi-personalities", "extensions/pi-subscription-status", "extensions/pi-factory-flow", "themes/pi-atlavium", "skills/pi-portable-skills"]) {
    mkdirSync(path.join(repo, dirname), { recursive: true });
    cpSync(path.join(ROOT, dirname, "package.json"), path.join(repo, dirname, "package.json"));
  }
  cpSync(path.join(ROOT, "skills/pi-portable-skills/package-lock.json"), path.join(repo, "skills/pi-portable-skills/package-lock.json"));
  return { repo, agent, base };
}
function read(filename) { return JSON.parse(readFileSync(filename, "utf8")); }
function put(filename, value) { writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`); }
function ansi256(value) {
  assert.match(value, /^ansi256:\d{1,3}$/);
  let code = Number(value.slice(8));
  assert.ok(code >= 16 && code <= 255);
  if (code >= 232) return `#${(8 + (code - 232) * 10).toString(16).padStart(2, "0").repeat(3)}`;
  code -= 16;
  const channels = [Math.floor(code / 36), Math.floor(code / 6) % 6, code % 6];
  return `#${channels.map((channel) => (channel ? 55 + 40 * channel : 0).toString(16).padStart(2, "0")).join("")}`;
}

test("workflow backend is pinned only on supported host platforms", () => {
  const config = read(path.join(ROOT, "config/packages.json"));
  assert.ok(managedPackageSources(config, "linux").includes("npm:@agwab/pi-workflow@0.17.0"));
  assert.ok(managedPackageSources(config, "darwin").includes("npm:@agwab/pi-workflow@0.17.0"));
  assert.ok(!managedPackageSources(config, "win32").some((source) => source.includes("@agwab/pi-workflow")));
  assert.ok(managedPackageSources(config, "win32").includes("npm:pi-subagents@0.88.0"));
});

test("fresh install, repeatable apply, unrelated settings/packages are preserved", (t) => {
  const { repo, agent } = fixture(t);
  put(path.join(agent, "settings.json"), { quietStartup: true, packages: ["npm:unrelated@1.0.0"], localOnly: 5 });
  put(path.join(agent, "mcp.json"), { mcpServers: { local: { command: "echo" } } });
  const first = apply(repo, agent);
  assert.ok(first.changes.includes("footer"));
  assert.equal(first.conflicts.length, 0);
  assert.equal(read(path.join(agent, "settings.json")).packages.length, 1 + 5 + managedPackageSources(read(path.join(repo, "config/packages.json"))).length);
  assert.ok(read(path.join(agent, "settings.json")).packages.includes("npm:pi-subagents@0.88.0"));
  assert.equal(read(path.join(agent, "settings.json")).localOnly, 5);
  assert.equal(read(path.join(agent, "mcp.json")).mcpServers.local.command, "echo");
  assert.equal(read(path.join(agent, "personalities.json")).default, "waldemar");
  assert.equal(read(path.join(agent, "personalities.json")).sources.length, 3);
  const footer = read(path.join(agent, "extensions", "pi-footer.json"));
  assert.equal(footer.lines.length, 1);
  assert.equal(footer.lines[0].filter((widget) => widget.type === "external-status").length, 2);
  assert.equal(footer.lines[0][1].type, "thinking-level");
  assert.equal(footer.lines[0][2].options.externalStatusKey, "falkenwarte-usage");
  assert.ok(footer.extensionStatusRow.hiddenKeys.includes("falkenwarte-usage"));
  assert.equal(footer.lines[0].at(-1).options.externalStatusKey, "pi-personalities");
  assert.ok(footer.extensionStatusRow.hiddenKeys.includes("pi-personalities"));
  const widgets = footer.lines[0];
  for (const [index, widget] of widgets.entries()) {
    if (widget.type === "flex-separator") continue;
    if (widget.type === "separator") {
      assert.equal(widget.options.separator, "powerline-right-spaced");
      assert.equal(widget.options.fg, widgets[index - 1].options.bg, `${widget.id} must continue the previous block`);
      assert.equal(widget.options.bg, widgets[index + 1].options.bg, `${widget.id} must lead into the next block`);
      continue;
    }
    const ratio = contrast(ansi256(widget.options.fg), ansi256(widget.options.bg));
    assert.ok(ratio >= 4.5, `${widget.id} text contrast ${ratio.toFixed(2)}:1 is below 4.5:1`);
  }
  const again = apply(repo, agent);
  assert.equal(again.ops.length, 0);
  assert.equal(again.changes.length, 0);
});

test("the local personality package exposes Brunhilde and a generic bound child, never Waldemar", () => {
  const pkg = read(path.join(ROOT, "extensions/pi-personalities/package.json"));
  assert.deepEqual(pkg["pi-subagents"].agents, ["./agents"]);
  for (const [agent, entry] of [["brunhilde-nordwald", "brunhilde.ts"], ["albert-metzler", "albert.ts"], ["personality-delegate", "child.ts"]]) {
    const source = readFileSync(path.join(ROOT, "extensions/pi-personalities/agents", `${agent}.md`), "utf8");
    assert.match(source, new RegExp(`^name: ${agent}$`, "m"));
    assert.ok(source.includes(`extensions: ../${entry}`));
    assert.ok(source.includes("defaultContext: fresh"));
  }
  assert.ok(!existsSync(path.join(ROOT, "extensions/pi-personalities/agents/waldemar.md")));
  assert.ok(read(path.join(ROOT, "config/personalities.json")).sources.includes("personalities/brunhilde-nordwald.md"));
  assert.ok(read(path.join(ROOT, "config/personalities.json")).sources.includes("personalities/albert-metzler.md"));
});

test("managed drift stops apply, capture is explicit and updates the conflict baseline", (t) => {
  const { repo, agent } = fixture(t);
  apply(repo, agent);
  const settingsPath = path.join(agent, "settings.json");
  const settings = read(settingsPath);
  settings.editorPaddingX = 3;
  settings.unmanagedField = "stay local";
  put(settingsPath, settings);
  const mcpPath = path.join(agent, "mcp.json");
  const mcp = read(mcpPath);
  mcp.mcpServers.sentry.url = "https://mcp.sentry.dev/new";
  put(mcpPath, mcp);
  assert.ok(prepare(repo, agent).conflicts.includes("settings.editorPaddingX: local value differs"));
  assert.throws(() => apply(repo, agent), /Local changes need review/);
  assert.ok(capture(repo, agent, { dryRun: true }).changed.includes("config/settings.json"));
  assert.equal(read(path.join(repo, "config/settings.json")).editorPaddingX, 1);
  const result = capture(repo, agent);
  assert.ok(result.changed.includes("config/mcp.json"));
  assert.equal(read(path.join(repo, "config/settings.json")).editorPaddingX, 3);
  assert.equal(read(path.join(repo, "config/settings.json")).unmanagedField, undefined);
  assert.equal(read(path.join(repo, "config/mcp.json")).mcpServers.sentry.url, "https://mcp.sentry.dev/new");
  assert.equal(prepare(repo, agent).conflicts.length, 0);
});

test("reject machine paths and credentials before writing to the repository", (t) => {
  const { repo, agent } = fixture(t);
  apply(repo, agent);
  const settingsPath = path.join(agent, "settings.json");
  const settings = read(settingsPath);
  settings.shellPath = "C:\\Users\\someone\\bash.exe";
  put(settingsPath, settings);
  assert.throws(() => capture(repo, agent, { addSettings: ["shellPath"] }), /Unsafe setting name/);
  settings.apiKey = "opaque-value";
  put(settingsPath, settings);
  assert.throws(() => capture(repo, agent, { addSettings: ["apiKey"] }), /Unsafe setting name/);
  assert.equal(read(path.join(repo, "config/settings.json")).shellPath, undefined);
  const footerPath = path.join(agent, "extensions", "pi-footer.json");
  const footer = read(footerPath);
  footer.lines[0].at(-1).options.text = "sk-abc123abc123abc123abc";
  put(footerPath, footer);
  assert.throws(() => capture(repo, agent), /credential or machine-specific/);
  assert.ok(!readFileSync(path.join(repo, "extensions/pi-footer/config.json"), "utf8").includes("sk-abc123"));
  put(footerPath, read(path.join(repo, "extensions/pi-footer/config.json")));
  const mcpPath = path.join(agent, "mcp.json");
  const mcp = read(mcpPath);
  mcp.mcpServers.codegraph.args = ["serve", "--api-key", "opaque-value"];
  put(mcpPath, mcp);
  assert.throws(() => capture(repo, agent), /credential-bearing MCP arguments/);
  assert.ok(!readFileSync(path.join(repo, "config/mcp.json"), "utf8").includes("opaque-value"));
});

test("capture refuses a second footer line or a duplicate personality status row", (t) => {
  const { repo, agent } = fixture(t);
  apply(repo, agent);
  const target = path.join(agent, "extensions", "pi-footer.json");
  const footer = read(target);
  footer.lines.push([{ id: "duplicate", type: "external-status", options: { externalStatusKey: "pi-personalities" } }]);
  put(target, footer);
  assert.throws(() => capture(repo, agent), /keep one line/);
  footer.lines.pop();
  footer.extensionStatusRow.hiddenKeys = [];
  put(target, footer);
  assert.throws(() => capture(repo, agent), /hidden duplicate status row/);
});

test("a selective capture can resolve first-run conflicts without installing packages", (t) => {
  const { repo, agent } = fixture(t);
  put(path.join(agent, "settings.json"), { editorPaddingX: 3 });
  assert.ok(prepare(repo, agent).conflicts.includes("settings.editorPaddingX: local value differs"));
  const result = capture(repo, agent);
  assert.deepEqual(result.changed, ["config/settings.json"]);
  assert.equal(read(path.join(repo, "config/settings.json")).editorPaddingX, 3);
  assert.equal(apply(repo, agent).conflicts.length, 0);
});

test("a selected portable default can be captured, but a machine-local role cannot", (t) => {
  const { repo, agent } = fixture(t);
  apply(repo, agent);
  const pathToConfig = path.join(agent, "personalities.json");
  const current = read(pathToConfig);
  current.default = "local-only";
  put(pathToConfig, current);
  assert.throws(() => capture(repo, agent), /Default personality must be declared/);
  assert.equal(read(path.join(repo, "config/personalities.json")).default, "waldemar");
  writeFileSync(path.join(repo, "personalities", "reviewer.md"), "---\nname: reviewer\ntitle: Reviewer\ndescription: Review code.\nprompt: |\n  Review carefully.\n---\n");
  current.sources.push(path.relative(agent, path.join(repo, "personalities", "reviewer.md")));
  current.default = "reviewer";
  put(pathToConfig, current);
  assert.ok(capture(repo, agent).changed.includes("config/personalities.json"));
  assert.equal(read(path.join(repo, "config/personalities.json")).default, "reviewer");
  assert.equal(prepare(repo, agent).conflicts.length, 0);
});

test("new checkout path is used instead of a fixed home path; win32 relative paths work", (t) => {
  const { repo, agent, base } = fixture(t);
  apply(repo, agent);
  const packages = read(path.join(agent, "settings.json")).packages;
  assert.equal(path.resolve(agent, packages[0]), path.join(repo, "extensions/pi-personalities"));
  const windows = resourcePaths("D:\\repo\\pi-extensions", "C:\\Users\\Sire\\.pi\\agent", path.win32);
  assert.equal(path.win32.resolve("C:\\Users\\Sire\\.pi\\agent", windows.local[0]), "D:\\repo\\pi-extensions\\extensions\\pi-personalities");
  assert.equal(path.win32.resolve("C:\\Users\\Sire\\.pi\\agent", windows.personality), "D:\\repo\\pi-extensions\\personalities\\waldemar.md");
  assert.ok(existsSync(path.join(base, "another home", ".pi", "agent", ".portable-pi-state.json")));
});

test("moving the checkout retires paths from the previous location", (t) => {
  const { repo, agent, base } = fixture(t);
  apply(repo, agent);
  const relocated = path.join(base, "different checkout");
  cpSync(repo, relocated, { recursive: true });
  const moved = prepare(relocated, agent);
  assert.equal(moved.conflicts.length, 0);
  apply(relocated, agent);
  const packages = read(path.join(agent, "settings.json")).packages;
  assert.equal(packages.length, 5 + managedPackageSources(read(path.join(repo, "config/packages.json"))).length);
  assert.equal(path.resolve(agent, packages[0]), path.join(relocated, "extensions/pi-personalities"));
  assert.equal(path.resolve(agent, read(path.join(agent, "personalities.json")).sources[0]), path.join(relocated, "personalities", "waldemar.md"));
});

test("unversioned third-party package needs review rather than becoming a duplicate", (t) => {
  const { repo, agent } = fixture(t);
  put(path.join(agent, "settings.json"), { packages: ["git:github.com/wobondar/pi-footer@main"] });
  assert.ok(prepare(repo, agent).conflicts.some((value) => value.includes("settings.packages")));
});

test("upstream checks are read-only; pin needs the exact reviewed revision", (t) => {
  const { repo } = fixture(t);
  const newer = "1234567890123456789012345678901234567890";
  const runner = (bin, argv) => {
    if (bin === "npm") {
      assert.deepEqual(argv.slice(0, 1), ["view"]);
      if (argv[1] === "pi-subagents") return '"0.88.0"\n';
      assert.equal(argv[1], "@agwab/pi-workflow");
      return '"0.17.0"\n';
    }
    assert.equal(bin, "git");
    assert.deepEqual(argv, ["ls-remote", "https://github.com/wobondar/pi-footer.git", "HEAD"]);
    return `${newer}\tHEAD\n`;
  };
  const before = read(path.join(repo, "config/packages.json"));
  const [candidate] = checkRemoteUpdates(repo, runner);
  assert.equal(candidate.candidate, newer);
  assert.equal(candidate.changed, true);
  assert.deepEqual(read(path.join(repo, "config/packages.json")), before);
  assert.throws(() => pinRemote(repo, "pi-footer", "0000000000000000000000000000000000000000", runner), /does not match/);
  assert.equal(pinRemote(repo, "pi-footer", newer, runner).written, true);
  assert.ok(read(path.join(repo, "config/packages.json")).remote[0].endsWith(`@${newer}`));
  assert.equal(pinRemote(repo, "pi-footer", newer, runner).written, false);
});

test("npm revisions are checked and pinned to the exact latest version", (t) => {
  const { repo } = fixture(t);
  const pkgPath = path.join(repo, "config/packages.json");
  const pkg = read(pkgPath);
  pkg.remote.push("npm:@example/pi-tools@1.2.3");
  put(pkgPath, pkg);
  const runner = (bin, argv) => {
    if (bin === "npm") {
      if (argv[1] === "pi-subagents") return '"0.88.0"\n';
      if (argv[1] === "@agwab/pi-workflow") return '"0.17.0"\n';
      assert.deepEqual(argv, ["view", "@example/pi-tools", "version", "--json"]);
      return '"1.3.0"\n';
    }
    return "e339196b1ee0285b5dc9508a6e4d61aff5dc4fb2\tHEAD\n";
  };
  assert.equal(checkRemoteUpdates(repo, runner)[3].candidate, "1.3.0");
  assert.equal(pinRemote(repo, "@example/pi-tools", "1.3.0", runner).written, true);
  assert.ok(read(pkgPath).remote.includes("npm:@example/pi-tools@1.3.0"));
});

test("update verification runs all owned package tests after Pi installation", (t) => {
  const { repo, agent } = fixture(t);
  const called = [];
  const runner = (bin, argv, options) => {
    called.push(`${bin} ${argv.join(" ")}`);
    if (bin === "npm") assert.ok(options.cwd.startsWith(repo));
    if (bin === "pi") {
      assert.equal(options.env.PI_CODING_AGENT_DIR, agent);
      return '{"id":"commands","success":true,"data":{"commands":[{"name":"footer"},{"name":"personality"},{"name":"skills"},{"name":"falkenwarte-usage"},{"name":"factory"},{"name":"subagents"},{"name":"subagents-doctor"},{"name":"workflow"}]}}\n';
    }
    return "";
  };
  verifyInstalled(repo, agent, runner);
  assert.deepEqual(called, ["npm run test", "npm run smoke", "npm run test", "npm run smoke", "npm run test", "npm run smoke", "npm run test", "npm ci --omit=peer --ignore-scripts --no-audit --no-fund", "npm run test", "npm run smoke", "pi --offline --mode rpc --no-mcp --no-skills --no-session"]);
  assert.throws(() => verifyInstalled(repo, agent, (bin) => bin === "pi" ? '{"id":"commands","success":true,"data":{"commands":[]}}\n' : ""), /integration check failed/);
});

test("owned runtime dependencies require a lock and install before their tests", (t) => {
  const { repo, agent } = fixture(t);
  const pkgFile = path.join(repo, "extensions/pi-personalities/package.json");
  const pkg = read(pkgFile);
  pkg.dependencies = { chalk: "6.0.0" };
  put(pkgFile, pkg);
  assert.throws(() => verifyInstalled(repo, agent, () => ""), /committed package-lock.json/);
  put(path.join(repo, "extensions/pi-personalities/package-lock.json"), { lockfileVersion: 3 });
  const calls = [];
  verifyInstalled(repo, agent, (bin, argv) => {
    calls.push([bin, ...argv].join(" "));
    return bin === "pi" ? '{"id":"commands","success":true,"data":{"commands":[{"name":"footer"},{"name":"personality"},{"name":"skills"},{"name":"falkenwarte-usage"},{"name":"factory"},{"name":"subagents"},{"name":"subagents-doctor"},{"name":"workflow"}]}}\n' : "";
  });
  assert.equal(calls[0], "npm ci --omit=peer --ignore-scripts --no-audit --no-fund");
  assert.equal(calls[1], "npm run test");
});

test("package version changes are pinned and merge without deleting unrelated packages", (t) => {
  const { repo, agent } = fixture(t);
  apply(repo, agent);
  const remote = "git:github.com/wobondar/pi-footer@1234567890123456789012345678901234567890";
  const manifest = read(path.join(repo, "config/packages.json"));
  manifest.remote = [remote];
  manifest.platforms = {};
  put(path.join(repo, "config/packages.json"), manifest);
  const next = apply(repo, agent);
  assert.ok(next.changes.includes("settings.packages"));
  assert.ok(read(path.join(agent, "settings.json")).packages.includes(remote));
});
