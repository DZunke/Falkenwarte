# Falkenwarte

Falkenwarte is a private, single-owner workspace for projects, tickets, agent handoffs, and decisions around an existing T3 Code installation. T3 owns model and provider configuration. Falkenwarte does not read project repositories or verify reported code changes.

The implementation follows concept version 2.0. The [product concept](docs/PRODUCT_CONCEPT.md) defines its scope, [public contracts](contracts/README.md) define HTTP, MCP, and event shapes, and the [acceptance plan](docs/ACCEPTANCE.md) defines observable outcomes. The [traceability report](docs/TRACEABILITY.md) distinguishes implemented files from acceptance evidence.

## Run locally

Use the Linux production-shaped app container and its persistent data volume.

The checked-in `.env` contains safe defaults. Symfony loads personal overrides from the ignored `.env.local`; keep credentials there. `make app-up` also passes `.env.local` to Compose when it exists, and Compose overrides can be supplied directly with `docker compose --env-file .env --env-file .env.local ...`.

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

Run `make install` once on a new checkout to install the locked PHP and Node dependencies; `make qa` includes that bootstrap. Use `make help` to list the common local-development and QA commands.

`make check` assumes dependencies are installed and reuses them. `make format-check` can be rerun directly without reinstalling Composer packages.

`make app-up` builds and starts the application. `make app-down` stops it while keeping its data and certificate volumes. `make app-logs` follows the app logs.

`make check` runs PHP formatting checks, static analysis, frontend checks, documentation validation, and the focused background-job checks. `make qa` also runs the real Docker and Playwright browser suite and the plugin image-upgrade checks.

`make format` applies the Symfony PHP coding standards. After dependencies are installed, `make format-check` checks them without editing files or reinstalling Composer packages. `make clean` removes only generated frontend and handbook files; it preserves volumes, environment files, secrets, dependencies, and QA evidence.

The product test suite uses Playwright end-to-end scenarios against a started application with real database, workers, and Mercure, plus external T3 and Decisions mocks. See [testing](docs/TESTING.md) for the current commands and results.

## Documentation

The [documentation index](docs/README.md) links product guidance, the domain model, architecture decisions, integration boundaries, and operations. `make docs` builds the standalone HTML pages under `public/docs/`; the Docker image runs this PHP build separately from the Vite frontend build.
