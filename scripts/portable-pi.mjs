#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = ".portable-pi-state.json";
const RESERVED_SETTINGS = new Set(["packages", "lastChangelogVersion", "shellPath", "sessionDir", "httpProxy", "npmCommand", "selfUpdateCommand", "extensions", "prompts", "themes"]);
const PRIVATE_KEY = /(?:password|secret|credential|api[_-]?key|access[_-]?token|auth(?:orization)?|private[_-]?key|cookie|bearer)/i;
const PRIVATE_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|gh[opusr]_[A-Za-z0-9]{12,}|(?:api[_-]?key|password|secret|token|authorization)\s*[:=]\s*\S+)\b)/i;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected a JSON object`);
  return value;
}
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

function regularFile(filename, required = false) {
  if (!existsSync(filename)) {
    if (required) throw new Error(`Missing file: ${filename}`);
    return false;
  }
  if (!lstatSync(filename).isFile()) throw new Error(`Expected a regular file (no symlinks): ${filename}`);
  return true;
}
function loadJson(filename, fallback, required = false) {
  if (!regularFile(filename, required)) return structuredClone(fallback);
  return object(JSON.parse(readFileSync(filename, "utf8")), filename);
}
function safe(value, label, { url = false } = {}) {
  if (Array.isArray(value)) { value.forEach((item, index) => safe(item, `${label}[${index}]`, { url })); return; }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (PRIVATE_KEY.test(key)) throw new Error(`${label}.${key}: private field is not portable`);
      safe(item, `${label}.${key}`, { url });
    }
    return;
  }
  if (typeof value !== "string") return;
  if (PRIVATE_VALUE.test(value) || /^(?:~[\\/]|[a-z]:[\\/]|\\\\|\/)/i.test(value) || /[\r\n\0]/.test(value)) {
    throw new Error(`${label}: credential or machine-specific path is not portable`);
  }
  if (value.includes("://")) {
    if (!url || !/^https:\/\//.test(value)) throw new Error(`${label}: URLs require an explicit reviewed MCP entry`);
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`${label}: URL credentials, query or fragment are forbidden`);
  }
}
function inRepo(root, relative, suffix = "") {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes("\\")) {
    throw new Error(`Repository resource must be a relative path: ${relative}`);
  }
  const absolute = path.resolve(root, relative);
  const back = path.relative(root, absolute);
  if (!back || back === ".." || back.startsWith(`..${path.sep}`) || (suffix && !back.endsWith(suffix))) {
    throw new Error(`Repository resource escapes the checkout: ${relative}`);
  }
  regularFile(absolute, true);
  return absolute;
}
function localPackage(root, relative) {
  if (typeof relative !== "string" || !/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/i.test(relative)) throw new Error(`Invalid local package: ${relative}`);
  let absolute = root;
  for (const segment of relative.split("/")) {
    absolute = path.join(absolute, segment);
    if (!lstatSync(absolute).isDirectory()) throw new Error(`Expected a real package directory (no symlinks): ${absolute}`);
  }
  inRepo(root, `${relative}/package.json`, ".json");
  return absolute;
}
function remoteIdentity(source) {
  if (typeof source !== "string") return undefined;
  if (source.startsWith("git:github.com/")) return source.replace(/@[^/]*$/, "").toLowerCase();
  if (source.startsWith("npm:")) return source.replace(/@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, "").toLowerCase();
  return undefined;
}
function remoteSource(source) {
  if (typeof source !== "string" || !/^(?:git:github\.com\/[\w.-]+\/[\w.-]+@[a-f0-9]{40}|npm:(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/i.test(source)) {
    throw new Error(`Third-party package must have an exact git commit or npm version: ${String(source)}`);
  }
  return source;
}
function run(bin, argv, options = {}) {
  const child = spawnSync(process.platform === "win32" ? `${bin}.cmd` : bin, argv, {
    encoding: "utf8", timeout: 90000, shell: process.platform === "win32", ...options,
  });
  if (child.error || child.status !== 0) {
    throw new Error(`${bin} ${argv.join(" ")} failed: ${child.error?.message ?? child.stderr?.trim() ?? child.status}`);
  }
  return child.stdout;
}

export function checkRemoteUpdates(root, runner = run) {
  const { remote } = manifest(root).packages;
  return remote.map((source) => {
    const git = /^git:github\.com\/([\w.-]+)\/([\w.-]+)@([a-f0-9]{40})$/i.exec(source);
    if (git) {
      const [, owner, repo, current] = git;
      const output = runner("git", ["ls-remote", `https://github.com/${owner}/${repo}.git`, "HEAD"]);
      const candidate = /^([a-f0-9]{40})\s+HEAD\s*$/i.exec(output)?.[1];
      if (!candidate) throw new Error(`Unable to resolve ${owner}/${repo} HEAD`);
      return { name: repo, source, current, candidate, next: `git:github.com/${owner}/${repo}@${candidate}`, changed: candidate !== current };
    }
    const npm = /^npm:((?:@[\w.-]+\/)?[\w.-]+)@(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/i.exec(source);
    if (!npm) throw new Error(`Unsupported package source: ${source}`);
    const [, name, current] = npm;
    const candidate = JSON.parse(runner("npm", ["view", name, "version", "--json"]));
    if (typeof candidate !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(candidate)) {
      throw new Error(`Unable to resolve latest npm version for ${name}`);
    }
    return { name, source, current, candidate, next: `npm:${name}@${candidate}`, changed: candidate !== current };
  });
}

