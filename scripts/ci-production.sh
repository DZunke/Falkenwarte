#!/usr/bin/env bash
# Test the exact release image with production settings and no mock services.
set -euo pipefail
cd "$(dirname "$0")/.."
project="falkenwarte-prod-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
compose=(docker compose -p "$project" -f compose.yaml)
export FALKENWARTE_PORT=0 SERVER_NAME=localhost:8443 SERVER_NAME_ALIAS=app:8443
export FALKENWARTE_PUBLIC_ORIGIN=https://app:8443 MERCURE_ISSUER=https://app:8443
export MERCURE_PUBLIC_URL="$FALKENWARTE_PUBLIC_ORIGIN/.well-known/mercure" MERCURE_RESOURCE_IDENTIFIER="$FALKENWARTE_PUBLIC_ORIGIN/.well-known/mercure"
export APP_SETUP_TOKEN=test-setup-token-ONLY-for-isolated-qa
export FALKENWARTE_BASE_URL="$FALKENWARTE_PUBLIC_ORIGIN" FALKENWARTE_SETUP_TOKEN="$APP_SETUP_TOKEN"
runner="${project}-runner"
reports="${project}-reports"
private_reports=$(mktemp -d)
cleanup() {
    docker rm -f "$runner" >/dev/null 2>&1 || true
    "${compose[@]}" down --volumes >/dev/null
    docker volume rm "$reports" >/dev/null 2>&1 || true
    rm -rf "$private_reports"
}
trap cleanup EXIT
test "$("${compose[@]}" config --services)" = app
"${compose[@]}" up --no-build --wait --wait-timeout 90
test "$("${compose[@]}" ps --status running --services)" = app
"${compose[@]}" exec -T app sh -ec '
    test "$APP_ENV" = prod
    test ! -e /app/qa && test ! -e /app/tests
    test -s /app/public/build/index.html && test -s /app/public/docs/index.html
    php -r '\''if (version_compare((new PDO("sqlite::memory:"))->query("SELECT sqlite_version()")->fetchColumn(), "3.51.3", "<")) exit(1);'\''
'
docker volume create "$reports" >/dev/null
mkdir -p var/ci-evidence
for phase in 0 1; do
    if [[ "$phase" = 1 ]]; then
        "${compose[@]}" stop --timeout 15 app
        "${compose[@]}" up --no-build --wait --wait-timeout 90
    fi
    docker run --name "$runner" --network "${project}_app" \
        -e FALKENWARTE_BASE_URL -e FALKENWARTE_SETUP_TOKEN -e FALKENWARTE_TEST_COMMIT -e FALKENWARTE_IMAGE_REF \
        -e FALKENWARTE_PRODUCTION_SMOKE=1 -e FALKENWARTE_VERIFY_RESTART="$phase" \
        -e FALKENWARTE_QA_RESULTS_DIR=/qa-results -e FALKENWARTE_PRIVATE_DIR=/tmp/owner \
        -v "${project}_falkenwarte-certs:/certificates:ro" -v "$reports:/qa-results" \
        "${FALKENWARTE_E2E_IMAGE:-falkenwarte-e2e:local}" bash /usr/local/bin/run-browser-qa
    docker cp "$runner:/app/qa/results.json" "$private_reports/result.json"
    python3 scripts/prepare-evidence.py "$private_reports" var/ci-evidence "$private_reports/result.json" "production-$phase.json"
    docker rm "$runner" >/dev/null
done
