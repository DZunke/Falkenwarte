#!/usr/bin/env bash
# Run the previously built image. Each Playwright test receives an empty
# database, a fresh owner, clean mock journals and an empty Mercure replay log.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
project="falkenwarte-e2e-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
runner="${project}-runner"
reports="${project}-reports"
compose=(docker compose --project-name "$project" -f compose.yaml -f compose.test.yaml -f compose.e2e.yaml --profile test)
control="$(mktemp -d)"
watcher=''
cleanup() {
    if [[ -n "$watcher" ]]; then kill "$watcher" 2>/dev/null || true; fi
    docker rm -f "$runner" >/dev/null 2>&1 || true
    "${compose[@]}" down --volumes --remove-orphans >/dev/null
    docker volume rm "$reports" >/dev/null 2>&1 || true
    rm -rf "$control"
}
trap cleanup EXIT

reset_stack() {
    case "$1" in
        reset)
            "${compose[@]}" exec -T app bash /qa/stack-entrypoint.sh reset
            return $?
            ;;
        restart-hub)
            "${compose[@]}" restart --timeout 40 app || return 1
            ;;
        *) return 1 ;;
    esac
    for ((attempt = 0; attempt < 60; attempt++)); do
        if "${compose[@]}" exec -T app php /usr/local/bin/falkenwarte-healthcheck >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.4
    done
    return 1
}

watch_resets() {
    local request result mode start
    shopt -s nullglob
    while true; do
        for request in "$control"/*.request; do
            result="${request%.request}.result"
            mode="$(<"$request")"
            start=$SECONDS
            if reset_stack "$mode"; then echo ready > "$result.tmp"; else echo failed > "$result.tmp"; fi
            printf 'E2E fixture %s: %s (%ds)\n' "$mode" "$(<"$result.tmp")" "$((SECONDS - start))"
            mv "$result.tmp" "$result"
            rm -f "$request"
        done
        sleep 0.15
    done
}

mkdir -p var/ci-evidence
"${compose[@]}" build t3-mock decisions-mock e2e
bash scripts/ci-production.sh
"${compose[@]}" up --no-build --wait --wait-timeout 150 app t3-mock decisions-mock
watch_resets &
watcher=$!
status=0
docker volume create "$reports" >/dev/null
"${compose[@]}" run --no-deps --name "$runner" -e FALKENWARTE_STACK_CONTROL=/qa-control -v "$control:/qa-control" -v "$reports:/qa-results" e2e || status=$?
kill "$watcher" 2>/dev/null || true
wait "$watcher" 2>/dev/null || true
watcher=''
docker cp "$runner:/app/qa/results.json" "$control/acceptance-input.json"
docker cp "$runner:/qa-results/." "$control/reports"
python3 scripts/prepare-evidence.py "$control/reports" var/ci-evidence "$control/acceptance-input.json"
if [[ -f "$control/reports/public/board.png" ]]; then
    cp "$control/reports/public/board.png" var/ci-evidence/board.png
fi
if (( status == 0 )); then
    # A03 is static, A05 restarts Messenger, A19 uses the production profile,
    # and A31 exercises GitHub. Handbook coverage A23/A32 also runs in Chromium.
    jq -e '
      .overall_status == "passed" and all(.cases[]; .status == "passed" and (.observed_outcome | length > 0))
      and ((["E23","E24","E25"] - [.cases[] | select(.observed_outcome | length > 0) | .scenario_id]) | length == 0)
      and ((["A01","A02","A04","A06","A07","A08","A09","A10","A11","A12","A13","A14","A15","A16","A17","A18","A20","A21","A22","A23","A24","A25","A26","A27","A28","A29","A30","A32","A33"] - [.cases[].acceptance_id]) | length == 0)
    ' var/ci-evidence/acceptance.json >/dev/null
fi
exit "$status"
