# Subagents and personalities

The portable setup pins `pi-subagents` 0.88.0 and publishes three child definitions from this package: `brunhilde-nordwald`, `albert-metzler` and `personality-delegate`. Waldemar stays in the parent Pi session. They work in native local foreground and background children; external CLI runners do not load Pi personality extensions.

## Run Brunhilde

After `node scripts/portable-pi.mjs update`, restart Pi or run `/reload`. Check `/subagents-doctor`: discovery should show three package agents from `pi-personalities`. For a visible answer, ask Waldemar in the Pi chat:

```text
Waldemar, beauftrage Brunhilde Nordwald direkt als Subagent (agent: brunhilde-nordwald, async: false, context: fresh). Sie soll die Architektur der genannten Dateien auf unnötige Patterns und Schichtverletzungen prüfen. Gib mir danach ihre Antwort unter ihrem Namen und deine eigene knappe Einordnung. Kein Workflow.
```

Do not use `/run` when you expect the child's answer to appear directly in chat. Upstream `/run` wraps the child in a workflow; the compact TUI displays its completion status but not the child's full answer. If you have already used `/run`, ask Waldemar to quote Brunhilde's result from that run. The result is retained in the session even though the workflow card hides it; `/subagents-fleet` can also inspect a child's transcript.

[`agents/brunhilde-nordwald.md`](../agents/brunhilde-nordwald.md) sets a read-only tool list, `context: fresh` as its default, and loads [`brunhilde.ts`](../brunhilde.ts) as the child's *only* normal extension. That entry point selects [`personalities/brunhilde-nordwald.md`](../../../personalities/brunhilde-nordwald.md) even in a foreground child, where ambient parent extensions do not load. The profile introduces her as Feldwebel under Waldemar. The agent definition sets task, tools, and project context; it does not duplicate her personality. Give her file paths or an excerpt to examine: the read-only role cannot search the whole repository with shell commands.

## Ask Albert about a domain

[`agents/albert-metzler.md`](../agents/albert-metzler.md) loads a separate, fixed [`albert.ts`](../albert.ts), requests fresh context, and selects the four skills from [`skills/pi-portable-skills/`](../../../skills/pi-portable-skills/). The agent has `read` and `bash` for inspecting a repository and using the pinned browser CLI; it is **not** a read-only tool sandbox. Its instructions prohibit edits and external submissions, but use a protected environment for untrusted tasks. Ask Waldemar to call `subagent` directly with `agent: "albert-metzler"`, `context: "fresh"`, a bounded domain question and `async: false` if you need the answer returned in chat. Albert will identify gaps, ask one consequential question at a time through Waldemar and distinguish expert evidence from web research. Brunhilde can request his input through Waldemar rather than inventing business rules. A separate browser download may be necessary on a new machine; see [the skill package](../../../skills/pi-portable-skills/README.md).

## Ask both specialists in parallel

When Albert and Brunhilde can examine the same brief independently, use **one** `subagent` call with a parallel workflow, not two simultaneous foreground tool calls. Each task gets a distinct read-only assignment; Waldemar reconciles their findings after both finish. The tool's rejection message about "one subagent call per turn" refers to overlapping foreground dispatches, not a limit of one child.

```js
subagent({
  workflow: "parallel",
  args: { tasks: [
    { agent: "albert-metzler", task: "Check the domain terms and user journeys in the provided brief. Read only; report open questions." },
    { agent: "brunhilde-nordwald", task: "Check the architecture and failure modes in the same brief. Read only; report risks." }
  ] }
})
```

Give each child the actual project path, relevant files and brief rather than the placeholder tasks above. When Brunhilde's review must build on Albert's output, use a single scripted sequential workflow instead. Do not switch to a different runner just to bypass a launch rejection; first inspect the run state.

## Select a personality for a one-off child

Use `personality-delegate` for another loaded identity. Waldemar can call pi-subagents with a per-run binding (the actual tool input, not a Pi slash command):

```js
subagent({
  agent: "personality-delegate",
  task: "Prüfe die bezeichneten Dateien auf Architekturprobleme. Nicht bearbeiten.",
  async: false,
  options: {
    context: "fresh",
    extensionBindings: { "pi-personalities/1": { name: "brunhilde-nordwald" } }
  }
})
```

The package agent loads [`child.ts`](../child.ts) explicitly, so bindings work with foreground **and** background native children in pi-subagents 0.88.0. Without a binding it has no personality. Add a reviewed Markdown file to `config/personalities.json` before binding another name; the child reads the same configured sources as the parent. A bound child is instructed to identify itself by the selected title in its handoff to Waldemar. When using a different pi-subagents agent in the background, a binding works only if that agent actually loads `pi-personalities`; its `extensions: []` or another allowlist may prevent this. Use `personality-delegate` for a reliable explicit path.

The child's saved default, `PI_PERSONALITY` and the parent's `/personality use` choice do not leak into these roles. Waldemar is omitted from child listings and rejected if selected through a binding or flag; child sessions cannot change the saved default or import a global profile. Brunhilde's and Albert's fixed roles also reject switching or disabling their identities. `context: fork` **does inherit the parent's transcript and system prompt**, including Waldemar's text, regardless of the child's profile. Use fresh context for distinct identities; `defaultContext: fresh` is only a default and does not block an explicit fork. A personality is instruction text, not a tool-permission or security boundary. Local package paths are resolved from this checkout; run `update` again after moving it, and do not expect a remote or external CLI runner to see these files without an equivalent installation there.

For upstream runner options see [pi-subagents' agent definitions](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md), [tool reference](https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md), and [configuration](https://github.com/nicobailon/pi-subagents/blob/main/docs/configuration.md). This package's selection rules live in [`index.ts`](../index.ts); use `npm run smoke` to check child selection without calling a model.
