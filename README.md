# Falkenwarte

Falkenwarte is a private, single-owner workspace for projects, tickets, agent handoffs, and decisions around an existing T3 Code installation. T3 owns model and provider configuration. Falkenwarte does not read project repositories or verify reported code changes.

The implementation follows concept version 2.0. The [product concept](docs/PRODUCT_CONCEPT.md) defines its scope, [public contracts](contracts/README.md) define HTTP, MCP, and event shapes, and the [acceptance plan](docs/ACCEPTANCE.md) defines observable outcomes. The [traceability report](docs/TRACEABILITY.md) distinguishes implemented files from acceptance evidence.

## Run locally

Use the Linux production-shaped app container and its persistent data volume.

```sh
docker compose up --build
```

The first run opens owner setup in the browser at the configured application URL. Runtime configuration and backup/restore steps are documented in [operations](docs/OPERATIONS.md).

## Development checks

Install the locked PHP and frontend dependencies before running the repository checks.

```sh
composer install --prefer-dist
npm --prefix frontend ci
php scripts/check-contracts.php
php scripts/build-docs.php
```

The product test suite uses Playwright end-to-end scenarios against a started application with real database, workers, and Mercure, plus external T3 and Decisions mocks. See [testing](docs/TESTING.md) for the current commands and results.

## Documentation

The [documentation index](docs/README.md) links product guidance, the domain model, architecture decisions, integration boundaries, and operations. Source documents are kept in this repository and are published locally under `/docs` by the frontend build.
