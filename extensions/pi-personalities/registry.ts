import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface SkillSelection {
  allow?: string[];
  deny?: string[];
}

export interface Personality {
  name: string;
  title: string;
  description: string;
  prompt: string;
  skills?: SkillSelection;
  path: string;
}

export type FrontmatterParser = (content: string) => {
  frontmatter: Record<string, unknown>;
  body: string;
};

export interface Registry {
  personalities: Map<string, Personality>;
  defaultName?: string;
  warnings: string[];
}

const MAX_FILE_BYTES = 128 * 1024;
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function skillSelection(value: unknown, path: string): SkillSelection | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => key !== "allow" && key !== "deny")) {
    throw new Error(`${path}: skills must be a mapping with only allow and deny lists`);
  }
  const rules = value as Record<string, unknown>;
  const result: SkillSelection = {};
  for (const key of ["allow", "deny"] as const) {
    if (!(key in rules)) continue;
    const names = rules[key];
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || name.length > 64 || !NAME_PATTERN.test(name)) ||
        new Set(names).size !== names.length) {
      throw new Error(`${path}: skills.${key} must be a list of unique skill names`);
    }
    result[key] = names;
  }
  return result;
}

export function filterSkills<T extends { name: string }>(skills: readonly T[], selection?: SkillSelection): T[] {
  const allowed = selection?.allow === undefined ? undefined : new Set(selection.allow);
  const denied = new Set(selection?.deny ?? []);
  return skills.filter((skill) => (allowed === undefined || allowed.has(skill.name)) && !denied.has(skill.name));
}

function requiredString(value: unknown, field: string, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path}: frontmatter field "${field}" must be a non-empty string`);
  }
  return value.trim();
}

export function parsePersonality(content: string, path: string, parse: FrontmatterParser): Personality {
  let parsed: ReturnType<FrontmatterParser>;
  try {
    parsed = parse(content);
  } catch (error) {
    throw new Error(`${path}: invalid YAML frontmatter: ${String(error)}`);
  }
  const { frontmatter, body } = parsed;
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new Error(`${path}: frontmatter must be a YAML mapping`);
  }
  const name = requiredString(frontmatter.name, "name", path);
  if (name === "off" || name.length > 64 || !NAME_PATTERN.test(name)) {
    throw new Error(`${path}: name must be at most 64 lowercase letters, digits and single hyphens ("off" is reserved)`);
  }
  const title = requiredString(frontmatter.title, "title", path);
  const description = requiredString(frontmatter.description, "description", path);
  const prompt = requiredString(frontmatter.prompt, "prompt", path);
  if (body.trim()) {
    throw new Error(`${path}: put all instructions in the frontmatter "prompt: |" field, not in the Markdown body`);
  }
  return { name, title, description, prompt, skills: skillSelection(frontmatter.skills, path), path };
}

function readPersonality(path: string, parse: FrontmatterParser): { personality: Personality; content: string } {
  if (statSync(path).size > MAX_FILE_BYTES) {
    throw new Error(`${path}: personality exceeds ${MAX_FILE_BYTES} bytes`);
  }
  const content = readFileSync(path, "utf8");
  return { personality: parsePersonality(content, path, parse), content };
}

function sourcePath(agentDir: string, source: string): string {
  const expanded = source === "~" ? homedir() : source.startsWith("~/") ? join(homedir(), source.slice(2)) : source;
  return isAbsolute(expanded) ? expanded : resolve(agentDir, expanded);
}

export function loadRegistry(agentDir: string, parse: FrontmatterParser): Registry {
  const personalities = new Map<string, Personality>();
  const warnings: string[] = [];
  let defaultName: string | undefined;
  const sources = [join(agentDir, "personalities")];
  const configPath = join(agentDir, "personalities.json");

  if (existsSync(configPath)) {
    try {
      const config: unknown = JSON.parse(readFileSync(configPath, "utf8"));
      if (!config || typeof config !== "object" || Array.isArray(config) || !Array.isArray((config as { sources?: unknown }).sources) ||
          !(config as { sources: unknown[] }).sources.every((item) => typeof item === "string" && item.trim())) {
        throw new Error('expected { "sources": ["path/to/file-or-directory", ...] }');
      }
      for (const source of (config as { sources: string[] }).sources) sources.push(sourcePath(agentDir, source));
      const selected = (config as { default?: unknown }).default;
      if (selected !== undefined) {
        if (typeof selected !== "string" || !NAME_PATTERN.test(selected) || selected === "off" || selected.length > 64) {
          warnings.push(`${configPath}: default must be an available personality name`);
        } else defaultName = selected;
      }
    } catch (error) {
      warnings.push(`${configPath}: ${String(error)}`);
    }
  }

  for (const source of sources) {
    if (!existsSync(source) && source === sources[0]) continue; // The local import directory is optional.
    try {
      const stat = statSync(source);
      if (!stat.isDirectory() && !(stat.isFile() && source.toLowerCase().endsWith(".md"))) {
        throw new Error("source must be a Markdown file or directory");
      }
      const files = stat.isDirectory()
        ? readdirSync(source, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
            .map((entry) => join(source, entry.name)).sort()
        : [source];
      for (const file of files) {
        try {
          const { personality } = readPersonality(file, parse);
          const previous = personalities.get(personality.name);
          if (previous) {
            warnings.push(`${file}: duplicate name "${personality.name}" (already loaded from ${previous.path})`);
          } else {
            personalities.set(personality.name, personality);
          }
        } catch (error) {
          warnings.push(String(error));
        }
      }
    } catch (error) {
      warnings.push(`${source}: ${String(error)}`);
    }
  }
  if (defaultName && !personalities.has(defaultName)) {
    warnings.push(`${configPath}: default personality "${defaultName}" is not available`);
    defaultName = undefined;
  }
  return { personalities, defaultName, warnings };
}

export function saveDefault(agentDir: string, name: string): void {
  if (!NAME_PATTERN.test(name) || name === "off" || name.length > 64) throw new Error("Choose an available personality name");
  const filename = join(agentDir, "personalities.json");
  const config = existsSync(filename) ? JSON.parse(readFileSync(filename, "utf8")) : { sources: [] };
  if (!config || typeof config !== "object" || Array.isArray(config) || !Array.isArray(config.sources) ||
      !config.sources.every((item: unknown) => typeof item === "string" && item.trim())) {
    throw new Error(`${filename}: invalid personality source configuration; nothing was saved`);
  }
  if (existsSync(filename) && !lstatSync(filename).isFile()) throw new Error(`${filename}: refusing to replace a symlink or non-file`);
  const temp = join(agentDir, `.personalities-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify({ ...config, default: name }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temp, filename);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

export function importPersonality(agentDir: string, file: string, cwd: string, parse: FrontmatterParser): Personality {
  const path = sourcePath(cwd, file);
  if (!path.toLowerCase().endsWith(".md")) throw new Error("Import a .md file");
  const { personality, content } = readPersonality(path, parse);
  const registry = loadRegistry(agentDir, parse);
  if (registry.personalities.has(personality.name)) {
    throw new Error(`Personality "${personality.name}" already exists; imports never overwrite an existing name`);
  }
  const directory = join(agentDir, "personalities");
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, `${personality.name}.md`);
  writeFileSync(destination, content, { flag: "wx", mode: 0o600 });
  return { ...personality, path: destination };
}
