---
name: ddd-strategic-modeling
description: Model bounded contexts, context relationships, aggregates, invariants and ubiquitous language from domain evidence. Use when shaping or documenting a domain model rather than copying database or service boundaries.
---

# Model from domain evidence

This is an original checklist informed by Eric Evans's Domain-Driven Design and Vaughn Vernon's Implementing Domain-Driven Design. It is not a claim that either author endorsed this project's model.

1. State the decision, bounded scope and evidence: expert statements, documented workflows, code behavior and unresolved contradictions. Seek missing facts with `ddd-domain-discovery` rather than assigning names by guesswork.
2. Propose bounded contexts where a term has a consistent meaning and rules. For each, name the capability it serves, its own ubiquitous language, the team or owner if known, and what it does **not** own. A context is a language/model boundary, not necessarily one deployable service.
3. Draw a context map in text or Mermaid with upstream/downstream relationships, translation at boundaries, and where external systems or legacy models need an anti-corruption layer. Describe a relationship only when evidence supports it.
4. Inside a context, identify entities, value objects and aggregates around business invariants and transactional consistency. For each aggregate, record its root, commands, invariant, concurrency expectations, domain events and what it may reference by identity. Keep aggregates small enough to protect their actual invariants; do not design from CRUD tables.
5. Walk a happy path and at least one failure/exception with a domain expert. Challenge ambiguous names, invented invariants and over-wide aggregates. Compare a simpler alternative before recommending patterns.

Produce a versioned model note: scope, glossary, context map, aggregates/invariants, examples, evidence, disputed decisions, unanswered questions and validation scenarios. Mark the model as **ready for this scope** only after the expert has resolved the decisions the task depends on; otherwise say what remains open. Ask Waldemar before committing architectural changes.
