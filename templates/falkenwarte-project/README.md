# Falkenwarte project knowledge

This project owns [`knowledge/`](knowledge/README.md) and [`settings.json`](settings.json); review both through Git. The limited `review.delivery` setting defaults to `local` and may be set to `pr` only when this project authorizes GitHub branch, commit, push and PR operations. It is not executable Pi configuration; trusted Pi settings stay under `.pi/`. The ignored `.falkenwarte/runs/` stores project-local assignment snapshots, not live worker processes or subagent transcripts; `.falkenwarte/reviews/` is reserved for local review output. Credentials and private session data stay outside Git. Falkenwarte's portable Pi profile supplies methods and specialists; it does not upload this directory or treat Markdown here as executable instructions.

Read this project's `AGENTS.md` and any existing knowledge conventions before changing a record. An existing ADR archive remains authoritative unless its maintainer explicitly approves a migration.
