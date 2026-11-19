#!/usr/bin/env bash
set -euo pipefail
root_ca=/certificates/root.crt
export NODE_EXTRA_CA_CERTS="$root_ca"
install -m 0644 "$root_ca" /usr/local/share/ca-certificates/falkenwarte.crt
update-ca-certificates >/dev/null
# Chromium uses its Linux NSS user store. Both locations cover Chromium's
# profile migration and the older headless shell in pinned Playwright images.
for nssdb in "$HOME/.pki/nssdb" "${XDG_DATA_HOME:-$HOME/.local/share}/pki/nssdb"; do
    mkdir -p "$nssdb"
    if [[ ! -f "$nssdb/cert9.db" ]]; then certutil -N -d "sql:$nssdb" --empty-password; fi
    certutil -A -d "sql:$nssdb" -n 'Falkenwarte QA Root CA' -t 'C,,' -i "$root_ca"
done
mkdir -p "$FALKENWARTE_QA_RESULTS_DIR" "$FALKENWARTE_PRIVATE_DIR"
chmod 0700 "$FALKENWARTE_PRIVATE_DIR"
status=0
npm --prefix tests/e2e test -- "$@" || status=$?
if [[ -f qa/results.json ]]; then cp qa/results.json "$FALKENWARTE_QA_RESULTS_DIR/acceptance-evidence.json"; fi
exit "$status"
