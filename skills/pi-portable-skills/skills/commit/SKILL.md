---
name: commit
description: Review current Git changes and create one safe Conventional Commit without pushing.
compatibility: Requires Git; affected-project tests and repository instructions are followed when available.
---

# Commit reviewed work

This skill performs **one local Git commit** for the current task. Invoking `/skill:commit` authorizes that local commit, but never authorizes a push, pull request, merge, history rewrite or remote mutation. The skill must not assume that every change in the working tree belongs to the current task.

1. **Establish the checkout.** Run `git rev-parse --show-toplevel` and operate only in the current checkout. Read the applicable `AGENTS.md` files and follow their commit, test and ownership rules. Inspect the branch, `git status --short`, the unstaged path list and the staged path list. Do not create, switch, merge or remove worktrees.
2. **Determine ownership before staging.** Use the current conversation and task to identify which paths were changed for this task. Treat pre-existing, unrelated or ambiguous changes as protected. If attribution is unclear, stop and ask the user while listing the paths; do not guess. Inspect existing index changes and never unstage, reset, restore, stash or overwrite them to make the commit convenient. If a file mixes earlier and current edits and cannot be separated safely, stop and ask. Never use `git add -A`, `git add .` or `git commit -a`; stage only explicitly reviewed paths.
3. **Review the candidate diff.** Read the complete relevant diff, including any already staged content. Check for conflict markers, credentials, tokens, private data, machine-specific paths, generated artifacts and unrelated files. Run `git diff --check` and, after staging, `git diff --cached --check`. If a secret, conflict or ownership problem is suspected, stop and report it rather than committing.
4. **Validate the change.** Run the affected tests and checks required by the current project's instructions when practical. Reuse existing test results only when they clearly cover the current diff. If a required check fails, stop; do not commit a known failing change. Report checks that were not run instead of implying success.
5. **Stage and re-check.** Stage only the reviewed paths with explicit path arguments. Inspect `git diff --cached --name-status` and the complete staged diff. If the index contains any path or content outside the current task, stop rather than unstage it or commit it accidentally. A clean working tree with no eligible changes is a report, not an empty commit.
6. **Choose the message.** If the invocation supplies a valid subject, use it; otherwise infer one from the reviewed outcome. Use Conventional Commits: `<type>(<scope>): <imperative summary>` where the scope is useful, or omit it when it is not. Prefer `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`, `ci`, `perf` or `revert`; keep the subject concise and in English unless the user explicitly requests another artifact language. Do not invent an Issue, ADR or test result.
7. **Commit and verify.** Run one ordinary `git commit -m "..."`; never amend or force anything. Re-read the resulting commit hash and summary, then inspect `git status --short`. Report the exact commit, paths included, checks run and any remaining uncommitted changes. Never claim that the work was pushed, published or merged.

Example: `/skill:commit` reviews and commits the current task when its ownership is unambiguous. `/skill:commit docs(skills): clarify commit safety` supplies the subject explicitly; it does not bypass the ownership, diff or test checks.
