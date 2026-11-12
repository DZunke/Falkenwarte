# Falkenwarte decisions

These ADRs apply to **this repository only**. Use the next free four-digit number and the [`adr-decision` skill](../../../skills/pi-portable-skills/skills/adr-decision/SKILL.md) for the context, alternatives, tradeoffs, approval and verification. Architecture or product-impacting proposals remain `Proposed` until the user chooses. Preserve accepted records and link a superseding ADR instead of rewriting history.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001 — Portable profile as source of truth](0001-portable-profile-as-source-of-truth.md) | Accepted | Reviewed configuration travels in this checkout; credentials and machine state do not. |
| [0002 — Project-owned Falkenwarte knowledge](0002-project-owned-knowledge.md) | Accepted | New Falkenwarte projects keep decisions and domain notes locally, without an executable loader. |
| [0003 — Project flow execution and review delivery](0003-project-flow-execution-and-review-delivery.md) | Accepted | Adopt pi-workflow as the backend for a project-owned, semi-automatic factory; verify compatibility and recovery before live use. |

The previous `docs/adr/` path is a compatibility pointer, not a second decision archive. A target project with an existing ADR convention keeps its own location unless its maintainer explicitly approves migration.
