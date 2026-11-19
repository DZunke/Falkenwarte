# Falkenwarte

Falkenwarte is a private, single-owner workspace for projects, tickets, agent handoffs, and decisions around an existing T3 Code installation. T3 owns model and provider configuration. Falkenwarte does not read project repositories or verify reported code changes.

The implementation follows concept version 2.0. The [product concept](docs/PRODUCT_CONCEPT.md) defines its scope, [public contracts](contracts/README.md) define HTTP, MCP, and event shapes, and the [acceptance plan](docs/ACCEPTANCE.md) defines observable outcomes. The [traceability report](docs/TRACEABILITY.md) distinguishes implemented files from acceptance evidence.

## Run locally

Use the Linux production-shaped app container and its persistent data volume.

```sh
docker compose up --build -d --wait
```

The local application opens at <https://localhost:8443>. Before visiting it, copy Caddy's local root certificate and import it into the certificate store used by your Linux browser:

```sh
docker compose exec -T app cat /certs/root.crt > falkenwarte-root.crt
```

Read the one-time owner setup token from the persistent data volume, then enter it in the browser's first-run setup:

```sh
docker compose exec -T app cat /data/setup-token
```

The static documentation site is available at <https://localhost:8443/docs/>. T3 and OpenAI credentials are not required to start the local app; those external integrations remain unavailable until configured. Runtime configuration and backup/restore steps are documented in [operations](docs/OPERATIONS.md).

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

The [documentation index](docs/README.md) links product guidance, the domain model, architecture decisions, integration boundaries, and operations. `php scripts/build-docs.php` creates the standalone HTML pages under `public/docs/`; the Docker image runs this PHP build separately from the Vite frontend build.
