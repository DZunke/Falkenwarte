# Das Handbuch bearbeiten

Ändere die Anleitung im selben Branch wie die Bedienhandlung, Fachregel oder Betriebsanweisung. Damit können andere den neuen Ablauf bereits beim Review ausprobieren.

## Die richtige Seite finden

| Was hat sich geändert? | Wo wird es beschrieben? |
| --- | --- |
| Was jemand am Bildschirm tun kann | Die Aufgabe mit den sichtbaren Bezeichnungen im [Benutzerhandbuch](USER_GUIDE.md) erklären. |
| Bedeutung eines Begriffs oder Verantwortung für eine Regel | Begriff im [Glossar](domain/GLOSSARY.md) definieren, Zuständigkeit bei den [Fachkontexten](domain/BOUNDED_CONTEXTS.md) nachführen. |
| Übergang, Rückfrage oder Abschlussbedingung | Auslöser, Voraussetzung und Ergebnis am betroffenen [Lebenszyklus](domain/LIFECYCLES.md) beschreiben. Bei einem Übergang über Kontextgrenzen auch die [Context Map](domain/CONTEXT_MAP.md) prüfen. |
| Öffentliche Eingaben, Antworten oder Ereignisse | Den jeweiligen Vertrag ändern, etwa [OpenAPI](../contracts/openapi.yaml) oder den [MCP-Katalog](../contracts/mcp-tools.json). Im [Leitfaden für Integratoren](API.md) die Bedeutung für bestehende Clients erklären. |
| Installation, Konfiguration oder Wiederherstellung | Die ausführbaren Schritte im [Betriebshandbuch](OPERATIONS.md) anpassen. |
| Eine Architekturentscheidung mit bleibenden Konsequenzen | Entscheidung und Gründe im [ADR-Verzeichnis](DECISIONS.md) festhalten. Wird eine Entscheidung ersetzt, auf ihren Nachfolger verweisen. |

Ändert sich zum Beispiel die Bedingung für den Abschluss eines Tickets, gehört die Antwort auf „Wann darf ich abschließen?“ zur Ticketanleitung und zum Lebenszyklus von WorkManagement. Wie dieser Übergang in der Oberfläche getestet wird, gehört zum entsprechenden Browserfall. Ein Testergebnis mit Datum und Commit gehört zum Prüflauf.

## Lokal lesen und prüfen

Vom Repository-Stamm aus reichen PHP und die installierten Composer-Abhängigkeiten für das Handbuch. `make php-deps` installiert sie auf einem frischen Checkout. Starte anschließend die lokale Vorschau.

```sh
make docs-serve
```

Öffne [das lokale Handbuch](http://127.0.0.1:8081/docs/). Mit `Strg+C` beendest du die Vorschau. Nach Textänderungen genügt `make docs` in einem zweiten Terminal und ein Neuladen im Browser. Zum Ändern des Ports verwende beispielsweise `make docs-serve DOCS_PORT=8082`.

Auch ohne Vorschau prüft `make docs` die Quellen und baut die statischen Seiten unter `public/docs/`. Das Docker-Image liefert diesen Bau unter `/docs/` aus. Für die Arbeit am Handbuch brauchst du weder eine laufende Anwendungsinstanz noch Zugang zu externen Diensten oder eine veröffentlichte Version. [Build-Skript](../scripts/build-docs.php)

## Quellen und Prüfnachweise ablegen

- `docs/` enthält das Handbuch. Schreibe jeden Absatz auf eine Quellzeile, verwende relative Markdown-Links und verlinke eine neue Seite dort, wo Leser ihre Aufgabe beginnen. Generierte HTML-Dateien bleiben lokal.
- `.notes/` ist der ignorierte Ort für persönliche Entwürfe, Recherche und Arbeitspläne. Übernimm eine dort erarbeitete Erkenntnis in die passende Handbuchseite, sobald sie das Verhalten des Projekts beschreibt.
- `qa/` enthält reproduzierbare Prüfdefinitionen und ausgewählte historische Belege. Einzelne Läufe schreiben ihre Ergebnisse in die dafür vorgesehenen Ausgabeverzeichnisse. Ein Release oder eine nachträgliche Belegpflege ist keine Voraussetzung für eine Handbuchänderung. [QA im Repository](../qa/README.md)
