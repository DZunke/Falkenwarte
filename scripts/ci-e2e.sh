#!/usr/bin/env bash
# Run the previously built image. Each Playwright test receives an empty
# database, a fresh owner, clean mock journals and an empty Mercure replay log.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
project="falkenwarte-e2e-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
runner="${project}-runner"
compose=(docker compose --project-name "$project" -f compose.yaml -f compose.test.yaml --profile test)
control="$(mktemp -d)"
watcher=''
cleanup() {
    if [[ -n "$watcher" ]]; then kill "$watcher" 2>/dev/null || true; fi
    docker rm -f "$runner" >/dev/null 2>&1 || true
    "${compose[@]}" down --volumes --remove-orphans >/dev/null
    rm -rf "$control"
}
trap cleanup EXIT

reset_stack() {
    "${compose[@]}" stop --timeout 12 app &&
    "${compose[@]}" run -T --no-deps --rm --entrypoint sh app -ec '
        test "$APP_ENV" = test
        test "$FALKENWARTE_DB" = /data/falkenwarte.sqlite
        find /data -mindepth 1 -maxdepth 1 ! -name caddy -exec rm -rf -- {} +
        rm -f /data/caddy/mercure.db
    ' &&
    "${compose[@]}" start app || return 1
    for ((attempt = 0; attempt < 60; attempt++)); do
        if "${compose[@]}" exec -T app php /usr/local/bin/falkenwarte-healthcheck >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.4
    done
    return 1
}

watch_resets() {
    shopt -s nullglob
    while true; do
        for request in "$control"/*.request; do
            local result="${request%.request}.result"
            if reset_stack; then echo ready > "$result.tmp"; else echo failed > "$result.tmp"; fi
            mv "$result.tmp" "$result"
            rm -f "$request"
        done
        sleep 0.15
    done
}

mkdir -p var/ci-evidence
"${compose[@]}" build t3-mock decisions-mock e2e
"${compose[@]}" up --no-build --wait --wait-timeout 150 app t3-mock decisions-mock
watch_resets &
watcher=$!
status=0
"${compose[@]}" run --no-deps --name "$runner" -e FALKENWARTE_STACK_CONTROL=/qa-control -v "$control:/qa-control" e2e || status=$?
kill "$watcher" 2>/dev/null || true
wait "$watcher" 2>/dev/null || true
watcher=''
docker cp "$runner:/app/qa/results.json" var/ci-evidence/acceptance.json
# Failure diagnostics can contain browser data. Upload only the public case
# identifiers, assertions and observations of successfully completed cases.
jq '(.cases[] | select(.status != "passed") | .observed_outcome) = [] | del(.cases[].error)' var/ci-evidence/acceptance.json > var/ci-evidence/acceptance.safe.json
mv var/ci-evidence/acceptance.safe.json var/ci-evidence/acceptance.json
if (( status == 0 )); then
    jq -e '.overall_status == "passed" and (.cases | length > 0) and all(.cases[]; .status == "passed")' var/ci-evidence/acceptance.json >/dev/null
fi
exit "$status"
