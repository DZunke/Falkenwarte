# Decisions for the portable profile

Architecture Decision Records here apply to **this repository only**. Decisions in client or product repositories belong in those repositories; the reusable procedure is in [`docs/adr-workflow.md`](../adr-workflow.md), and the portable [`adr-decision` skill](../../skills/pi-portable-skills/skills/adr-decision/) provides a starting template.

Use the next free four-digit number, a short kebab-case title, and the template's context/options/decision/consequences/verification sections. Preserve accepted records; add a new one and mark the predecessor `Superseded` when the choice changes. Consequential new choices remain `Proposed` until the decision owner approves them.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001 — Portable profile as source of truth](0001-portable-profile-as-source-of-truth.md) | Accepted | Reviewed configuration travels in this checkout; credentials and machine state do not. |
