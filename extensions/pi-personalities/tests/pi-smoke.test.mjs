import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const extension = resolve(dirname(fileURLToPath(import.meta.url)), "../index.ts");
const brunhildeExtension = resolve(dirname(fileURLToPath(import.meta.url)), "../brunhilde.ts");
const albertExtension = resolve(dirname(fileURLToPath(import.meta.url)), "../albert.ts");
const genericChildExtension = resolve(dirname(fileURLToPath(import.meta.url)), "../child.ts");
const brunhildeProfile = resolve(dirname(fileURLToPath(import.meta.url)), "../../../personalities/brunhilde-nordwald.md");
const albertProfile = resolve(dirname(fileURLToPath(import.meta.url)), "../../../personalities/albert-metzler.md");
const markdown = (name) => `---\nname: ${name}\ntitle: ${name} title\ndescription: ${name} description\nprompt: |\n  # ${name} instructions\n\n  Follow the task.\n---\n`;

function runPi({ flag, envName, binding, commands, probe = false, config, subagent = false, childExtension = extension, skillFixtures = false }) {
  const root = mkdtempSync(join(tmpdir(), "pi-personalities-smoke-"));
  const agentDir = join(root, "agent");
  const profiles = join(agentDir, "personalities");
  mkdirSync(profiles, { recursive: true });
  writeFileSync(join(profiles, "first.md"), markdown("first"));
  writeFileSync(join(profiles, "second.md"), markdown("second"));
  writeFileSync(join(profiles, "waldemar.md"), markdown("waldemar"));
  writeFileSync(join(profiles, "brunhilde-nordwald.md"), readFileSync(brunhildeProfile, "utf8"));
  writeFileSync(join(profiles, "albert-metzler.md"), readFileSync(albertProfile, "utf8"));
  if (skillFixtures) {
    for (const name of ["agent-browser", "ddd-domain-discovery", "ddd-strategic-modeling", "domain-story-mapping", "extra-skill"]) {
      const dir = join(agentDir, "skills", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} test skill used for personality filtering\n---\n\n# ${name}\n`);
    }
  }
  writeFileSync(join(root, "third.md"), markdown("third"));
  const configPath = join(agentDir, "personalities.json");
  if (config) writeFileSync(configPath, `${JSON.stringify(config)}\n`);
  const args = ["--offline", "--no-extensions", ...(skillFixtures ? [] : ["--no-skills"]), "--no-context-files", "--no-mcp", "-e", childExtension, "--mode", "rpc", "--no-session"];
  if (probe) {
    const probePath = join(root, "probe.ts");
    writeFileSync(probePath, `export default function (pi) {
      pi.registerProvider("personality-probe", {
        baseUrl: "http://127.0.0.1:9/v1", apiKey: "test", api: "openai-completions",
        models: [{ id: "test", name: "Test", reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 256 }]
      });
      pi.on("before_agent_start", (event, ctx) => {
        console.error("PERSONALITY_SECTION=" + JSON.stringify(event.systemPromptOptions.sections.pi_personality));
        console.error("SKILL_NAMES=" + JSON.stringify(event.systemPromptOptions.skills.map((skill) => skill.name)));
        ctx.abort();
      });
    }`);
    args.push("-e", probePath, "--model", "personality-probe/test");
  }
  if (flag) args.push("--personality", flag);
  const input = commands.map((message, index) => JSON.stringify({ id: String(index), type: "prompt", message })).join("\n") + "\n";
  const child = spawnSync(process.env.PI_BIN ?? "pi", args, {
    cwd: root,
    input,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      ...(skillFixtures ? { HOME: root, USERPROFILE: root } : {}),
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
      PI_SUBAGENT_CHILD: subagent ? "1" : "",
      ...(envName ? { PI_PERSONALITY: envName } : { PI_PERSONALITY: "" }),
      ...(binding ? { PI_SUBAGENT_EXTENSION_BINDINGS: JSON.stringify({ "pi-personalities/1": { name: binding } }) } :
        { PI_SUBAGENT_EXTENSION_BINDINGS: "" }),
    },
  });
  const savedConfig = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : undefined;
  rmSync(root, { recursive: true, force: true });
  assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);
  const records = child.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(records.filter((record) => record.type === "response" && record.command === "prompt").length, commands.length);
  return {
    messages: records.filter((record) => record.type === "extension_ui_request" && record.method === "notify").map((record) => record.message),
    stderr: child.stderr,
    skillsMessages: records.filter((record) => record.type === "message_end" && record.message?.customType === "pi-personalities-skills")
      .map((record) => record.message.content),
    savedConfig,
    records,
  };
}

