---
name: github-issues-projects
description: Read and, when authorized, manage GitHub Issues and Projects with the gh CLI across repositories. Use to turn a scoped task into an issue, inspect a project board, link work to a decision, or report progress without silently mutating GitHub.
compatibility: Requires gh CLI and GitHub authentication for the selected host; Projects access may require the project OAuth scope.
---

# Work with GitHub Issues and Projects

The repository containing this skill is a *portable agent profile*, not the default GitHub target. Identify the actual task repository (`OWNER/REPO` and host), the Project owner and number, and the user's intended action before calling `gh`. Never infer a target from the profile checkout. Read [references/commands.md](references/commands.md) for verified commands and field-update examples.

1. Establish context: inspect the current project's Git remote and `gh repo view --json nameWithOwner,url` when appropriate. Check `gh --version` and authentication without printing tokens. Do not run `gh auth refresh` or change account scopes without the user's permission.
2. Read first: inspect existing issues, their labels/dependencies, and the selected Project's fields/items. GitHub Issues are work items; the Project is an optional view of those items. Search for possible duplicates before proposing a new issue.
3. Draft a specific outcome and acceptance examples with links to local evidence. If a consequential architectural decision is needed, use `adr-decision` first; link the resulting project ADR path in the issue and the issue URL in the ADR once available. Do not mistake an issue discussion or a Project field for an accepted ADR.
4. Show the intended target and changes before creating, editing, commenting on, closing or moving a remote item. Perform only the actions the user authorized; for ambiguous authorization, ask. Never delete issues or Project items, change access, or create a Project as a side effect of routine task work.
5. Re-read the resulting issue or Project item and report the URL, identifiers, field state and any failure or partial success. If one step fails after another succeeded, report the partial change explicitly rather than repeating a non-idempotent mutation.

Keep credentials, token scopes, customer data, machine-specific project IDs and cached API responses out of the portable profile. Project-specific identifiers belong in that project's instructions when the user chooses to store them. GitHub may be unavailable or the task may be local-only: continue with a local plan, not a fabricated remote receipt.
