# Falkenwarte QA

Die Produktabdeckung läuft mit Playwright gegen eine gestartete Falkenwarte-Anwendung und deren öffentliche Browser-, JSON- und MCP-Schnittstellen.

Die reproduzierbaren T3- und OpenAI-Decisions-Dienste stehen unter `qa/mocks`; sie werden ausschließlich im Testprofil gestartet.

## Lokaler Lauf

Starte zuerst das Compose-Testprofil mit der Falkenwarte-App, SQLite-Volume, Worker, `t3-mock` und `decisions-mock`.

Installiere den gesperrten Runner mit `npm --prefix tests/e2e ci` und Chromium mit `npm --prefix tests/e2e exec playwright install chromium`.

Führe die Browser- und Schnittstellentests mit `FALKENWARTE_BASE_URL=http://127.0.0.1:8080 npm --prefix tests/e2e test` aus.

Das Compose-Profil setzt `APP_ENV=test`, `APP_SETUP_TOKEN=test-setup-token-ONLY-for-isolated-qa`, `DECISIONS_API_KEY=qa-decisions-token` und die Mockadressen `http://decisions-mock:4310/v1/decisions` sowie `http://t3-mock:4311/mcp`.

Die Runnerkonfiguration begrenzt die Suite auf einen Chromium-Worker und startet keine internen HTTP-Mocks im Browser.

## Nachweise

Der Playwright-Reporter schreibt gezielte Entwicklerläufe nach `qa/results.json`; diese Datei ist ignoriert und wird bei jedem Lauf überschrieben. `scripts/ci-e2e.sh` redigiert den vollständigen Workflowbericht zu `var/ci-evidence/acceptance.json`, den GitHub Actions als `acceptance`-Artefakt veröffentlicht.

Browserartefakte, Playwright-HTML-Bericht und Owner-Sitzungsdaten liegen unter `tests/e2e/results/` und gehören nicht in den Quellstand.

Echte T3- und OpenAI-Verbindungen bleiben gesonderte Integrationsnachweise und werden nicht aus einem Mock-Lauf abgeleitet.
