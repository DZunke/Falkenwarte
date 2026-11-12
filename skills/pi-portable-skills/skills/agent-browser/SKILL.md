---
name: agent-browser
description: Browse the public web, inspect sources and automate browser interactions with the pinned agent-browser CLI. Use for researched facts, product documentation and interactive site exploration when web access is needed.
---

# Browser access in the portable Pi profile

The CLI is an exact npm dependency of this Pi skill package. From the directory containing this `SKILL.md`, resolve `../../scripts/browser.mjs` to an absolute path. Use `node <absolute-browser.mjs>` instead of an unpinned `npx` or a globally installed `agent-browser` command. On a fresh machine run `node scripts/portable-pi.mjs update` from the profile checkout first; install the browser runtime with `node <absolute-browser.mjs> install` when Chromium is not yet available.

**Before browsing**, read the version-matched instructions by running `node <absolute-browser.mjs> skills get core`. Obtain a worktree-scoped session name with `node <absolute-browser.mjs> session id --scope worktree --prefix task` and pass `--session <name>` to every subsequent browser command, including reads; never use another agent's default session. For specialized work use `skills get dogfood`, `skills get electron` or `skills get slack` when applicable. In examples returned by that CLI, replace a bare `agent-browser` command with the same `node <absolute-browser.mjs>` invocation.

Do not assume a web result is a domain fact: cite its URL and distinguish published claims from information confirmed by the project's domain experts. Do not log credentials or include cookies, private page content or browser session state in the portable repository. Get explicit approval before sending forms, changing account state or otherwise acting on an external site.
