import { parseFrontmatter, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { filterSkills, importPersonality, loadRegistry, saveDefault, type Registry } from "./registry.ts";

const SECTION = "pi_personality";
const BINDING = "pi-personalities/1";

function childSelection(): string | undefined {
  // pi-subagents binds this environment value during native child startup.
  const raw = process.env.PI_SUBAGENT_EXTENSION_BINDINGS;
  if (!raw) return undefined;
  try {
    const bindings = JSON.parse(raw) as Record<string, { name?: unknown }>;
    const name = bindings?.[BINDING]?.name;
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

// pi-subagents sets PI_SUBAGENT_CHILD; pi-workflow sets PI_WORKFLOW_ROLE=worker.
// An explicit child entry point marks foreground children even without a binding.
export function createPersonalitiesExtension(childName?: string, childOnly = childName !== undefined) {
  return (pi: ExtensionAPI) => personalitiesExtension(pi, childName, childOnly);
}

function personalitiesExtension(pi: ExtensionAPI, childName?: string, childOnly = childName !== undefined) {
  // Foreground pi-subagents restores process.env after child creation. Retain the child
  // classification for the child extension instance through subsequent commands.
  let childSession = childOnly;
  const isChild = () => childSession;
  const availableNames = () => [...registry.personalities.keys()].filter((name) => !isChild() || name !== "waldemar");
  let registry: Registry = { personalities: new Map(), warnings: [] };
  let activeName: string | undefined;

  pi.registerFlag("personality", {
    description: "Select a personality for this Pi process (or 'off')",
    type: "string",
  });

  function status(ctx: ExtensionContext): void {
    const label = activeName?.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
    if (ctx.hasUI) ctx.ui.setStatus("pi-personalities", label);
  }

  function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
    if (ctx.hasUI) ctx.ui.notify(message, level);
    else if (level !== "info") console.error(`pi-personalities: ${message}`);
  }

  function refresh(ctx: ExtensionContext): void {
    registry = loadRegistry(getAgentDir(), parseFrontmatter);
    if (childName && !registry.personalities.has(childName)) {
      throw new Error(`Subagent personality "${childName}" is unavailable; check personalities.json sources.`);
    }
    if (activeName && !registry.personalities.has(activeName)) activeName = undefined;
    for (const warning of registry.warnings) notify(ctx, warning, "warning");
    status(ctx);
  }

  function select(name: string, ctx: ExtensionContext, { silent = false } = {}): void {
    if (isChild() && name === "waldemar") {
      notify(ctx, "Waldemar is the main orchestrator, not a subagent personality.", "error");
      return;
    }
    if (childName && name !== childName) {
      notify(ctx, `${childName} is fixed for this subagent; personality switching is disabled.`, "error");
      return;
    }
    if (name === "off") {
      activeName = undefined;
      status(ctx);
      if (!silent) notify(ctx, "Personality disabled for this Pi session.");
      return;
    }
    const personality = registry.personalities.get(name);
    if (!personality) {
      notify(ctx, `Unknown personality "${name}". Run /personality list to see available names.`, "error");
      return;
    }
    activeName = name;
    status(ctx);
    if (!silent) notify(ctx, `Active personality: ${personality.title} (${name}).`);
  }

  function list(ctx: ExtensionContext): void {
    const lines = [...registry.personalities.values()].filter((personality) => !isChild() || personality.name !== "waldemar").map((personality) =>
      `${personality.name}${personality.name === activeName ? " (active)" : ""} — ${personality.title}: ${personality.description}`,
    );
    notify(ctx, `Personality: ${activeName ?? "off"} (default: ${isChild() ? "none" : registry.defaultName ?? "none"})\n${lines.join("\n") || "No personalities found."}`);
  }

  pi.registerCommand("personality", {
    description: "List, select, set a default, import or reload Markdown personalities",
    getArgumentCompletions: (prefix) => {
      const names = availableNames();
      const choices = prefix.startsWith("use ") ? names.map((name) => `use ${name}`) :
        prefix.startsWith("default ") ? names.map((name) => `default ${name}`) :
        ["list", "use", "default", "off", "import", "reload", ...names];
      const matches = choices.filter((choice) => choice.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const input = args.trim();
      if (!input || input === "list") return list(ctx);
      if (input === "off") return select("off", ctx);
      if (input === "default" || input.startsWith("default ")) {
        if (isChild()) return notify(ctx, "Only the main Pi session may change the default personality.", "error");
        let name = input.slice("default".length).trim();
        if (!name) {
          if (!ctx.hasUI) return notify(ctx, "Usage: /personality default <name>", "warning");
          const available = [...registry.personalities.values()];
          if (!available.length) return notify(ctx, "No personalities available to select.", "warning");
          const labels = available.map((personality) => `${personality.title} (${personality.name})`);
          const choice = await ctx.ui.select("Default personality for new Pi sessions", labels);
          if (!choice) return;
          name = available[labels.indexOf(choice)]?.name ?? "";
        }
        if (!registry.personalities.has(name)) return notify(ctx, `Unknown personality "${name}". Run /personality list to see available names.`, "error");
        try {
          saveDefault(getAgentDir(), name);
          refresh(ctx);
          select(name, ctx, { silent: true });
          notify(ctx, `Default personality for new Pi sessions: ${name}.`);
        } catch (error) {
          notify(ctx, `Could not save default personality: ${String(error)}`, "error");
        }
        return;
      }
      if (input === "reload") {
        refresh(ctx);
        return list(ctx);
      }
      if (input.startsWith("import ")) {
        if (isChild()) return notify(ctx, "Only the main Pi session may import personalities.", "error");
        try {
          const imported = importPersonality(getAgentDir(), input.slice(7).trim(), ctx.cwd, parseFrontmatter);
          refresh(ctx);
          notify(ctx, `Imported ${imported.name} to ${imported.path}. Use /personality use ${imported.name} to activate it.`);
        } catch (error) {
          notify(ctx, `Import failed: ${String(error)}`, "error");
        }
        return;
      }
      if (input === "use") {
        notify(ctx, "Usage: /personality use <name>", "warning");
        return;
      }
      select(input.startsWith("use ") ? input.slice(4).trim() : input, ctx);
    },
  });

  pi.registerCommand("skills", {
    description: "List the skills active for the current personality",
    handler: (_args, ctx) => {
      const personality = activeName && registry.personalities.get(activeName);
      const discovered = ctx.getSystemPromptOptions().skills ?? [];
      const active = filterSkills(discovered, personality?.skills).filter((skill) => !skill.disableModelInvocation);
      const missing = personality?.skills?.allow?.filter((name) => !discovered.some((skill) => skill.name === name)) ?? [];
      const entries = active.map((skill) => `- ${skill.name}`);
      const note = missing.length ? `\nUnavailable on this machine: ${missing.join(", ")}` : "";
      pi.sendMessage({
        customType: "pi-personalities-skills",
        content: `Active skills for ${personality?.title ?? "this session"} (${active.length}):\n${entries.join("\n") || "(none)"}${note}`,
        display: true,
      });
    },
  });

  pi.on("input", (event, ctx) => {
    const name = /^\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s|$)/.exec(event.text)?.[1];
    const personality = activeName && registry.personalities.get(activeName);
    if (name && personality?.skills && !filterSkills([{ name }], personality.skills).length) {
      notify(ctx, `Skill "${name}" is not active for ${personality.title}. Use /skills to see the active set.`, "warning");
      return { action: "handled" };
    }
    return { action: "continue" };
  });

  pi.on("session_start", (_event, ctx) => {
    childSession = childOnly || process.env.PI_SUBAGENT_CHILD === "1" ||
      process.env.PI_WORKFLOW_ROLE === "worker" || Boolean(process.env.PI_SUBAGENT_EXTENSION_BINDINGS);
    activeName = undefined;
    refresh(ctx);
    const flag = pi.getFlag("personality");
    const selected = childName ?? (typeof flag === "string" && flag ? flag :
      childSelection() ?? (isChild() ? undefined : (process.env.PI_PERSONALITY || undefined) ?? registry.defaultName));
    if (selected) select(selected, ctx, { silent: true });
  });

  pi.on("before_agent_start", (event) => {
    const personality = activeName && registry.personalities.get(activeName);
    event.systemPromptOptions.skills = filterSkills(event.systemPromptOptions.skills, personality?.skills);
    if (personality) event.systemPromptOptions.sections[SECTION] = isChild()
      ? `You are ${personality.title} (${personality.name}). Identify yourself by this name in your handoff to Waldemar, the main orchestrator. You are not Waldemar.\n\n${personality.prompt}`
      : personality.prompt;
    else delete event.systemPromptOptions.sections[SECTION];
  });
}

export default personalitiesExtension;
