# Architekturentscheidungen

**Status:** Für Konzeptfassung 2.0 entschieden; Implementierungsnachweise sind noch offen. **Datum:** 19. November 2026.

Jedes ADR beschreibt eine konkrete Richtungsentscheidung. Eine spätere Änderung erhält ein neues ADR und verweist auf das ersetzte Dokument. Implementierungsdetails können innerhalb dieser Grenzen fortentwickelt werden.

| ID | Entscheidung | Status |
|---|---|---|
| [ADR-0001](adr/0001.md) | Modularer Monolith und fachliche Grenzen | accepted |
| [ADR-0002](adr/0002.md) | DBAL, SQLite und atomare History | accepted |
| [ADR-0003](adr/0003.md) | JSON-Vertrag und gemeinsamer Application-Pfad | accepted |
| [ADR-0004](adr/0004.md) | T3 führt aus; Falkenwarte referenziert Ziele | accepted |
| [ADR-0005](adr/0005.md) | Dauerhaftes Ping-Pong mit Abgleich | accepted |
| [ADR-0006](adr/0006.md) | OpenAI Decisions über eine Symfony-AI-Erweiterung | accepted |
| [ADR-0007](adr/0007.md) | Labels, Intake und menschliche Verantwortung | accepted |
| [ADR-0008](adr/0008.md) | Link-Collections und klar zugeordnete Aussagen | accepted |
| [ADR-0009](adr/0009.md) | Mercure meldet Änderungen nach Commit | accepted |
| [ADR-0010](adr/0010.md) | Plugins werden gebaut und zur Laufzeit geschaltet | accepted |
| [ADR-0011](adr/0011.md) | E2E als Produktabdeckung und echte Verkehrsmocks | accepted |
| [ADR-0012](adr/0012.md) | GitHub-Lieferkette und dokumentierte Entwicklung | accepted |
| [ADR-0013](adr/0013.md) | Linux und ein Produktionscontainer | accepted |
| [ADR-0014](adr/0014.md) | Restore sperrt neue automatische Ausführung | accepted |
| [ADR-0015](adr/0015.md) | QA für den Release-Pull-Request | accepted |

## Noch praktisch nachzuweisen

M0 prüft Paketauflösung einschließlich der Symfony-AI-Erweiterungsstelle, tatsächlich gewählte MCP-Protokollrevision, kanonische TLS-/OAuth-Adressen, den T3-Zielstand und die im Image geladenen Mercure-/SQLite-Versionen. Der E2E-Ausbau bestätigt danach die fachlichen und betrieblichen Regeln. Kein ADR behauptet einen bereits ausgeführten Lauf.

## Entscheidungsänderung

Neue Fakten werden mit Quelle und betroffenem Vertrag dokumentiert. Beispiel: Sobald die native Symfony-AI-Decisions-Unterstützung passend veröffentlicht ist, kann ein Folge-ADR den Kompatibilitätsadapter ablösen. Die Domain und die HTTP-E2E-Fixtures bleiben dabei maßgeblich.
