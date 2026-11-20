# Architekturentscheidungen

Ein ADR dokumentiert die Begründung einer Architekturentscheidung zum angegebenen Datum. Der Status `accepted` gilt, bis ein späteres ADR die Entscheidung ausdrücklich ablöst.

Die DDD-Seiten und maschinenlesbaren Verträge beschreiben das heutige Fachverhalten. Die ADRs erklären, warum die übergeordneten Architekturgrenzen gewählt wurden.

| ID | Entscheidung | Status |
|---|---|---|
| [ADR-0001](adr/0001.md) | Modularer Monolith und fachliche Grenzen | accepted |
| [ADR-0002](adr/0002.md) | DBAL, SQLite und atomare lokale Änderungen | accepted |
| [ADR-0003](adr/0003.md) | JSON-Vertrag und gemeinsamer Application-Pfad | accepted |
| [ADR-0004](adr/0004.md) | T3 als Ausführungsdienst und Referenzziele | accepted |
| [ADR-0005](adr/0005.md) | Dauerhafte Runs und Abgleich externer Zustände | accepted |
| [ADR-0006](adr/0006.md) | Symfony-AI-Grenze für OpenAI Decisions | accepted |
| [ADR-0007](adr/0007.md) | Labels, Intake und menschliche Verantwortung | accepted |
| [ADR-0008](adr/0008.md) | Link-Collections und zugeordnete Aussagen | accepted |
| [ADR-0009](adr/0009.md) | Mercure als Zustellung von Änderungshinweisen | accepted |
| [ADR-0010](adr/0010.md) | Imagegebundene Plugins mit Laufzeit-Gates | accepted |
| [ADR-0011](adr/0011.md) | E2E-Abdeckung und externe Dienstemocks | accepted |
| [ADR-0012](adr/0012.md) | GitHub-Lieferkette und dokumentierte Entwicklung | accepted, Release-PR-QA durch ADR-0015 präzisiert |
| [ADR-0013](adr/0013.md) | Linux und ein Produktions-Appcontainer | accepted |
| [ADR-0014](adr/0014.md) | Restore mit gesperrten automatischen Starts | accepted |
| [ADR-0015](adr/0015.md) | QA für den Release-Pull-Request | accepted, präzisiert ADR-0012 |
| [ADR-0016](adr/0016.md) | Explizite Provider- und Modellauswahl aus T3 | accepted, ergänzt ADR-0004 |
