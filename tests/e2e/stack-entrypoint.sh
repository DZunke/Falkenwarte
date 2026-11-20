#!/usr/bin/env bash
# Mounted only by compose.e2e.yaml. The host serializes fixture requests.
set -euo pipefail
umask 077
control=/tmp/falkenwarte-e2e

if [[ ${APP_ENV:-} != test || ${FALKENWARTE_DATA_DIR:-} != /data || ${FALKENWARTE_DB:-} != /data/falkenwarte.sqlite ||
      ${FALKENWARTE_BACKUP_DIR:-} != /data/backups || ! -x /usr/local/bin/falkenwarte-entrypoint || -L /data/caddy ]]; then
    echo 'Fixture resets require the isolated E2E data volume.' >&2
    exit 1
fi

if (( $# )); then
    if [[ $# != 1 || $1 != reset ]]; then
        echo 'Usage: stack-entrypoint.sh [reset]' >&2
        exit 2
    fi
    # Publish the request before interrupting the product. The supervisor
    # clears it after the old group is gone, data is clean and a new group exists.
    read -r group < "$control/group"
    touch "$control/reset"
    kill -KILL -- "-$group"
    deadline=$((SECONDS + 60))
    while (( SECONDS < deadline )); do
        if [[ ! -e "$control/reset" ]] && php /usr/local/bin/falkenwarte-healthcheck; then
            exit 0
        fi
        sleep 0.1
    done
    echo 'The app did not become healthy after its fixture reset.' >&2
    exit 1
fi

# A real container stop exercises the product's graceful shutdown.
shutdown() {
    kill -TERM "$group" 2>/dev/null || true
    wait "$group" 2>/dev/null || true
    exit 0
}

mkdir -p "$control"
while true; do
    # Initial boot and intentional hub restarts preserve SQLite and the TLS CA.
    rm -f /data/caddy/mercure.db
    setsid /usr/local/bin/falkenwarte-entrypoint &
    group=$!
    trap shutdown TERM INT QUIT
    echo "$group" > "$control/group"
    rm -f "$control/reset"

    status=0
    wait "$group" || status=$?
    if [[ $status != 137 || ! -f "$control/reset" ]]; then
        echo "The app entrypoint exited unexpectedly (status $status)." >&2
        exit 1
    fi

    # Docker init reaps adopted children. No writer may retain an open SQLite
    # or Mercure handle when its backing file is removed.
    for ((attempt = 0; attempt < 100; attempt++)); do
        if ! kill -0 -- "-$group" 2>/dev/null; then break; fi
        sleep 0.05
    done
    if kill -0 -- "-$group" 2>/dev/null; then
        echo 'The previous app process group is still present.' >&2
        exit 1
    fi
    find /data -mindepth 1 -maxdepth 1 ! -name caddy -exec rm -rf -- {} +
done
