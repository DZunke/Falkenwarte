# Falkenwarte: proposed GitHub phase labels

GitHub labels should show **the stage of an Issue**, not every agent action. The live flow and chat carry agent names, handoffs, summaries and test results. This policy is a proposal for a selected repository, not a command to create labels in every project or to edit any existing Issue. Confirm the repository, permissions, current labels and Project fields before adopting it.

## A small phase vocabulary

| Proposed label | Meaning | Exit evidence |
| --- | --- | --- |
| `fw:phase/idea` | Outcome or acceptance criteria are still being clarified. | A scoped request with examples. |
| `fw:phase/planning` | Scope, approach and required approvals are being established. | A reviewed plan; an ADR decision if required. |
| `fw:phase/implementation` | Approved work is under way. | Changes and relevant checks are ready for review. |
| `fw:phase/review` | Independent review and verification are running. | Findings resolved or explicitly accepted by the owner. |
| `fw:phase/result` | Waldemar has reported the outcome; a PR may or may not be appropriate. | A documented handoff or approved PR plan. |
| `fw:phase/pr` | An authorized PR exists and awaits human collaboration. | PR URL and its actual review/merge state. |

At most **one** `fw:phase/*` label should be present on an Issue managed under this policy. `fw:blocked` may accompany any phase; the block's reason and needed decision belong in an Issue comment or linked plan, not the label. `failed`, `skipped`, `paused`, agent names, reviewers and test results belong in the local flow and linked evidence; multiplying those into labels would make the Issue misleading. PR opened is not `done` or `merged`. A terminal outcome without a PR should be reported under `result`, with the Issue closed only when the owner authorizes that change and the acceptance checks are met.

If a repository already has a lifecycle taxonomy, map to it **instead of creating parallel `fw:*` labels**; propose a change only when an actual gap is demonstrated. A GitHub Project's Status can provide the broader portfolio overview, but it must not silently override an Issue's phase label. Record the chosen mapping per project; if the two disagree, surface the discrepancy and stop automated updates until it is resolved. Other labels (bug, enhancement, priority, team) are never removed by phase changes.

## What is authorized?

Reading an Issue or Project is not permission to edit it. Before the first write, show the target `OWNER/REPO`, proposed labels, current phase, next phase, and any Project field changes. Confirm whether permission covers just this transition or a **bounded, revocable per-project policy** for phase updates during this assignment. Creation of Issues or labels, comments, closing Issues, opening PRs, pushing branches and merging each require their own explicit scope; never infer it from permission to update one phase. Re-read the Issue after a write and report partial success without blind retries.

For a free-text assignment, track phases locally; never create an Issue as a side effect. For a GitHub-based assignment, the Issue is the work item, the Project is an optional portfolio view, and the PR is a review artifact. The target repository's ADR archive remains the durable decision source. Consult [`github-issues-projects`](../skills/pi-portable-skills/skills/github-issues-projects/SKILL.md) for read-first CLI checks and safe mutation rules.

Before activating this proposal, try the read-only flow on one real Issue and inspect its current labels/Project fields. Then decide whether these names fit that project's language. See [the proposed task flow](factory-flow.md).