test("Pi loads YAML profiles, CLI selection, switching, disabling and importing", () => {
  const { messages, records } = runPi({
    flag: "first",
    envName: "second",
    commands: ["/personality list", "/personality use second", "/personality off", "/personality import third.md", "/personality list"],
  });
  assert.ok(records.some((record) => record.method === "setStatus" && record.statusKey === "pi-personalities" && record.statusText === "First"));
  assert.ok(!messages.some((message) => message.includes("Active personality: first title")), "startup selection should not create a notification");
  assert.ok(messages.some((message) => message.includes("Active personality: second title")));
  assert.ok(messages.some((message) => message.includes("Personality disabled")));
  assert.ok(messages.some((message) => message.includes("Imported third")));
  assert.ok(messages.some((message) => message.includes("third — third title")));
});

test("a per-child binding overrides the shell environment, and 'off' overrides both", () => {
  const bound = runPi({ envName: "first", binding: "second", commands: ["/personality list"] });
  assert.ok(bound.messages.some((message) => message.includes("Personality: second")));
  const disabled = runPi({ flag: "off", envName: "first", binding: "second", commands: ["/personality list"] });
  assert.ok(disabled.messages.some((message) => message.includes("Personality: off")));
});

test("a saved default is active on fresh sessions and can be changed for future sessions", () => {
  const initial = { sources: [], default: "first" };
  const first = runPi({ config: initial, commands: ["/personality default second", "/personality list"] });
  assert.equal(first.savedConfig.default, "second");
  assert.ok(first.messages.some((message) => message.includes("Default personality for new Pi sessions: second")));
  assert.ok(first.messages.some((message) => message.includes("Personality: second (default: second)")));
  const next = runPi({ config: first.savedConfig, commands: ["/personality list"] });
  assert.ok(next.messages.some((message) => message.includes("Personality: second (default: second)")));
  assert.ok(!next.messages.some((message) => message.includes("Active personality:")));
  const env = runPi({ config: initial, envName: "second", commands: ["/personality list"] });
  assert.ok(env.messages.some((message) => message.includes("Personality: second (default: first)")));
  const disabled = runPi({ config: initial, flag: "off", commands: ["/personality list"] });
  assert.ok(disabled.messages.some((message) => message.includes("Personality: off (default: first)")));
  const invalid = runPi({ config: initial, flag: "missing", commands: ["/personality list"] });
  assert.ok(invalid.messages.some((message) => message.includes('Unknown personality "missing"')));
});

test("background children never inherit Waldemar's default or shell selection", () => {
  const config = { sources: [], default: "waldemar" };
  const child = runPi({ subagent: true, config, envName: "waldemar", commands: ["/personality list", "/personality use waldemar", "/personality default second"] });
  assert.ok(child.messages.some((message) => message.includes("Personality: off")));
  assert.ok(child.messages.some((message) => message.includes("Waldemar is the main orchestrator")));
  assert.ok(child.messages.some((message) => message.includes("Only the main Pi session")));
  assert.ok(!child.messages.some((message) => message.includes("waldemar —")));
  assert.equal(child.savedConfig.default, "waldemar");
  const bound = runPi({ subagent: true, config, envName: "waldemar", binding: "brunhilde-nordwald", commands: ["/personality list"] });
  assert.ok(bound.messages.some((message) => message.includes("Personality: brunhilde-nordwald")));
});

test("generic foreground children select a bound identity, never a saved Waldemar default", () => {
  const config = { sources: [], default: "waldemar" };
  const unbound = runPi({ childExtension: genericChildExtension, config, envName: "waldemar", commands: ["/personality list"] });
  assert.ok(unbound.messages.some((message) => message.includes("Personality: off")));
  const bound = runPi({ childExtension: genericChildExtension, config, binding: "brunhilde-nordwald", probe: true, commands: ["Check the prompt"] });
  assert.match(bound.stderr, /PERSONALITY_SECTION=.*You are Brunhilde Nordwald/);
  const forbidden = runPi({ childExtension: genericChildExtension, config, binding: "waldemar", probe: true, commands: ["Check the prompt"] });
  assert.ok(forbidden.messages.some((message) => message.includes("Waldemar is the main orchestrator")));
  assert.match(forbidden.stderr, /PERSONALITY_SECTION=undefined/);
});

