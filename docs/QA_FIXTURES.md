# QA-Fixtures und Nachweise

Die Browser- und Schnittstellentests laufen unter `tests/e2e`. Testdaten, Szenarien und externe HTTP-Mocks liegen unter `qa/`. Die Make-Ziele `make e2e` und `make plugin-upgrade` sind die unterstützten lokalen Einstiege.

## Aktive Testdaten

| Pfad | Verwendung |
|---|---|
| `qa/scenarios.json` | Ordnet Browserabläufe den Abnahme-IDs und erwarteten Wirkungen zu. |
| `qa/fixtures/fixture-seed.json` | Optionaler, wiederverwendbarer Owner-Kontext für Szenarien, die ihn ausdrücklich laden. |
| `qa/fixtures/mcp/` | T3-Nachrichten, MCP-Störungen und Eingaben des Agent-Simulators. |
| `qa/fixtures/decisions/` | Native Decisions-Anfragen und Provider-Antworten für erfolgreiche und fehlerhafte Fälle. |
| `qa/mocks/` | Zustandsbehaftete HTTP-Dienste für T3 und Decisions mit beobachtbaren Request-Journals. |
| `tests/e2e/` | Chromium-Szenarien, die die echte Anwendung über Browser, JSON-HTTP und MCP bedienen. |

Ein Szenario lädt den benötigten Owner-Kontext mit `loadOwnerFixtureContext`. Der Fixture-Loader legt die Daten über öffentliche HTTP-Operationen an.

Der QA-Stack hält T3 und Decisions als getrennte HTTP-Dienste außerhalb des PHP-Prozesses. Dadurch prüft ein Test die echte Client- und Anwendungslogik, während Antworten und Fehler kontrolliert bleiben. Unerwartete Mockaufrufe werden aufgezeichnet und können nicht durch einen pauschalen Erfolgsstub verdeckt werden.

`scripts/ci-e2e.sh` startet ein eigenes Compose-Projekt für die Browsersuite. App-Container und beide HTTP-Mocks laufen über mehrere Fälle. Der Browser-Runner fordert den Reset über den Test-Harness auf dem Host an.

Vor jedem Fall beendet der Harness die Prozessgruppe aus FrankenPHP mit Mercure, Messenger-Worker und Wartungsprozess. Sobald alle Prozesse beendet sind, entfernt er SQLite samt Queue und Journaldateien, lokale Backups und den Mercure-Replayverlauf. Die TLS-CA bleibt erhalten. Der reguläre App-Entrypoint startet die Dienste im selben Container. Anschließend richtet der Test über HTTPS einen neuen Eigentümerzugang ein und leert die Journale der T3- und Decisions-Mocks.

Die Fälle für Datenbeständigkeit und verlorenen Hub-Replayverlauf starten den App-Container ausdrücklich neu. Dabei bleiben SQLite und Backups erhalten, während Mercure mit leerem Verlauf startet. Der Produktions-Smoke-Test und die Plugin-Imagewechsel laufen in eigenen Compose-Projekten.

Ein direkter Playwright-Aufruf ohne Kontrollpfad setzt den Appzustand nicht zurück. Für einen reproduzierbaren vollständigen Lauf verwende `make e2e`.

Die Background-Suite unter `tests/BackgroundFunctional` bleibt von den Playwright-Szenarien getrennt. Sie verwendet den echten Symfony-Kernel und echte DBAL-Persistenz für gezielte Prozessabbrüche, Wiederzustellungen und Hintergrundverarbeitung.

## Ergebnisse aufbewahren

Direkte Playwright-Aufrufe schreiben ihren überschreibbaren Debugbericht nach `qa/results.json`. Der isolierte Browserlauf und der Plugin-Image-Upgrade-Lauf schreiben bereinigte lokale Ergebnisse nach `var/ci-evidence/`; dort liegen unter anderem `acceptance.json`, Produktionsstart-Belege und die fünf Plugin-Upgrade-Berichte.

GitHub Actions lädt `acceptance` als kurzlebiges QA-Artefakt hoch. Ein veröffentlichtes Release enthält `image-manifest.json`, `browser-acceptance.tar.gz` und `software-inventory.tar.gz`. Einzelheiten stehen in [GitHub-Prüfungen und Releases](GITHUB_DELIVERY.md).

Der [QA-Einstieg im Repository](../qa/README.md) führt zu den Prüffällen und zum Archiv abgeschlossener Läufe.

Rohberichte, Sitzungsdaten, Traces und Netzwerkmitschnitte können lokale Diagnosedaten enthalten. Zum Teilen eines Ergebnisses nutze die bereinigten Dateien aus `var/ci-evidence/` oder die Artefakte des zugehörigen Laufs.
