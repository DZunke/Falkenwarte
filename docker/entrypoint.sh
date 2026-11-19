#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

data_directory="${FALKENWARTE_DATA_DIR:-/data}"
mkdir -p "$data_directory/.secrets" "$data_directory/backups" "$data_directory/caddy" "$data_directory/restore-completed" /certs
chmod 0700 "$data_directory/.secrets" "$data_directory/backups" "$data_directory/restore-completed"

load_secret() {
    local name="$1"
    local file_name="${name}_FILE"
    local configured_file="${!file_name:-}"
    local secret_file="$data_directory/.secrets/$2"
    local current_value="${!name:-}"

    if [[ -n "$configured_file" ]]; then
        if [[ ! -r "$configured_file" ]]; then
            printf 'Configured secret file for %s is not readable.\n' "$name" >&2
            exit 1
        fi
        current_value="$(<"$configured_file")"
    elif [[ -z "$current_value" ]]; then
        if [[ ! -s "$secret_file" ]]; then
            php -r 'echo bin2hex(random_bytes(32));' > "$secret_file"
            chmod 0600 "$secret_file"
        fi
        current_value="$(<"$secret_file")"
    fi

    if (( ${#current_value} < 32 )); then
        printf '%s must contain at least 32 characters.\n' "$name" >&2
        exit 1
    fi
    printf -v "$name" '%s' "$current_value"
    export "$name"
}

load_secret APP_SECRET app-secret
load_secret MERCURE_PUBLISHER_SECRET mercure-publisher-secret
load_secret MERCURE_SUBSCRIBER_SECRET mercure-subscriber-secret

setup_token_file="$data_directory/setup-token"
if [[ -n "${APP_SETUP_TOKEN_FILE:-}" ]]; then
    if [[ ! -r "$APP_SETUP_TOKEN_FILE" ]]; then
        printf 'Configured owner setup token file is not readable.\n' >&2
        exit 1
    fi
    APP_SETUP_TOKEN="$(<"$APP_SETUP_TOKEN_FILE")"
elif [[ -z "${APP_SETUP_TOKEN:-}" ]]; then
    if [[ ! -s "$setup_token_file" ]]; then
        php -r 'echo bin2hex(random_bytes(32));' > "$setup_token_file"
        chmod 0600 "$setup_token_file"
    fi
    APP_SETUP_TOKEN="$(<"$setup_token_file")"
else
    printf '%s' "$APP_SETUP_TOKEN" > "$setup_token_file"
    chmod 0600 "$setup_token_file"
fi
if (( ${#APP_SETUP_TOKEN} < 32 )); then
    printf 'APP_SETUP_TOKEN must contain at least 32 characters.\n' >&2
    exit 1
fi
export APP_SETUP_TOKEN

if [[ ! -f "$data_directory/falkenwarte.sqlite" ]]; then
    touch "$data_directory/falkenwarte.sqlite"
    chmod 0600 "$data_directory/falkenwarte.sqlite"
fi

run_startup_tasks() {
    if [[ -f "$data_directory/restore-request.json" ]]; then
        php /app/bin/restore-offline.php
    fi

    (
        flock -x 9
        php /app/bin/console doctrine:migrations:migrate --no-interaction
    ) 9>"$data_directory/migrations.lock"

    php /app/bin/console app:restore:finalize --no-interaction
}

copy_public_ca() {
    local certificate="$data_directory/caddy/pki/authorities/local/root.crt"
    local attempt
    for attempt in $(seq 1 60); do
        if [[ -s "$certificate" ]]; then
            install -m 0644 "$certificate" /certs/root.crt
            return 0
        fi
        sleep 1
    done
    printf 'Caddy did not create its local CA certificate.\n' >&2
    return 1
}

declare -A service_pids=()
declare -A restart_times=()
declare -A restart_counts=()
shutting_down=0

start_service() {
    local name="$1"
    shift
    "$@" &
    service_pids["$name"]=$!
    printf 'Started %s (pid %s).\n' "$name" "${service_pids[$name]}"
}

start_caddy() {
    start_service caddy frankenphp run --config /etc/frankenphp/Caddyfile --adapter caddyfile
}

start_worker() {
    start_service worker php /app/bin/console messenger:consume async --sleep=1 --time-limit=3600 --memory-limit=192M --no-interaction
}

start_maintenance() {
    start_service maintenance php /app/bin/console app:maintenance --no-interaction
}

start_services() {
    start_caddy
    copy_public_ca
    start_worker
    start_maintenance
}

stop_services() {
    local name pid attempt running
    for name in caddy worker maintenance; do
        pid="${service_pids[$name]:-}"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    for attempt in $(seq 1 30); do
        running=0
        for name in caddy worker maintenance; do
            pid="${service_pids[$name]:-}"
            if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
                running=1
            fi
        done
        if (( running == 0 )); then
            break
        fi
        sleep 1
    done

    for name in caddy worker maintenance; do
        pid="${service_pids[$name]:-}"
        if [[ -n "$pid" ]]; then
            if kill -0 "$pid" 2>/dev/null; then
                kill -KILL "$pid" 2>/dev/null || true
            fi
            wait "$pid" 2>/dev/null || true
            unset 'service_pids[$name]'
        fi
    done
}

shutdown() {
    shutting_down=1
    stop_services
    exit 0
}
trap shutdown TERM INT QUIT

restart_service() {
    local name="$1"
    local old_pid="${service_pids[$name]}"
    local current_time="$(date +%s)"
    local previous_time="${restart_times[$name]:-0}"

    wait "$old_pid" 2>/dev/null || true
    unset 'service_pids[$name]'

    if (( current_time - previous_time > 60 )); then
        restart_counts[$name]=0
    fi
    restart_times[$name]="$current_time"
    restart_counts[$name]=$(( ${restart_counts[$name]:-0} + 1 ))
    if (( restart_counts[$name] > 5 )); then
        printf '%s exited repeatedly; stopping the container for Docker restart policy.\n' "$name" >&2
        exit 1
    fi

    printf '%s exited; restarting it (attempt %s).\n' "$name" "${restart_counts[$name]}" >&2
    case "$name" in
        caddy) start_caddy; copy_public_ca ;;
        worker) start_worker ;;
        maintenance) start_maintenance ;;
    esac
}

run_startup_tasks
start_services

while (( shutting_down == 0 )); do
    if [[ -f "$data_directory/restore-request.json" ]]; then
        stop_services
        run_startup_tasks
        start_services
        continue
    fi

    for service in caddy worker maintenance; do
        if [[ -n "${service_pids[$service]:-}" ]] && ! kill -0 "${service_pids[$service]}" 2>/dev/null; then
            restart_service "$service"
        fi
    done
    sleep 1
done
