# From assignment to architecture decision

This profile travels across projects, but each decision stays with the project it changes. Use this workflow after the portable Pi setup, when an assignment exposes a durable tradeoff: a domain boundary, data ownership, integration contract, dependency or long-lived operational commitment. A reversible refactor with no material alternative needs a normal commit explanation, not an ADR.

## The small decision loop

1. **Scope the assignment.** Waldemar names the target project, desired outcome, affected paths, constraints and decision question. Read that project's `AGENTS.md`, existing decisions and code first. If it uses a decision location, follow it; otherwise propose `docs/adr/` in that project. Never store another project's decisions in this profile.
2. **Gather evidence in parallel when it helps.** Ask Albert to clarify contested domain terms, scenarios, business rules and exceptions with the expert; ask one consequential question at a time. Ask Brunhilde to independently test architecture boundaries, simplest viable alternative and failure modes. Specialists report observations and unknowns under their own names; Waldemar compares their evidence and resolves disagreement or asks the user. Neither agent silently approves the decision or writes project state.
3. **Draft one record.** Use the portable `adr-decision` skill's template and the next available number (`NNNN-slug.md`); mark it `Proposed`. Record the evidence with paths or URLs, competing options, recommendation, consequences, reversibility, risks and a verification plan. A small Mermaid diagram can explain a context boundary or state transition; do not use ornament in place of a tradeoff. Cross-link an Issue only if the task actually uses GitHub.
4. **Ask for the decision.** Present the alternatives and the exact approval question. For architecture or product consequences, treat the user as the default decision owner: do not mark `Accepted` or implement that consequential choice until they approve. This is a provisional default pending the user's policy for delegated decisions. Record the approver and date when accepted; mark an unchosen proposal `Rejected` if the user asks to close it. Do not turn a specialist recommendation into an approval.
5. **Implement and verify.** Waldemar plans bounded changes, assigns disjoint work only when useful, runs tests and has a fresh review for material risks. Report results and link the accepted ADR, tests, commit SHA, and optional Issue/Project item. If evidence overturns a decision, write a superseding ADR rather than silently rewriting the earlier rationale.

For a concrete example: when two services both call a record a “customer,” Albert checks whether the business meanings and rules truly match; Brunhilde compares one model with explicit translation at the boundary; Waldemar drafts both options and their migration costs; the user chooses before implementation. No assumed customer rule is accepted just because it makes a diagram tidy.

## Status and location

- `Proposed`: tradeoff written, still awaiting a decision. Implementation of the consequential choice is paused.
- `Accepted`: selected option and human approver/date recorded; implementation may proceed.
- `Rejected`: decision owner declined the proposed choice; explain why and link any alternative.
- `Superseded`: a later ADR replaces this one; keep the old rationale and link both ways.

The owning repository's [`docs/adr/README.md`](adr/README.md) indexes its own records and the portable skill at [`skills/pi-portable-skills/skills/adr-decision/`](../skills/pi-portable-skills/skills/adr-decision/) supplies a template for other projects. The first record documents the existing portability boundary; it does **not** pre-approve a future dot-directory, dashboard or GitHub integration. If the project has no ADR practice yet, obtain agreement before creating its decision directory.

The optional [`github-issues-projects` skill](../skills/pi-portable-skills/skills/github-issues-projects/) can link execution to the decision. GitHub is the task tracker when the user opts in; the project's Markdown ADR is the authoritative explanation. Live subagent status is available in FleetView and `/subagents-fleet`, not in the ADR. Review this workflow if a real project requires a different approver or record location.
