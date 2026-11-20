# Falkenwarte QA

Die [Prüfspezifikation](acceptance/ACCEPTANCE.md) ist der aktuell gepflegte Katalog der Abnahmefälle. `requirements.json` ordnet die Konzeptanforderungen zu; die statische Prüfung kontrolliert Kennungen, Referenzen und alle dort gepflegten Pfade.

## Browser- und Qualitätsläufe

Installiere die gesperrten Abhängigkeiten einmal mit `make install`. `make check` führt API- und Architekturprüfung, Symfony-Containerprüfung, PHPStan, PHP-CS-Fixer, Frontendprüfungen, Handbuchprüfung und die erlaubten Background-Funktionstests aus.

`make e2e` baut das produktionsnahe App-Image und startet die isolierte Browserabnahme mit Chromium sowie den T3- und Decisions-Testdiensten. Sie prüft die echte Anwendung über Browser, JSON und MCP, ohne aktive T3- oder OpenAI-Zugänge.

`make plugin-upgrade` prüft Installation, Entfernung, Konfigurationserhalt und Wiederherstellung über getrennte QA- und Produktionsimages. `make qa` führt Installation, `make check`, `make e2e` und `make plugin-upgrade` nacheinander aus.

Für die lokale Bedienung starte `make app-up`; die Anwendung ist standardmäßig unter `https://localhost:8443` erreichbar. `make app-down` stoppt sie und bewahrt die lokalen Datenvolumes. Der Browserlauf mit isolierten Mocks wird über `make e2e` gestartet.

## Lokale und historische Nachweise

Der E2E-Workflow schreibt den bereinigten Browserbericht nach `var/ci-evidence/acceptance.json`. Lokale Laufdaten und generierte QA-Berichte sind ignorierte Arbeitsausgaben; sie werden nicht in das Handbuch geschrieben.

Die Belegaufbereitung erfolgt manuell. `scripts/prepare-traceability-evidence.php` verknüpft einen GitHub-Workflowexport, den bereinigten Browserbericht sowie Produktionsstart und Neustart. Optional kann `--a31=PATH` die getrennten GitHub-Lieferbelege ergänzen. Der Standardausgabepfad ist `var/ci-evidence/verification.json`.

`php scripts/build-traceability.php` erstellt aus dem aktuellen Abnahmekatalog und vorhandenen optionalen Belegen `var/ci-evidence/traceability.md`. Fehlende hosted Belege bleiben offen. Mit `--output=PATH` kannst du den Bericht auch an einem anderen Ort ablegen, etwa unter `/tmp/`.

Abgeschlossene Release-Fakten und ihre damaligen Quellen stehen getrennt und versioniert unter [evidence/](evidence/README.md). Sie sind nicht das Ergebnis eines aktuellen lokalen Laufs.

Für R16 liegen die ursprünglichen Mockups im unveränderlichen [Konzeptstand ef488989152d305de39a11e11b65ef174eae223a](https://github.com/DZunke/Falkenwarte/tree/ef488989152d305de39a11e11b65ef174eae223a/docs), insbesondere in [docs/MOCKUPS.md](https://github.com/DZunke/Falkenwarte/blob/ef488989152d305de39a11e11b65ef174eae223a/docs/MOCKUPS.md).
