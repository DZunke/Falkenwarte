# Falkenwarte: proposed task flow

This describes the **unfinished full workflow**; [ADR 0003](../.falkenwarte/knowledge/decisions/0003-project-flow-execution-and-review-delivery.md) accepts pi-workflow as the backend, not the unfinished implementation. The [Pi Factory extension](../extensions/pi-factory-flow/README.md) provides a project flow view, optional guarded launch, verified local review packages and an explicitly confirmed PR path. The native `/workflow` board—not the Factory phase widget—shows engine activity. Automatic publication and production-ready tool isolation remain unimplemented. The chat remains the full conversation and audit trail. The second view should answer three simpler questions: what stage is this assignment in, who is doing what, and what evidence or decision is needed next? It starts only when you assign a task; merely viewing an Issue must not start an agent.

## What would you see?

A manually opened, read-only flow view in Pi could show one assignment at a time. A GitHub Issue is optional; a free-text task follows the same flow without creating one.

```text
Falkenwarte · Task #42 · implementation · running
Idea ✓ → Plan ✓ → Build ● → Review ○ → Result ○ → PR ○

Waldemar  plan accepted · implementing the scoped change
  ↳ Albert       terminology checked · 2 open questions [receipt]
  ↳ Brunhilde    architecture reviewed · 1 risk [receipt]
  ↳ Waldemar     tests running [progress]

Latest summary: The API path works; the error case still needs a test.
Next: finish the test, then request independent review.
```

A row names the **actual** agent and active personality, not just a role assumed from its label. A stage may be `pending`, `active`, `blocked`, `done`, `failed`, or `skipped` with a reason. A blocked or failed stage must not look done merely because an agent stopped. Selecting a row opens the existing pi-subagents inspector or the chat receipt; it does not create a second transcript. Waldemar writes short, attributed milestone summaries after intake, plan, implementation, review, and handoff. Live tool chatter remains in FleetView; summaries are not invented from partial tool output.

## One assignment at a time

1. **Trigger:** You explicitly start with a task description or a GitHub Issue URL. Identify the *target repository* and read its `AGENTS.md` and existing decisions. Fetch an Issue and Project read-only before proposing changes; a missing Project is normal. Confirm the intended outcome and acceptance examples. For a vague idea, stop at clarification rather than manufacturing requirements.
2. **Plan:** Waldemar records scope, acceptance checks, risks, evidence and proposed contributors in chat. Albert examines disputed domain language when useful; Brunhilde challenges consequential architecture. An ADR follows the target project's policy. Decisions requiring your approval pause here; a proposed ADR is not an approval.
3. **Implementation:** Waldemar coordinates bounded work and keeps the plan and observed work distinct. Agent receipts show handoffs and actual output; a contributor's progress report is not proof that tests passed. The operator provides the project checkout for a ticket. The factory does not create, remove or backmerge worktrees; do not launch concurrent writing tickets into one checkout.
4. **Review:** Run relevant tests and an independent review of the diff, security-sensitive changes and acceptance examples. Report failures and dissent rather than silently retrying or calling a failed run complete. Return to implementation if corrections are needed.
5. **Result:** Waldemar presents changes, verification, unresolved risks and the next action. You can continue in the same chat, amend the task, or stop here. No PR is required for a read-only investigation or a task without changes.
6. **PR, if authorized:** Prepare a substantial description with purpose, approach, linked Issue/ADR, test evidence, review notes and remaining risks. Attach only real, reviewed screenshots, GIFs or video links where useful; do not invent media. Capture UI evidence with redaction and an approved storage location. Creating a branch, committing, pushing and opening a PR require the target project's authorization; never merge by default.

A return from review to implementation is a visible loop, not a new task. A new request to change scope starts with revised acceptance checks. Manual pause, resume and stop are first-class states; a resumed run must still point to its original task and receipts.

## Where would the view get its facts?

- Pi's current chat and pi-subagents' run IDs, receipts and FleetView provide real activity and identities. An extension would consume their documented events or in-process APIs, not scrape rendered terminal text or modify subagent internals.
- Git and the target project's ADRs provide reviewed code and decisions. An Issue and optional Project provide remote work tracking, subject to [the proposed label policy](factory-github.md). None is a substitute for the others.
- A limited per-assignment record now lives in the target project's ignored `.falkenwarte/runs/<flow-id>/run.json`, alongside tracked `.falkenwarte/settings.json` (review delivery, optional launch opt-in and versioned test commands). It can reopen a **view** in a fresh Pi process; it does not resume workers. The execution engine's own session and receipts stay separate. `/factory review-draft` creates a bounded, ignored HTML/JSON/Git-diff draft. `/factory review-final` adds host-run test receipts and checks that the reviewer read the same candidate bytes. It is ready for human review, not approval. Publication requires a read-only target/branch plan and a separate explicit `--confirm`; no actual remote PR has been verified. Unattended recovery and enforced worker tool ceilings remain open in [ADR 0003](../.falkenwarte/knowledge/decisions/0003-project-flow-execution-and-review-delivery.md). If receipts are missing, display `unknown` rather than reconstructing a false history.

Start with a **read-only Pi view over a manually started, local assignment** and real pi-subagents runs. Add GitHub labels and Project synchronization only after trying one real repository and agreeing on its existing taxonomy. A browser dashboard can follow if a Pi view proves too cramped, particularly for media; the first view should not require a web server. This is a proposed sequence, not authority to implement an unreviewed TUI or to mutate GitHub.

Pi is the chosen first surface. The Issue trial exposed gaps in stop/resume, activity and PR delivery. Project-local run persistence and the validated [flat workflow prototype](../workflows/falkenwarte-flat/spec.json) are groundwork, not a working factory: the Pi-workflow backend passed isolated stop/resume and reviewer-read tests with an earlier managed-writer spec. The revised in-place spec has now completed one disposable four-stage run without creating a worktree; its local review draft matched the candidate bytes and required reviewer-read ledger. an opt-in disposable `/factory start` has launched and bound an in-place engine run and produced a local host-tested review package. This repository keeps automatic launch disabled: the writer's effective native tool list is broader than the spec's list, and no production PR or cross-host recovery has been attested. Add a clean-worktree launch gate, specialist identity mapping, attested tests and final review delivery before claiming autonomous ticket completion or automatic PR creation. See [visualization choices](future-directions.md) and [GitHub labels](factory-github.md).
