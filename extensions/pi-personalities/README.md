# pi-personalities

`pi-personalities` selects a Markdown-defined identity for one Pi process without hardcoding their prompts into the extension. It adds the selected prompt as a structured system-prompt section on each agent run, leaving Pi's normal instructions and tools intact. Use it when you want to switch roles without installing a separate extension for every role; use Pi's ordinary `AGENTS.md` files instead for project rules that should always apply.

## Key concepts

- **Personality file:** a `.md` file with `name`, `title`, `description`, and a Markdown `prompt` in YAML frontmatter; optional `skills.allow`/`skills.deny` lists curate discovered skills per role.
- **Library:** your local `~/.pi/agent/personalities/` directory plus optional file or directory paths declared in `~/.pi/agent/personalities.json`.
- **Selection:** `personalities.json` may set `"default": "waldemar"` for every new main Pi session; subagents do not inherit it. `/personality default` opens a picker to change it; `/personality default <name>` saves it directly. `/personality use <name>` changes only the current session, while `--personality <name>` or `PI_PERSONALITY=<name>` overrides the default for a process.

## Install

Add this directory as a local Pi package:

```sh
pi install /absolute/path/to/pi-extensions/extensions/pi-personalities
```

Or try it for one process with `pi -e /absolute/path/to/pi-extensions/extensions/pi-personalities/index.ts`. Add a personality file to your library or declare a trusted external source before selecting it. Run `/reload` after changing Pi package settings; run `/personality reload` after editing personality files or sources. The extension never downloads remote content. A default is saved only when you explicitly choose one; the portable setup initially provides Waldemar as its default.

Why separate profiles from the package? A third-party repository can provide Markdown without executing its extension code. You still need to review its instructions: activating a profile grants its text system-prompt authority. `pi-personalities` reads only configured paths and local imports, not arbitrary project files automatically.

Start with [personality files, skill selection and sources](docs/format-and-sources.md), then see [commands and shell selection](docs/commands.md), including `/skills`. [Subagent integration](docs/subagents.md) covers the portable `pi-subagents` installation, Brunhilde's and Albert's fixed child roles, and per-run bindings for other personalities. The implementation lives in [`index.ts`](index.ts) and [`registry.ts`](registry.ts). Run `npm test` for registry checks and `npm run smoke` for Pi CLI/RPC checks (requires `pi` on `PATH`); tests live in [`tests/`](tests/).

If you extend this package, keep persona content outside it and keep the examples aligned with the actual file format.
