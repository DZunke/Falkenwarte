# Working on this portable Pi profile

This repository is the reviewed, reusable source for a **personal Pi installation**, not a template to copy wholesale into every project. Pi and Node.js 22+ are prerequisites. The checkout path varies by machine; never hardcode this user's home directory, provider credentials, GitHub owner or project number into tracked configuration. The product name and any custom per-project dot-directory name are still undecided.

## Ownership and verification

- `config/` declares managed Pi preferences, local/remote packages, personality sources and safe MCP entries. `scripts/portable-pi.mjs` applies them without overwriting unmanaged state. Read [`docs/portable-profile.md`](docs/portable-profile.md) before changing ownership or capture behavior.
- `extensions/pi-personalities/` owns role selection and its Pi smoke tests; `personalities/` owns the actual prompts. `themes/pi-atlavium/` owns theme tests and previews; `skills/pi-portable-skills/` owns reviewed skills and the locked browser CLI. Keep packages independent and update package manifests and tests together.
- Run `node --test tests/portable-pi.test.mjs`, `npm --prefix extensions/pi-personalities test`, `npm --prefix extensions/pi-personalities run smoke`, `npm --prefix themes/pi-atlavium test`, and `npm --prefix skills/pi-portable-skills test` for affected changes. Run `node scripts/portable-pi.mjs plan` before `update`; do not run `update --force` over a conflict without explicit review. `capture --dry-run` is read-only, but a real capture requires inspecting every changed value before committing.
- Credentials, sessions, browser state, generated machine paths and other people's packages stay outside Git. Inspect `git diff --cached --check` and staged paths before each Conventional Commit (`feat(scope):`, `fix(scope):`, `docs(scope):`, `test(scope):`, `chore(scope):`). Do not commit automatically after a failed test.

## Decisions and delegated work

Use [`docs/adr-workflow.md`](docs/adr-workflow.md) when a change commits the profile or a target project to a consequential technical or domain choice. The reusable `adr-decision` skill contains a template; this repository stores its own accepted records in [`docs/adr/`](docs/adr/). A separate project's ADRs belong to *that project*, under its existing convention or `docs/adr/` after agreement. Waldemar coordinates, Albert tests domain language where useful, Brunhilde challenges architecture, and the user approves consequential decisions. Avoid ceremonial delegation and keep each child read-only unless its task explicitly grants an isolated write boundary; Waldemar owns integration and final tests.

For project work, read that project's `AGENTS.md` before acting. Pi natively uses `.pi/` for trusted project settings; a future branded dot-directory is only a **proposal** until its name, data ownership and loader are approved. Do not create one just to mimic Agentheim. GitHub Issues and Projects are optional external work tracking, not the decision archive: consult `github-issues-projects`, confirm the actual target repository, and obtain authorization before remote mutations. No GitHub authentication details belong here.

## Seeing the work

Use pi-subagents' FleetView or `/subagents-fleet` for live child activity, and the decision's compact Mermaid diagram for durable architecture when it adds clarity. The existing Powerline footer remains one line. See [`docs/future-directions.md`](docs/future-directions.md) for unapproved naming and visualization options; do not present those proposals as installed features.