export function pinRemote(root, name, revision, runner = run) {
  const candidates = checkRemoteUpdates(root, runner).filter((entry) => entry.name === name || remoteIdentity(entry.source) === name);
  if (candidates.length !== 1) throw new Error(`Expected one configured remote package named ${name}`);
  const [entry] = candidates;
  if (revision !== entry.candidate) throw new Error(`Revision does not match current upstream: ${entry.candidate}`);
  if (!entry.changed) return { ...entry, written: false };
  const filename = path.join(root, "config/packages.json");
  const config = loadJson(filename, {}, true);
  config.remote = config.remote.map((item) => item === entry.source ? entry.next : item);
  atomic(filename, config);
  return { ...entry, written: true };
}

function mcpEntry(entry, label) {
  object(entry, label);
  const keys = Object.keys(entry);
  if (keys.includes("command") && keys.every((key) => ["command", "args"].includes(key)) &&
      typeof entry.command === "string" && /^[a-z0-9._-]+$/i.test(entry.command) &&
      (entry.args === undefined || (Array.isArray(entry.args) && entry.args.every((arg) => typeof arg === "string")))) {
    if (entry.args?.some((arg) => PRIVATE_KEY.test(arg) || /^(?:-H|-E|--(?:env|header|key)(?:=|$))/.test(arg))) {
      throw new Error(`${label}: credential-bearing MCP arguments cannot be captured`);
    }
    safe(entry, label);
    return;
  }
  if (keys.length === 1 && keys[0] === "url" && typeof entry.url === "string") {
    safe(entry.url, `${label}.url`, { url: true });
    return;
  }
  throw new Error(`${label}: only bare executable + args or an HTTPS URL without secrets is supported`);
}
function declaredPersonalityNames(root, sources) {
  return sources.map((source) => {
    const content = readFileSync(inRepo(root, source, ".md"), "utf8");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
    const name = frontmatter && /^name:\s*['"]?([a-z0-9]+(?:-[a-z0-9]+)*)['"]?\s*$/m.exec(frontmatter)?.[1];
    if (!name) throw new Error(`${source}: expected a frontmatter name for the default personality`);
    return name;
  });
}
function validDefault(root, config) {
  if (typeof config.default !== "string" || !declaredPersonalityNames(root, config.sources).includes(config.default)) {
    throw new Error("Default personality must be declared by a repository Markdown source");
  }
}
function validFooter(footer) {
  if (footer.preset !== "powerline" || !Array.isArray(footer.lines) || footer.lines.length !== 1 ||
      !Array.isArray(footer.lines[0]) ||
      !footer.lines[0].some((item) => item.type === "external-status" && item.options?.externalStatusKey === "pi-personalities") ||
      !footer.extensionStatusRow?.hiddenKeys?.includes("pi-personalities")) {
    throw new Error("Powerline footer must keep one line, an inline personality widget and a hidden duplicate status row");
  }
}
function manifest(root) {
  const settings = loadJson(path.join(root, "config/settings.json"), {}, true);
  for (const [key, value] of Object.entries(settings)) {
    if (RESERVED_SETTINGS.has(key) || PRIVATE_KEY.test(key)) throw new Error(`config/settings.json: ${key} is not a portable setting`);
    safe(value, `settings.${key}`);
  }
  const packages = loadJson(path.join(root, "config/packages.json"), {}, true);
  if (!Array.isArray(packages.local) || !Array.isArray(packages.remote)) throw new Error("config/packages.json: expected local and remote arrays");
  packages.local.forEach((item) => localPackage(root, item));
  packages.remote.forEach(remoteSource);
  const personalities = loadJson(path.join(root, "config/personalities.json"), {}, true);
  if (!Array.isArray(personalities.sources)) throw new Error("config/personalities.json: expected sources array");
  validDefault(root, personalities);
  const mcp = loadJson(path.join(root, "config/mcp.json"), {}, true);
  object(mcp.mcpServers, "config/mcp.json.mcpServers");
  for (const [name, entry] of Object.entries(mcp.mcpServers)) mcpEntry(entry, `mcp.${name}`);
  const footer = loadJson(path.join(root, "extensions/pi-footer/config.json"), {}, true);
  validFooter(footer);
  safe(footer, "footer");
  return { settings, packages, personalities, mcp, footer };
}

export function resourcePaths(root, agentDir, pathApi = path) {
  const relative = (filename) => pathApi.relative(agentDir, filename);
  return {
    local: ["extensions/pi-personalities", "themes/pi-atlavium", "skills/pi-portable-skills"].map((dir) => relative(pathApi.join(root, dir))),
    personality: relative(pathApi.join(root, "personalities", "waldemar.md")),
  };
}
function source(entry) { return typeof entry === "string" ? entry : entry?.source; }
function settingsPackages(root, agentDir, config) {
  return [
    ...config.local.map((dir) => path.relative(agentDir, localPackage(root, dir))),
    ...config.remote,
  ];
}
function personalitySources(root, agentDir, config) {
  return config.sources.map((filename) => path.relative(agentDir, inRepo(root, filename, ".md")));
}
function packageId(value, desired, previous) {
  if (desired.includes(value) || previous.includes(value)) return value;
  const remote = remoteIdentity(value);
  const tracked = [...desired, ...previous].find((item) => remote && remote === remoteIdentity(item));
  return tracked ?? undefined;
}
function mergeList(current, desired, previous, idOf, label, changes, conflicts, previousHashes) {
  if (!Array.isArray(current)) throw new Error(`${label}: expected an array`);
  const matched = new Set();
  const remaining = [];
  for (const item of current) {
    const id = idOf(item);
    if (!id) { remaining.push(item); continue; }
    if (matched.has(id)) throw new Error(`${label}: duplicate managed entry ${id}`);
    matched.add(id);
    const oldHash = previousHashes?.[`${label}.${id}`];
    const expected = desired.includes(id) ? id : undefined;
    // A new install may encounter an older version of the same remote package.
    if (!equal(item, expected) && (!oldHash || hash(item) !== oldHash)) conflicts.push(`${label}: locally modified ${id}`);
  }
  for (const id of previous) {
    if (!matched.has(id) && previousHashes?.[`${label}.${id}`]) conflicts.push(`${label}: locally removed ${id}`);
  }
  const result = [...remaining, ...desired];
  if (!equal(current, result)) changes.push(label);
  return result;
}

export function prepare(root, agentDir, config = manifest(root), state = loadState(root, agentDir)) {
  const changes = [], conflicts = [], hashes = {};
  const ops = [];
  function compare(key, actual, wanted, present) {
    hashes[key] = hash(wanted);
    if (equal(actual, wanted) && present) return;
    if (present && (!state.hashes?.[key] || hash(actual) !== state.hashes[key])) conflicts.push(`${key}: local value differs`);
    changes.push(key);
  }
  const settingsPath = path.join(agentDir, "settings.json");
  const currentSettings = loadJson(settingsPath, {});
  const nextSettings = { ...currentSettings };
  for (const [key, value] of Object.entries(config.settings)) {
    nextSettings[key] = value;
    compare(`settings.${key}`, currentSettings[key], value, own(currentSettings, key));
  }
  const wantedPackages = settingsPackages(root, agentDir, config.packages);
  const oldPackages = state.packages ?? [];
  const rawPackages = currentSettings.packages ?? [];
  const packageEntries = rawPackages.map(source);
  if (packageEntries.some((entry) => typeof entry !== "string")) throw new Error("settings.packages: invalid package entry");
  const currentManaged = packageEntries.filter((entry) => packageId(entry, wantedPackages, oldPackages));
  const nextPackages = mergeList(rawPackages, wantedPackages, oldPackages,
    (item) => packageId(source(item), wantedPackages, oldPackages), "settings.packages", changes, conflicts, state.hashes);
  nextSettings.packages = nextPackages;
  for (const item of wantedPackages) hashes[`settings.packages.${item}`] = hash(item);
  // Removal of a previously managed package is checked by mergeList above.
  if (!equal(currentSettings, nextSettings)) ops.push({ target: settingsPath, value: nextSettings });

  const personalitiesPath = path.join(agentDir, "personalities.json");
  const currentPersonalities = loadJson(personalitiesPath, {});
  const wantedSources = personalitySources(root, agentDir, config.personalities);
  const oldSources = state.sources ?? [];
  const nextSources = mergeList(currentPersonalities.sources ?? [], wantedSources, oldSources,
    (item) => [...wantedSources, ...oldSources].includes(item) ? item : undefined,
    "personalities.sources", changes, conflicts, state.hashes);
  const nextPersonalities = { ...currentPersonalities, sources: nextSources, default: config.personalities.default };
  compare("personalities.default", currentPersonalities.default, config.personalities.default, own(currentPersonalities, "default"));
  for (const item of wantedSources) hashes[`personalities.sources.${item}`] = hash(item);
  if (!equal(currentPersonalities, nextPersonalities)) ops.push({ target: personalitiesPath, value: nextPersonalities });

  const mcpPath = path.join(agentDir, "mcp.json");
  const currentMcp = loadJson(mcpPath, {});
  const servers = { ...object(currentMcp.mcpServers ?? {}, "mcpServers") };
  for (const [name, entry] of Object.entries(config.mcp.mcpServers)) {
    compare(`mcp.${name}`, servers[name], entry, own(servers, name));
    servers[name] = entry;
  }
  const nextMcp = { ...currentMcp, mcpServers: servers };
  if (!equal(currentMcp, nextMcp)) ops.push({ target: mcpPath, value: nextMcp });

  const footerPath = path.join(agentDir, "extensions", "pi-footer.json");
  const currentFooter = loadJson(footerPath, {});
  compare("footer", currentFooter, config.footer, regularFile(footerPath));
  if (!equal(currentFooter, config.footer)) ops.push({ target: footerPath, value: config.footer });
  return { ops, changes: [...new Set(changes)], conflicts: [...new Set(conflicts)],
    state: { root: path.resolve(root), hashes, packages: wantedPackages, sources: wantedSources },
    unmanagedPackages: packageEntries.filter((entry) => !currentManaged.includes(entry)),
  };
}
function loadState(_root, agentDir) {
  // The previous checkout location is still needed to retire its relative paths after a move.
  return loadJson(path.join(agentDir, STATE_FILE), {});
}
function atomic(target, value, mode = 0o600) {
  const parent = path.dirname(target);
  if (existsSync(parent) && !lstatSync(parent).isDirectory()) throw new Error(`Unsafe directory: ${parent}`);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  regularFile(target);
  const temp = path.join(parent, `.portable-pi-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, json(value), { flag: "wx", mode });
    chmodSync(temp, mode);
    renameSync(temp, target);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}
function saveState(root, agentDir, state) {
  atomic(path.join(agentDir, STATE_FILE), { ...state, root: path.resolve(root) });
}
export function apply(root, agentDir, { force = false } = {}) {
  const plan = prepare(root, agentDir);
  if (plan.conflicts.length && !force) throw new Error(`Local changes need review (use capture or apply --force):\n${plan.conflicts.join("\n")}`);
  if (plan.ops.length) {
    const previous = plan.ops.filter(({ target }) => regularFile(target));
    if (previous.length) {
      const backupDir = path.join(agentDir, "portable-pi-backups", new Date().toISOString().replace(/[:.]/g, "-"));
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      for (const { target } of previous) {
        const name = path.relative(agentDir, target).replace(/[\\/]/g, "__");
        writeFileSync(path.join(backupDir, name), readFileSync(target), { flag: "wx", mode: 0o600 });
      }
      plan.backupDir = backupDir;
    }
    for (const { target, value } of plan.ops) atomic(target, value);
  }
  saveState(root, agentDir, plan.state);
  return plan;
}
export function capture(root, agentDir, { dryRun = false, addSettings = [] } = {}) {
  const config = manifest(root);
  const installed = loadState(root, agentDir);
  const settings = loadJson(path.join(agentDir, "settings.json"), {}, true);
  for (const key of [...Object.keys(config.settings), ...addSettings]) {
    if (!/^[a-z][a-z0-9]*$/i.test(key) || RESERVED_SETTINGS.has(key) || PRIVATE_KEY.test(key)) throw new Error(`Unsafe setting name: ${key}`);
    if (!own(settings, key) && !installed.root && !addSettings.includes(key)) continue;
    if (!own(settings, key)) throw new Error(`Cannot capture missing setting: ${key}`);
    safe(settings[key], `settings.${key}`);
    config.settings[key] = settings[key];
  }
  const actualPackages = settings.packages ?? [];
  if (!Array.isArray(actualPackages)) throw new Error("settings.packages must be an array");
  config.packages.remote = config.packages.remote.map((expected) => {
    const found = actualPackages.map(source).filter((entry) => remoteIdentity(entry) === remoteIdentity(expected));
    if (!found.length && !installed.root) return expected;
    if (found.length !== 1) throw new Error(`Expected exactly one installed package for ${expected}`);
    remoteSource(found[0]);
    return found[0];
  });
  const personalities = loadJson(path.join(agentDir, "personalities.json"), {});
  if (personalities.sources === undefined && !installed.root) personalities.sources = [];
  if (!Array.isArray(personalities.sources)) throw new Error("personalities.sources must be an array");
  const fromRepo = personalities.sources.map((item) => path.resolve(agentDir, item)).filter((item) => {
    const relative = path.relative(root, item);
    return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`);
  }).map((item) => path.relative(root, item).split(path.sep).join("/"));
  if (!fromRepo.length && installed.root) throw new Error("No repository personality sources found in Pi settings");
  fromRepo.forEach((item) => inRepo(root, item, ".md"));
  if (fromRepo.length) config.personalities.sources = fromRepo;
  if (personalities.default === undefined && installed.root) throw new Error("Managed default personality was removed locally");
  if (personalities.default !== undefined) config.personalities.default = personalities.default;
  validDefault(root, config.personalities);
  const mcp = loadJson(path.join(agentDir, "mcp.json"), {});
  for (const name of Object.keys(config.mcp.mcpServers)) {
    const actual = mcp.mcpServers?.[name];
    if (actual === undefined && !installed.root) continue;
    mcpEntry(actual, `mcp.${name}`);
    config.mcp.mcpServers[name] = actual;
  }
  const footerPath = path.join(agentDir, "extensions", "pi-footer.json");
  if (regularFile(footerPath)) {
    const footer = loadJson(footerPath, {});
    safe(footer, "footer");
    validFooter(footer);
    config.footer = footer;
  } else if (installed.root) throw new Error("Managed footer was removed locally");
  const files = [
    ["config/settings.json", config.settings], ["config/packages.json", config.packages],
    ["config/personalities.json", config.personalities], ["config/mcp.json", config.mcp],
    ["extensions/pi-footer/config.json", config.footer],
  ];
  const changed = files.filter(([filename, value]) => !equal(loadJson(path.join(root, filename), {}, true), value)).map(([filename]) => filename);
  if (!dryRun) {
    for (const [filename, value] of files) if (changed.includes(filename)) atomic(path.join(root, filename), value);
    // Update the conflict baseline only after every portable file has been written.
    if (installed.root) saveState(root, agentDir, prepare(root, agentDir, config).state);
  }
  const managedPackages = settingsPackages(root, agentDir, config.packages);
  return { changed, ignoredPackages: actualPackages.map(source).filter((entry) => !managedPackages.includes(entry)) };
}
export function verifyInstalled(root, agentDir, runner = run) {
  for (const relative of manifest(root).packages.local) {
    const cwd = localPackage(root, relative);
    const pkg = loadJson(path.join(cwd, "package.json"), {}, true);
    if (Object.keys(pkg.dependencies ?? {}).length) {
      if (!regularFile(path.join(cwd, "package-lock.json"))) {
        throw new Error(`${relative}: runtime dependencies need a committed package-lock.json before update`);
      }
      runner("npm", ["ci", "--omit=peer", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd, stdio: "inherit" });
    }
    for (const script of ["test", "smoke"]) {
      if (pkg.scripts?.[script]) runner("npm", ["run", script], { cwd, stdio: "inherit" });
    }
  }
  const result = runner("pi", ["--offline", "--mode", "rpc", "--no-mcp", "--no-skills", "--no-session"], {
    cwd: root, input: '{"id":"commands","type":"get_commands"}\n',
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
  });
  const response = result.trim().split("\n").map((line) => JSON.parse(line)).find((item) => item.id === "commands");
  const names = response?.data?.commands?.map((item) => item.name) ?? [];
  if (!response?.success || !["personality", "skills", "footer", "subagents", "subagents-doctor"].every((name) => names.includes(name))) {
    throw new Error("Pi integration check failed: expected /personality, /skills, /footer and pi-subagents commands");
  }
  return names;
}

