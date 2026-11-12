---
name: domain-story-mapping
description: Document a domain journey with user stories, a story map, exceptions and outcome-based slices. Use when turning domain discovery into shared product narratives and testable increments.
---

# Turn domain stories into a map

This original workflow draws on Jeff Patton's User Story Mapping and Domain Storytelling by Stefan Hofer and Henning Schwentner. Attribute the ideas; do not present an invented customer story as a quote from a real person.

1. Ask whose job or need the map serves, what successful change they expect, and which concrete scenario is in scope. Use the words of actual domain experts where available; label composite or hypothetical anecdotes as such.
2. Write the narrative spine as the actor's activities in time order. Beneath each activity, list concrete tasks and alternative paths. Include failure, handoff and recovery stories; do not stop at a polished happy path.
3. Separate **observed facts**, **assumptions** and **questions**. When an old customer anecdote reveals a rule or contradiction, record its provenance and ask whether it is still true. A memorable story is evidence to check, not a specification by itself.
4. Slice the map vertically into a smallest coherent outcome and later increments. Give each slice an observable success condition, domain rule, acceptance example and dependency. Do not split solely by UI, database or team layer.
5. Review the map with the expert using one focused question at a time. Revisit the terminology in the DDD glossary when two actors use one word differently.

Deliver a compact map in Markdown (activities → tasks → slices), two or three concrete acceptance examples, the disputed rules and the next question. When the named project adopts Falkenwarte, keep the map beside its related `.falkenwarte/knowledge/domain/stories/` evidence; do not assume this portable profile is the target project. Stop only when the requested journey can be explained and tested to the agreed scope, or clearly report the unresolved blocker.
