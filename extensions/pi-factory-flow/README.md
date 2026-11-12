# Pi Factory flow

`/factory start <task or GitHub Issue URL>` records one project-local assignment in ignored `.falkenwarte/runs/<flow-id>/run.json`. The target project must have `.falkenwarte/README.md`. `/factory list`, `/factory reopen <exact-id>`, `/factory handoff [id]` and `/factory close` manage the view and its handoff; **closing does not stop a worker**. `/factory stop` refuses to pretend otherwise: for a bound pi-workflow run use `/workflow stop <exact-engine-id>` and verify its state. Reopening a flow does not resume a worker; use `/workflow resume <engine-id>` after inspecting its record.

Project `.falkenwarte/settings.json` uses schema version 1:

```json
{
  "schemaVersion": 1,
  "review": { "delivery": "local" },
  "execution": { "autoStart": false },
  "verification": { "commands": [["node", "--test", "tests/example.test.mjs"]] }
}
```

`review.delivery` is `local` by default or `pr`; it is **not** authorization to publish. `execution.autoStart` is optional and defaults to false. When explicitly enabled, `/factory start` first checks the supplied checkout is at its Git root, clean, not already occupied by another open flow or active engine run, and has a tracked in-place `workflows/falkenwarte-flat` spec, `.pi/agents/fw-implementer.md` and `.pi/agents/brunhilde-nordwald.md`. It then wakes Waldemar to scope the ticket and call guarded `factory_launch` for the exact flow. An Issue URL must be read and verified against the actual repository; a bare Issue number is not enough. The launch uses pi-workflow in the **operator-provided checkout**, not a generated worktree. No factory operation creates, removes, switches or backmerges worktrees. The backend's effective worker tools can include native Codemode/MCP beyond the spec list; its worker prompt is not a security sandbox. Keep `autoStart: false` where that ceiling is unacceptable. This repository currently does so.

`verification.commands` is an optional list of 1–12 reviewed argv arrays; commands run from the provided project root **without a shell wrapper**. It permits `node`, `npm`, `pnpm`, `python3`, `pytest`, `go`, or `cargo` as the first argument. A package script can still run arbitrary project code. The settings file must be tracked and unchanged from `HEAD` before host-run checks. Do not place secrets or credentials in arguments or output. Other projects need their own reviewed spec/agent and test settings; initialization does not silently copy them.

## Review and publication

- `/factory review-draft [project-relative-raster.png ...]` creates an ignored HTML/JSON/Git-diff draft for a bound **completed** engine run. It hashes regular changed files, snapshots untracked files and includes optional bounded raster screenshots. The candidate helper sends raster hashes—not visual content—to the reviewer, so human visual inspection remains necessary. The flat spec names Brunhilde Nordwald as its advisory architecture reviewer, and engine binding checks her project agent file. The draft labels missing reviewer evidence; a mismatched candidate digest, reviewer artifact-read ledger or file hash blocks it.
- `/factory review-final [project-relative-raster.png ...]` and Waldemar's `factory_finish` run the configured checks from the host, compare checkout bytes, Git diff, screenshots and candidate/reviewer digest before and after, and write an openable ignored `final-v<revision>/index.html` with `checks.json`. Nonzero checks or changed bytes block finalization. Logs are hashed, not copied. The result means **ready for human review**, not semantic approval or permission to publish. If a final package for that revision already exists, it is not overwritten.
- For a `pr` project, the operator can request `/factory publish-plan OWNER/REPO DEFAULT-BASE`. This is read-only: it checks the existing operator branch, GitHub origin, unchanged final package, empty index and exact changed-file inventory, then displays the target and files. Only `/factory publish OWNER/REPO DEFAULT-BASE --confirm` **in the same Pi session after that plan** authorizes staging those files, one commit, a non-force push and PR creation. It confirms the GitHub repo/default branch before mutation and verifies the resulting PR head commit. A failure after commit/push is reported as **partial**; never retry blindly. This is not invoked automatically by `review.delivery: "pr"` or by Waldemar.

The package keeps Falkenwarte flow IDs distinct from upstream `workflow_*` IDs. Native `/workflow <run-id>` is the live engine board; the `/factory` phase widget and `factory_progress` remain self-reported, not proof of tests or actual completion. All project run/review artifacts stay in ignored `.falkenwarte/`; pi-workflow keeps its separate ignored engine records under `.pi/workflows/`. Local receipts are not tamper-proof against a process with the same user permissions, cannot attribute concurrent edits or earlier commits, and do not replace human code review.
