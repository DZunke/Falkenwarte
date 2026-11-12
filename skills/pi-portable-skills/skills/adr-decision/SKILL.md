---
name: adr-decision
description: Coordinate a bounded architecture decision with evidence, specialist reviews and user approval, then record an ADR in the current project. Use when an implementation commits to a consequential technical or domain boundary.
---

# Coordinate a decision

This skill is reusable across projects; the ADR belongs to the **current project**, not to this portable profile. Follow the project's `AGENTS.md` and existing decision directory if one exists; otherwise propose `docs/adr/`. Use [assets/adr-template.md](assets/adr-template.md) as a starting point, not an authority to overwrite a project's format.

1. State the decision in one sentence, the scope, constraints, known evidence, and what can wait. If no consequential choice exists, skip the ADR and explain why. Reuse or supersede an existing relevant ADR rather than duplicating it.
2. Ask Albert Metzler to investigate contested domain language, business invariants, examples and exceptions **when relevant**. Ask Brunhilde Nordwald to challenge boundaries, alternatives and architectural consequences. Give each a bounded read-only brief with source paths; Waldemar owns synthesis and must distinguish observations from proposals. Do not summon specialists for ceremonial approval.
3. Draft `Proposed` with context and provenance, at least two real options (including the least complex viable one), a recommendation, consequences, risks, reversibility, and a concrete verification plan. A small Mermaid diagram is optional when it clarifies a boundary. Link any related GitHub Issue without making GitHub the ADR store.
4. Present the tradeoff and unresolved question to the user. For decisions with product or architecture impact, do not mark `Accepted` or implement the consequential change until the user approves the option. A team's existing delegation policy can define a narrower autonomous class; do not assume one. Record the actual decision, date and approver; use `Rejected` or `Superseded` when appropriate.
5. After implementation, verify the acceptance examples and link tests, commits and Issue/Project items. If evidence changes the decision, propose an amendment or superseding ADR; do not silently rewrite the rationale of an accepted record.

Never copy another project's domain rules or ADR approvals into this one. See the portable profile's `docs/adr-workflow.md` for the owning repository's policy and example; adapt its mechanics to the current project's instructions.
