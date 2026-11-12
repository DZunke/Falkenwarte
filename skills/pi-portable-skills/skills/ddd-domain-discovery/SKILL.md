---
name: ddd-domain-discovery
description: Explore an existing or proposed business domain through focused questions, domain stories and event-oriented workshops. Use when terminology, actors, workflows or rules are unclear before modeling.
---

# Discover the domain

This is an original working method informed by Alberto Brandolini's EventStorming and Stefan Hofer and Henning Schwentner's Domain Storytelling. Use their names to credit the techniques, not as substitutes for evidence from domain experts.

1. Establish the current project's **question and boundary**: which business capability, scenario and decision must this inquiry clarify? A complete model means complete enough for that agreed scope, never a claim to know the entire enterprise.
2. Inspect existing code, product language, docs and observed behavior. Record the source of each fact. Keep observed rules, inferred rules and open questions separate.
3. Tell one concrete story with an actor, a trigger, ordered actions, business events, exceptions and a desired outcome. Ask the domain expert **one consequential question at a time**. Offer a tentative example so they can correct it; do not silently invent policy.
4. For EventStorming, capture past-tense domain events, their initiating commands/actors, policies and contested terms. Mark uncertainty and disagreement rather than forcing consensus. For Domain Storytelling, track who does what with which work object in the language the experts actually use.
5. Continue the question-and-answer loop until the agreed scenarios have actors, outcomes, exceptions, named concepts and rules, or until the next decision needs a domain expert. If blocked, state the exact missing answer; do not declare the model finished.

Deliver a short domain brief: scope, evidence links or paths, story/event sequence, glossary with competing terms, decisions, unknowns and the **next question**. When the named target project uses Falkenwarte and the user wants durable notes, store each evidenced scenario under that project's `.falkenwarte/knowledge/domain/stories/`; respect an established project documentation convention instead of creating a duplicate archive. Hand the findings to `ddd-strategic-modeling` only once the language is grounded. Never translate every database table into a domain concept by default.
