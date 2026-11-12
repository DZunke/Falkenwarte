# Portable agent and project knowledge

- Status: Draft — a model of this tooling, not of a customer's domain
- Scope: installing Falkenwarte and carrying decisions into separate projects
- Sources: [`config/packages.json`](../../../../config/packages.json), [`config/personalities.json`](../../../../config/personalities.json), [`docs/portable-profile.md`](../../../../docs/portable-profile.md), [`docs/adr-workflow.md`](../../../../docs/adr-workflow.md), [`start-project-assignment.md`](../stories/start-project-assignment.md)

## Glossary

| Term | Meaning in this scope | Evidence |
| --- | --- | --- |
| Portable profile | Reviewed Pi settings, packages and skills applied from this checkout on different machines. | `scripts/portable-pi.mjs`, `docs/portable-profile.md` |
| Project knowledge | Git-reviewed ADRs and evidence-backed domain notes owned by one target repository. | `.falkenwarte/knowledge/`, ADR 0002 |
| Personality | Selected instructions and skill routing for a Pi session, not an authorization boundary. | `extensions/pi-personalities/` |
| Specialist | A named child who reports bounded findings to Waldemar; the user retains consequential approval. | `extensions/pi-personalities/agents/`, `docs/adr-workflow.md` |

## Scenarios and rules

The [assignment story](../stories/start-project-assignment.md) describes the current handoff. The script preserves unrelated machine configuration when applying the portable profile; `capture` returns only reviewed managed values. An ADR belongs to the project it affects, while a skill's method travels with Falkenwarte. These are observed repository rules, not assertions about another project's business process.

## Candidate boundaries

**Portable configuration** and **project knowledge** have different owners and lifecycles. The former lives in this repository and is applied by [`scripts/portable-pi.mjs`](../../../../scripts/portable-pi.mjs); the latter lives in each adopting project's Git tree. This is a separation of responsibilities, not evidence that two deployable services or formal DDD bounded contexts are needed. GitHub Issues/Projects, when authorized, represent work tracking rather than either source of truth.

## Open decision and validation

The default user-approval rule for consequential ADRs has not yet been refined for small delegated decisions. Validate the separation by testing a fresh installation and a separate project with its own `AGENTS.md` and existing ADR convention; confirm no automatic cross-project migration occurs.
