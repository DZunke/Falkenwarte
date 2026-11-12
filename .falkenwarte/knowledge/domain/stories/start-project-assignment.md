# Start a project assignment

- Status: Draft — workflow story, not a customer's business rule
- Scope: Falkenwarte operating across a separate project repository
- Sources: [`docs/adr-workflow.md`](../../../../docs/adr-workflow.md), [`AGENTS.md`](../../../../AGENTS.md), [`extensions/pi-personalities/docs/subagents.md`](../../../../extensions/pi-personalities/docs/subagents.md)

## Actor, trigger and outcome

The user asks Waldemar to work on a named project. The intended outcome is a tested change and a clear handoff; the project's own rules and decisions remain with that project. This story captures the agreed agent workflow, not a claim that every assignment requires an ADR.

## Actions and events

1. Waldemar identifies the project root, checks its `AGENTS.md`, existing decisions, domain language and the requested outcome.
2. If a business rule is unclear, Albert asks a focused question and cites the answer or records the blocker. Brunhilde tests architecture consequences when the choice warrants it.
3. For a consequential decision, Waldemar drafts a project ADR, presents alternatives and waits for the user's approval under the current default policy.
4. Waldemar implements only the approved scope, tests it, reviews material risks and reports evidence. Optional GitHub work items link to, but never replace, the local decision.

## Exceptions and rules

No expert answer means no invented domain invariant. A project with an established ADR archive keeps it unless the maintainer explicitly opts into a migration. A small reversible change can proceed without an ADR. External GitHub writes require authorization.

## Open question

Which classes of decisions may Waldemar approve autonomously, if any? Until specified, architecture- and product-impacting choices return to the user.
