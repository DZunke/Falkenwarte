#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

suffix="${GITHUB_RUN_ID:-local}-plugin-upgrade-${GITHUB_RUN_ATTEMPT:-$$}"
project="falkenwarte-plugin-upgrade-${suffix//[^a-zA-Z0-9_-]/-}"
qa_image="falkenwarte:plugin-upgrade-qa-${suffix//[^a-zA-Z0-9_.-]/-}"
production_image="${FALKENWARTE_IMAGE:-falkenwarte:plugin-upgrade-production}"
e2e_image="${FALKENWARTE_E2E_IMAGE:-falkenwarte-e2e:local}"
mocks_image="${FALKENWARTE_MOCKS_IMAGE:-falkenwarte-mocks:local}"
control="$(mktemp -d "${TMPDIR:-/tmp}/falkenwarte-plugin-upgrade.XXXXXX")"
evidence="$root/var/ci-evidence/plugin-image-upgrade-${suffix//[^a-zA-Z0-9_-]/-}"
source_sha="${FALKENWARTE_TEST_COMMIT:-$(git rev-parse HEAD)}"
source_epoch="$(git log -1 --format=%ct)"
version="$(cat version.txt)"
mkdir -p "$evidence" "$control/results"

export FALKENWARTE_TEST_COMMIT="$source_sha"
export FALKENWARTE_PORT=0
export FALKENWARTE_BASE_URL=https://falkenwarte.test:8443
export FALKENWARTE_API_PREFIX=/api/v1
export FALKENWARTE_SETUP_TOKEN=test-setup-token-ONLY-for-isolated-qa
export FALKENWARTE_QA_OWNER_PASSWORD='Falkenwarte-Test-Owner-Password-2026!'
export SERVER_NAME=localhost:8443
export SERVER_NAME_ALIAS=falkenwarte.test:8443
export FALKENWARTE_PUBLIC_ORIGIN=https://falkenwarte.test:8443
export MERCURE_ISSUER="$FALKENWARTE_PUBLIC_ORIGIN"
export MERCURE_RESOURCE_IDENTIFIER="$FALKENWARTE_PUBLIC_ORIGIN/.well-known/mercure"
export MERCURE_PUBLIC_URL="$FALKENWARTE_PUBLIC_ORIGIN/.well-known/mercure"
export FALKENWARTE_E2E_IMAGE="$e2e_image"
export FALKENWARTE_MOCKS_IMAGE="$mocks_image"
export QA_RESULTS_DIR="$control/results/unused"

compose_test=(docker compose --project-name "$project" -f compose.yaml -f compose.test.yaml --profile test)
compose_prod=(docker compose --project-name "$project" -f compose.yaml -f compose.test.yaml -f compose.plugin-upgrade-prod.yaml --profile test)

