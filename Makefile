SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

PHP ?= php
COMPOSER ?= composer
NPM ?= npm
DOCKER ?= docker
DOCKER_COMPOSE ?= $(DOCKER) compose
FALKENWARTE_IMAGE ?= falkenwarte:local
DOCS_PORT ?= 8081
COMPOSE_ENV_FILE_ARGS = $(if $(wildcard .env.local), --env-file .env --env-file .env.local)

.DEFAULT_GOAL := help
.PHONY: help install php-deps frontend-deps e2e-deps delivery-deps app-up app-down app-logs image format format-check contracts architecture container phpstan frontend-check static docs docs-serve background check e2e e2e-run plugin-upgrade plugin-upgrade-run qa clean
.NOTPARALLEL: check static qa

help: ## List the available developer commands
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z0-9_.-]+:.*## / { printf "\033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: php-deps frontend-deps e2e-deps delivery-deps ## Install all locked PHP and Node dependencies

php-deps: ## Install Composer dependencies
	$(COMPOSER) validate --strict --no-check-publish --no-check-all
	$(COMPOSER) install --no-interaction --prefer-dist --no-progress

frontend-deps: ## Install frontend dependencies
	$(NPM) --prefix frontend ci

e2e-deps: ## Install local Playwright dependencies
	$(NPM) --prefix tests/e2e ci

delivery-deps: ## Install Conventional Commit checks
	$(NPM) --prefix qa/delivery ci --ignore-scripts --no-audit

app-up: ## Build and start the local application without removing its volumes
	FALKENWARTE_TEST_COMMIT="$$(git rev-parse HEAD)" APP_VERSION="$$(cat version.txt)" $(DOCKER_COMPOSE)$(COMPOSE_ENV_FILE_ARGS) up --build --detach --wait

app-down: ## Stop the local application while preserving its data and certificates
	$(DOCKER_COMPOSE)$(COMPOSE_ENV_FILE_ARGS) down

app-logs: ## Follow the local application logs
	$(DOCKER_COMPOSE)$(COMPOSE_ENV_FILE_ARGS) logs --follow --tail=100 app

image: ## Build the current source as the production-shaped QA image
	@revision="$$(git rev-parse HEAD)"; \
	epoch="$$(git log -1 --format=%ct)"; \
	$(DOCKER) build --file docker/Dockerfile --target app \
		--build-arg "VCS_REF=$$revision" \
		--build-arg "SOURCE_DATE_EPOCH=$$epoch" \
		--build-arg "APP_VERSION=$$(cat version.txt)" \
		--tag "$(FALKENWARTE_IMAGE)" .

format: ## Apply Symfony PHP coding standards to first-party PHP files
	vendor/bin/php-cs-fixer fix --diff --show-progress=none

format-check: ## Check Symfony PHP coding standards without changing files
	vendor/bin/php-cs-fixer check --diff --show-progress=none

contracts: ## Validate the public API and event contracts
	$(PHP) scripts/check-contracts.php

architecture: ## Check module boundaries and the absence of Doctrine ORM
	$(PHP) scripts/check-architecture.php

container: ## Compile and validate the Symfony service container
	$(PHP) bin/console lint:container

phpstan: ## Run PHPStan
	vendor/bin/phpstan analyse --no-progress --memory-limit=1G

frontend-check: ## Regenerate and check frontend types, lint, and production build
	$(NPM) --prefix frontend run generate:api
	git diff --exit-code -- frontend/src/generated
	$(NPM) --prefix frontend run lint
	$(NPM) --prefix frontend run build

static: contracts architecture container phpstan format-check frontend-check ## Run PHP, Symfony, PHPStan, formatting, and frontend checks

docs: ## Check documentation and build the static handbook
	$(PHP) scripts/check-docs.php
	$(PHP) scripts/build-docs.php
	test -s public/docs/index.html

docs-serve: docs ## Preview the handbook locally (override DOCS_PORT to change port)
	@echo "Handbuch: http://127.0.0.1:$(DOCS_PORT)/docs/"
	$(PHP) -S 127.0.0.1:$(DOCS_PORT) -t public scripts/preview-docs.php

background: ## Run the focused background-job functional checks
	vendor/bin/phpunit -c phpunit.dist.xml

check: static docs background ## Run formatting, static quality, documentation, and background checks

e2e: image ## Build the current image and run the real Docker browser suite
	@revision="$$(git rev-parse HEAD)"; \
	image_id="$$($(DOCKER) image inspect "$(FALKENWARTE_IMAGE)" --format '{{.Id}}')"; \
	FALKENWARTE_TEST_COMMIT="$$revision" FALKENWARTE_IMAGE="$(FALKENWARTE_IMAGE)" FALKENWARTE_IMAGE_REF="$$image_id" $(MAKE) --no-print-directory e2e-run

e2e-run: ## Run Docker browser QA against the image identified by FALKENWARTE_IMAGE_REF
	@test -n "$${FALKENWARTE_TEST_COMMIT:-}" || { echo 'FALKENWARTE_TEST_COMMIT is required.' >&2; exit 2; }
	@test -n "$${FALKENWARTE_IMAGE_REF:-}" || { echo 'FALKENWARTE_IMAGE_REF is required.' >&2; exit 2; }
	@test "$$(git rev-parse HEAD)" = "$${FALKENWARTE_TEST_COMMIT}" || { echo 'FALKENWARTE_TEST_COMMIT does not match the checked out revision.' >&2; exit 2; }
	@test "$$($(DOCKER) image inspect "$(FALKENWARTE_IMAGE)" --format '{{.Id}}')" = "$${FALKENWARTE_IMAGE_REF}" || { echo 'FALKENWARTE_IMAGE_REF does not match the selected image.' >&2; exit 2; }
	FALKENWARTE_PORT=0 bash scripts/ci-e2e.sh

plugin-upgrade: image ## Build the current image and run plugin image-upgrade browser checks
	@revision="$$(git rev-parse HEAD)"; \
	image_id="$$($(DOCKER) image inspect "$(FALKENWARTE_IMAGE)" --format '{{.Id}}')"; \
	FALKENWARTE_TEST_COMMIT="$$revision" FALKENWARTE_IMAGE="$(FALKENWARTE_IMAGE)" FALKENWARTE_IMAGE_REF="$$image_id" $(MAKE) --no-print-directory plugin-upgrade-run

plugin-upgrade-run: ## Run plugin image-upgrade QA against the supplied image and SHA
	@test -n "$${FALKENWARTE_TEST_COMMIT:-}" || { echo 'FALKENWARTE_TEST_COMMIT is required.' >&2; exit 2; }
	@test -n "$${FALKENWARTE_IMAGE_REF:-}" || { echo 'FALKENWARTE_IMAGE_REF is required.' >&2; exit 2; }
	@test -n "$${FALKENWARTE_IMAGE:-}" || { echo 'FALKENWARTE_IMAGE is required.' >&2; exit 2; }
	@test "$$(git rev-parse HEAD)" = "$${FALKENWARTE_TEST_COMMIT}" || { echo 'FALKENWARTE_TEST_COMMIT does not match the checked out revision.' >&2; exit 2; }
	FALKENWARTE_PORT=0 bash scripts/ci-plugin-image-upgrade.sh

qa: install check e2e plugin-upgrade ## Install dependencies, then run all local and browser QA

clean: ## Remove generated frontend and handbook output, preserving data, dependencies, and evidence
	rm -rf -- public/build public/docs