test("Brunhilde's agent extension has a fixed identity, even in foreground children", () => {
  const result = runPi({
    childExtension: brunhildeExtension, envName: "waldemar", binding: "waldemar",
    config: { sources: [], default: "waldemar" },
    commands: ["/personality list", "/personality use waldemar", "/personality off", "/personality list"],
  });
  assert.ok(result.messages.some((message) => message.includes("Personality: brunhilde-nordwald")));
  assert.ok(result.messages.some((message) => message.includes("fixed for this subagent")));
  assert.ok(!result.messages.some((message) => message.includes("Personality: waldemar")));
  const prompt = runPi({ childExtension: brunhildeExtension, probe: true, commands: ["Check the prompt"] });
  assert.match(prompt.stderr, /PERSONALITY_SECTION=.*Brunhilde Nordwald/);
});

test("Albert's fixed child extension selects his identity and only his four skills", () => {
  const result = runPi({ subagent: true, childExtension: albertExtension, skillFixtures: true,
    flag: "brunhilde-nordwald", binding: "brunhilde-nordwald", probe: true,
    commands: ["/personality list", "/skills", "test model prompt"] });
  assert.ok(result.messages.some((message) => message.includes("Personality: albert-metzler")), JSON.stringify(result.messages));
  assert.match(result.stderr, /PERSONALITY_SECTION=.*Albert Metzler/);
  assert.match(result.stderr, /SKILL_NAMES=\["agent-browser","ddd-domain-discovery","ddd-strategic-modeling","domain-story-mapping"\]/);
  assert.ok(result.skillsMessages[0]?.includes("Active skills for Albert Metzler (4)"));
  assert.ok(!result.stderr.includes("# Waldemar"));
});

test("/skills lists only active discovered skills; direct excluded skill commands are blocked", () => {
  const result = runPi({ flag: "albert-metzler", childExtension: albertExtension, skillFixtures: true, probe: true,
    commands: ["/skills", "/skill:extra-skill forbidden", "/skill:ddd-domain-discovery allowed"] });
  assert.ok(result.skillsMessages[0]?.includes("Active skills for Albert Metzler (4)"), JSON.stringify(result.records));
  assert.ok(result.skillsMessages[0]?.includes("ddd-domain-discovery"));
  assert.ok(!result.skillsMessages[0]?.includes("extra-skill"));
  assert.ok(result.messages.some((message) => message.includes('Skill "extra-skill" is not active')));
  assert.match(result.stderr, /SKILL_NAMES=\["agent-browser","ddd-domain-discovery","ddd-strategic-modeling","domain-story-mapping"\]/);
  const deny = runPi({ flag: "brunhilde-nordwald", childExtension: brunhildeExtension, skillFixtures: true,
    commands: ["/skills"] });
  assert.ok(!deny.skillsMessages[0]?.includes("ddd-domain-discovery"));
  assert.ok(deny.skillsMessages[0]?.includes("extra-skill"));
  const switched = runPi({ flag: "albert-metzler", skillFixtures: true,
    commands: ["/skills", "/personality use brunhilde-nordwald", "/skills", "/personality use albert-metzler", "/skills"] });
  assert.equal(switched.skillsMessages.length, 3);
  assert.ok(switched.skillsMessages[0].includes("Active skills for Albert Metzler (4)"));
  assert.ok(switched.skillsMessages[1].includes("extra-skill") && !switched.skillsMessages[1].includes("ddd-domain-discovery"));
  assert.ok(switched.skillsMessages[2].includes("Active skills for Albert Metzler (4)"));
});

test("Pi injects the selected Markdown prompt only when active", () => {
  const selected = runPi({ flag: "first", probe: true, commands: ["Check the prompt"] });
  assert.match(selected.stderr, /PERSONALITY_SECTION=.*# first instructions/, JSON.stringify(selected.records));
  const disabled = runPi({ flag: "off", probe: true, commands: ["Check the prompt"] });
  assert.match(disabled.stderr, /PERSONALITY_SECTION=undefined/);
  const fromDefault = runPi({ config: { sources: [], default: "first" }, probe: true, commands: ["Check the prompt"] });
  assert.match(fromDefault.stderr, /PERSONALITY_SECTION=.*# first instructions/);
});