cleanup() {
    "${compose_test[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

image_id() {
    docker image inspect "$1" --format '{{.Id}}'
}

build_app_image() {
    local target="$1"
    local tag="$2"
    local revision="$3"
    docker build --file docker/Dockerfile --target "$target" \
        --build-arg VCS_REF="$revision" \
        --build-arg SOURCE_DATE_EPOCH="$source_epoch" \
        --build-arg APP_VERSION="$version" \
        --tag "$tag" .
}

run_phase() {
    local phase="$1"
    local environment="$2"
    local profile="$3"
    local spec="$4"
    local results="$control/results/$phase"
    local status=0
    local upgrade_profile=0
    if [[ "$profile" = plugin-upgrade ]]; then
        upgrade_profile=1
    fi
    mkdir -p "$results"
    export QA_RESULTS_DIR="$results"
    if [[ "$environment" = prod ]]; then
        "${compose_prod[@]}" run --rm --no-deps \
            -e FALKENWARTE_PLUGIN_IMAGE_UPGRADE="$upgrade_profile" \
            -e FALKENWARTE_PLUGIN_UPGRADE_PHASE="$phase" \
            e2e bash /usr/local/bin/run-browser-qa "$spec" || status=$?
    else
        "${compose_test[@]}" run --rm --no-deps \
            -e FALKENWARTE_PLUGIN_IMAGE_UPGRADE="$upgrade_profile" \
            -e FALKENWARTE_PLUGIN_UPGRADE_PHASE="$phase" \
            e2e bash /usr/local/bin/run-browser-qa "$spec" || status=$?
    fi
    if [[ ! -s "$results/acceptance-evidence.json" ]]; then
        if (( status == 0 )); then
            printf 'The %s browser run passed without producing its evidence report.\n' "$phase" >&2
            status=1
        fi
        return "$status"
    fi

    python3 scripts/prepare-evidence.py "$results" "$evidence" "$results/acceptance-evidence.json" "plugin-upgrade-${phase}.json"
    if (( status == 0 )) && ! jq -e \
        --arg commit "$FALKENWARTE_TEST_COMMIT" \
        --arg image "$FALKENWARTE_IMAGE_REF" \
        '.format == "falkenwarte.acceptance-evidence.v1"
          and .overall_status == "passed"
          and .commit == $commit
          and .image == $image
          and any(.cases[]; .acceptance_id == "A17" and .status == "passed" and ((.observed_outcome // []) | length > 0))' \
        "$results/acceptance-evidence.json" >/dev/null; then
        printf 'The %s report is not a passed A17 observation for the expected SHA and image ID.\n' "$phase" >&2
        status=1
    fi
    return "$status"
}

if ! docker image inspect "$production_image" >/dev/null 2>&1; then
    build_app_image app "$production_image" "$source_sha"
fi
production_id="$(image_id "$production_image")"
if [[ -n "${FALKENWARTE_IMAGE_REF:-}" && "$FALKENWARTE_IMAGE_REF" != "$production_id" ]]; then
    printf 'The supplied production image ID does not match %s.\n' "$production_image" >&2
    exit 1
fi

docker build --file docker/Dockerfile.plugin-upgrade \
    --build-arg FALKENWARTE_IMAGE="$production_image" \
    --tag "$qa_image" .
export FALKENWARTE_IMAGE="$qa_image"
export FALKENWARTE_IMAGE_REF="$(image_id "$qa_image")"
"${compose_test[@]}" build e2e decisions-mock t3-mock
"${compose_test[@]}" up --detach --no-build --wait --wait-timeout 240 app decisions-mock t3-mock
"${compose_test[@]}" exec -T app sh -ec 'test "$APP_ENV" = test; test -s /app/tests/Fixtures/Plugins/manifest.json'
run_phase plans test standard tests/e2e/tests/plugin-install-plans.spec.mjs
run_phase prepare test plugin-upgrade tests/e2e/plugin-upgrade/plugin-removal-image-upgrade.spec.mjs

"${compose_test[@]}" stop --timeout 15 app decisions-mock t3-mock
"${compose_test[@]}" rm -f app >/dev/null
export FALKENWARTE_IMAGE="$production_image"
export FALKENWARTE_IMAGE_REF="$production_id"
"${compose_prod[@]}" up --detach --no-build --force-recreate --wait --wait-timeout 180 app
"${compose_prod[@]}" exec -T app sh -ec 'test "$APP_ENV" = prod; test ! -e /app/tests; test -z "$DECISIONS_API_KEY"; test -z "$T3_MOCK_URL"'
run_phase verify prod plugin-upgrade tests/e2e/plugin-upgrade/plugin-removal-image-upgrade.spec.mjs

export FALKENWARTE_IMAGE="$qa_image"
export FALKENWARTE_IMAGE_REF="$(image_id "$qa_image")"
"${compose_test[@]}" up --detach --no-build --force-recreate --wait --wait-timeout 180 app
"${compose_test[@]}" exec -T app sh -ec 'test "$APP_ENV" = test; test -s /app/tests/Fixtures/Plugins/manifest.json'
run_phase readback test plugin-upgrade tests/e2e/plugin-upgrade/plugin-removal-image-upgrade.spec.mjs

export FALKENWARTE_IMAGE="$production_image"
export FALKENWARTE_IMAGE_REF="$production_id"
"${compose_test[@]}" stop --timeout 15 app
"${compose_test[@]}" rm -f app >/dev/null
"${compose_prod[@]}" up --detach --no-build --force-recreate --wait --wait-timeout 180 app
"${compose_prod[@]}" exec -T app sh -ec 'test "$APP_ENV" = prod; test ! -e /app/tests; test -z "$DECISIONS_API_KEY"; test -z "$T3_MOCK_URL"'
run_phase verify-after-readback prod plugin-upgrade tests/e2e/plugin-upgrade/plugin-removal-image-upgrade.spec.mjs

printf 'Plugin image-upgrade reports written to %s\n' "$evidence"
