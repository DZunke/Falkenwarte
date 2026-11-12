# Open choices: name and work visualization

The current repository is a portable Pi profile. These are proposals for its next stage, **not** a rename, an installed dashboard or permission to create project directories. Falkensee and the personalities recall the user's Siebenwind roleplay history; the names below are new proposals, not claims about official game lore or ownership.

## What should we call the agent?

| Candidate | Why it fits | Tradeoff |
| --- | --- | --- |
| **Falkensee** | Direct continuity with Waldemar and House Falkensee; short and legible as a command or directory stem. | May sound like the character's home rather than the whole toolkit. |
| **Falkenwarte** | A watchpost for careful decisions and multiple specialist perspectives. | Siebenwind reference is indirect; the name may already be in use elsewhere. |
| **Windlinie** | Alludes to Siebenwind and the Ordered Line without claiming to be part of the game. | Needs a subtitle to communicate “portable Pi agent.” |
| **Falkensee-Kodex** | Emphasizes durable decisions and the Compact. | Suits an ADR archive more than an interactive agent. |

My working recommendation is **Falkenwarte** for the product and **Falkensee** for the house/persona setting, or simply **Falkensee** if one name should do both jobs. Check naming availability and rights before publishing a public package. Do not rename packages, commands, repositories or create `.<name>/` until the user chooses a product name and a stable lowercase slug.

## Better views without a second source of truth

1. **Now — live work:** use pi-subagents' existing FleetView, compact phase labels, `/subagents-fleet` inspector and `/subagent-cost`. This already shows which specialist runs, its status, recent output and cost. Avoid another persistent footer row: [`extensions/pi-footer/config.json`](../extensions/pi-footer/config.json) intentionally has one readable Powerline line.
2. **Now — durable reasoning:** put a small Mermaid context map or state transition in a project ADR when it helps explain an alternative. Pi 1.5.2 supports Markdown Mermaid rendering through `markdown.mermaid`; a plain Markdown diagram stays reviewable on GitHub and is useful without a running dashboard.
3. **After testing real assignments — optional project dossier:** propose a read-only local view combining the project's ADR index, current GitHub Issue/Project links and subagent run receipts. Keep the primary data in project Git and GitHub; no hidden editable board or browser-facing write API. Investigate authentication, stale state and accessibility before building an extension.

The [Agentheim repository](https://github.com/heimeshoff/Agentheim) illustrates a richer model: its `.agentheim/` separates `knowledge/` from `board/`, with a read-only dashboard projecting those files. That boundary is useful inspiration, but its Claude Code plugin, full task lifecycle and bridge stack should not be copied into this Pi profile. Pi already recognizes **trusted** project `.pi/` settings and `AGENTS.md`; a future branded dot directory would need an explicit loader and ownership policy. Compare existing Pi and pi-subagents surfaces first, then approve a design on an actual project need via [`docs/adr-workflow.md`](adr-workflow.md).

Sources: [Agentheim README](https://github.com/heimeshoff/Agentheim#readme), [GitHub CLI Projects manual](https://cli.github.com/manual/gh_project), and [`pi-subagents` observability guidance](https://github.com/nicobailon/pi-subagents/blob/main/docs/observability.md). The last link describes upstream behavior; verify it against the pinned version before changing integration. Review these proposals with the user before implementing a branded project directory or new TUI.
