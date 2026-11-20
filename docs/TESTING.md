# Lokal entwickeln und testen

Mit `make check` prüfst du eine Änderung im Checkout. Mit `make e2e` prüfst du sie im gestarteten App-Image.

## Installation und Dokumentation

Installiere auf einem frischen Checkout die PHP- und Node-Abhängigkeiten aus den Lockdateien.

```bash
make install
```

Wenn du nur am Handbuch arbeitest, genügen die PHP-Abhängigkeiten und der Dokumentationsbau.

```bash
make php-deps
make docs
```

`make docs` prüft die lokalen Links und baut das Handbuch nach `public/docs/`.

`make docs-serve` startet anschließend eine lokale Vorschau unter `http://127.0.0.1:8081/docs/`. Den Port kannst du mit `DOCS_PORT` ändern. `make help` listet alle verfügbaren Make-Ziele.

## Lokale Anwendung

Starte die Anwendung mit `make app-up`, verfolge ihre Logs mit `make app-logs` und stoppe sie mit `make app-down`. Das Stoppen bewahrt die lokalen Datenvolumes.

## Qualitäts- und Funktionstests

`make format-check` prüft den PHP-Stil mit PHP-CS-Fixer, und `make format` wendet die Regeln an. `make static` führt zusätzlich Vertrags-, Architektur-, Container-, PHPStan- und Frontend-Prüfungen aus.

`make check` fasst `static`, `docs` und `background` zusammen. Die Background-Suite unter `tests/BackgroundFunctional` startet den echten Symfony-Kernel und prüft die gezielte Wiederzustellung und Verarbeitung von Hintergrundaufträgen.

## Browser-QA

`make e2e` baut das produktionsnahe App-Image, startet App und zustandsbehaftete T3- und Decisions-Mocks einmal pro Playwright-Suite und prüft die öffentlichen Browser-, JSON- und MCP-Schnittstellen mit Chromium und Playwright. Der [Fixture-Reset](QA_FIXTURES.md) gibt jedem Fall einen frischen Zustand im laufenden App-Container.

`make plugin-upgrade` prüft den Plugin-Lebenszyklus über die Test- und Produktionsimages und erstellt Berichte für `plans`, `prepare`, `verify`, `readback` und `verify-after-readback`.

`make qa` installiert Abhängigkeiten und führt `check`, `e2e` und `plugin-upgrade` aus. Der vollständige Lauf benötigt Docker Compose.

`make clean` entfernt die generierten Frontend- und Handbuchdateien aus `public/`. Es löscht weder Datenvolumes noch Abhängigkeiten oder QA-Nachweise.

## Testergebnisse und Grenzen

Ein direkter Playwright-Lauf schreibt den Debugbericht nach `qa/results.json`. Der nächste Lauf überschreibt ihn. `make e2e` und `make plugin-upgrade` erzeugen bereinigte lokale Belege unter `var/ci-evidence/`. Git ignoriert diese Ausgaben.

Ein erfolgreicher Mock-Lauf prüft die vereinbarten Protokolle und das Verhalten der Anwendung gegenüber den Testdiensten. Er belegt keinen Zugriff auf eine private T3-Instanz oder ein produktives OpenAI-Konto. Weitere Details stehen in [QA-Fixtures und Nachweise](QA_FIXTURES.md) und im [GitHub-Prüf- und Releaseablauf](GITHUB_DELIVERY.md).