function main() {
  const [command = "plan", ...args] = process.argv.slice(2);
  const dirIndex = args.indexOf("--agent-dir");
  const agentDir = dirIndex < 0 ? (process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent")) : path.resolve(args[dirIndex + 1]);
  if (dirIndex >= 0) args.splice(dirIndex, 2);
  if (typeof agentDir !== "string" || !agentDir) throw new Error("Missing --agent-dir value");
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const addSettings = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--setting") addSettings.push(args[++i]);
  const used = args.filter((arg, index) => !["--force", "--dry-run", "--setting"].includes(arg) && args[index - 1] !== "--setting");
  if (command === "pin") {
    if (args.length !== 2) throw new Error("Usage: pin <package-name> <reviewed-current-upstream-revision>");
    const result = pinRemote(ROOT, args[0], args[1]);
    console.log(result.written ? `Pinned ${result.name}: ${result.source} -> ${result.next}` : `${result.name} is already pinned to ${result.candidate}`);
    if (result.written) console.log("Review config/packages.json, then run update to install and test. No Git commit was created.");
    return;
  }
  if (used.length || (force && !["apply", "update"].includes(command)) || (dryRun && command !== "capture") || (addSettings.length && command !== "capture")) {
    throw new Error(`Unknown options: ${args.join(" ")}`);
  }
  if (process.env.PI_FOOTER_CONFIG && path.resolve(process.env.PI_FOOTER_CONFIG) !== path.join(agentDir, "extensions", "pi-footer.json")) {
    throw new Error("PI_FOOTER_CONFIG points elsewhere; remove the override before syncing the default footer");
  }
  if (command === "check-updates") {
    for (const item of checkRemoteUpdates(ROOT)) console.log(`${item.name}: ${item.current} -> ${item.candidate}${item.changed ? " (new upstream revision)" : " (current)"}`);
  } else if (command === "plan") {
    const result = prepare(ROOT, agentDir);
    console.log(`Planned: ${result.changes.join(", ") || "no changes"}`);
    if (result.conflicts.length) console.log(`Conflicts (apply needs --force): ${result.conflicts.join(", ")}`);
  } else if (command === "apply" || command === "update") {
    const result = apply(ROOT, agentDir, { force });
    console.log(`Applied: ${result.changes.join(", ") || "no changes"}`);
    if (result.backupDir) console.log(`Previous files backed up to ${result.backupDir}`);
    if (command === "update") {
      // Pi update refreshes installed packages, but does not install a newly declared
      // remote that has no cache yet. Install exact pins first; pi install is idempotent.
      for (const source of manifest(ROOT).packages.remote) {
        run("pi", ["install", source], { stdio: "inherit", env: { ...process.env, PI_CODING_AGENT_DIR: agentDir } });
      }
      run("pi", ["update", "--extensions"], { stdio: "inherit", env: { ...process.env, PI_CODING_AGENT_DIR: agentDir } });
      verifyInstalled(ROOT, agentDir);
      console.log("Local package tests and Pi extension integration passed.");
    }
  } else if (command === "capture") {
    const result = capture(ROOT, agentDir, { dryRun, addSettings });
    console.log(`${dryRun ? "Would capture" : "Captured"}: ${result.changed.join(", ") || "no changes"}`);
    if (result.ignoredPackages.length) console.log(`Unmanaged packages not copied: ${result.ignoredPackages.length}`);
    if (!dryRun) console.log("Inspect the repository diff and commit manually; nothing is pushed.");
  } else throw new Error("Usage: node scripts/portable-pi.mjs [plan|apply|update|capture|check-updates|pin] [--agent-dir DIR] [--force] [--dry-run] [--setting NAME]");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`portable-pi: ${error.message}`); process.exitCode = 1; }
}
