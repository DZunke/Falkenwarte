# Personality files and sources

A personality is a Markdown file whose four required values live in YAML frontmatter. `prompt: |` is a YAML block scalar containing the Markdown sent to the model; the Markdown body after the closing `---` must be empty, so instructions cannot be silently omitted.

```md
---
name: reviewer
title: Careful Reviewer
description: Reviews changes for correctness and maintainability.
prompt: |
  # Review approach

  Check the changed behavior, risks, and tests before suggesting a fix.
---
```

An optional `skills` mapping in frontmatter accepts `allow` and `deny` lists of unique skill names. `allow` limits the model prompt to those names; an empty allowlist selects none. Without `allow`, every discovered skill is considered. `deny` removes listed names after the allowlist, so deny wins. For example:

```yaml
skills:
  allow: [agent-browser, ddd-domain-discovery]
  deny: [ddd-domain-discovery]
```

The effective skill set is selected from Pi's **already discovered** skills at each agent turn; the lists do not install missing skills. `/skills` reports the available set for the active personality. Direct `/skill:name` input is rejected for an excluded name, but Pi's autocomplete and RPC `get_commands` can still show globally discovered skills because extensions cannot remove those commands. Tools can still read local files; this is prompt/command routing, **not** a security or file-access boundary. Pi's static `settings.json` skill exclusions apply before the personality selection, and any same-name discovery conflict follows Pi's usual priority. Missing allowed names are noted by `/skills`.

`name` is the command/flag identifier: at most 64 lowercase letters and digits separated by single hyphens; `off` is reserved for disabling selection. `title` and `description` are shown by `/personality list`; only `prompt` is injected into the structured `pi_personality` system-prompt section. Each file is limited to 128 KiB. Invalid files are skipped with a warning; duplicate names keep the first file and report the collision.

## Where can files come from?

`~/.pi/agent/personalities/*.md` is scanned automatically. To reference trusted files from another repository without copying them, create `~/.pi/agent/personalities.json`:

```json
{
  "sources": [
    "/absolute/path/to/role.md",
    "/absolute/path/to/third-party-personalities"
  ],
  "default": "reviewer"
}
```

The optional `default` must be the `name` of an available profile (the example assumes `role.md` defines `reviewer`). Run `/personality default` to pick from the loaded library and save the choice without hand-editing JSON. Each directory contributes its immediate `.md` files; nested directories and symlinked directory entries are not traversed. Paths may also be `~/...` or relative to the Pi agent configuration directory. Local files take precedence over configured sources, and configured sources are read in order. A missing source produces a warning; a malformed configuration leaves the local library available. You can set `PI_CODING_AGENT_DIR` to relocate Pi's agent configuration directory.

To copy a reviewed third-party file into your own library, use `/personality import /path/to/role.md`. Import never overwrites an existing name or destination. Editing a referenced source affects only future runs after `/personality reload`; editing an imported copy does not modify its original.

**Trust boundary:** these files become system instructions, not mere reference material. Review source changes before reloading; do not point `sources` at untrusted, writable project trees. No URL fetching, automatic package discovery, or remote synchronization is provided.

See [commands and shell selection](commands.md) for activation and [subagents](subagents.md) for child sessions. Keep profiles reviewable and version-controlled when possible.
