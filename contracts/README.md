# Öffentliche Verträge

Diese Dateien beschreiben die Schnittstellen, über die Falkenwarte JSON-HTTP und MCP anbietet. Für Aufrufe, Authentifizierung, Ticket-Eingang, Wiederholungen und Links siehe das [Integrationshandbuch](../docs/API.md).

## Ressourcen

| Datei | Wofür sie gedacht ist |
|---|---|
| [openapi.yaml](openapi.yaml) | HTTP-Endpunkte, JSON-Eingaben und -Antworten, Authentifizierung und Versionsregeln |
| [mcp-tools.json](mcp-tools.json) | MCP-Tools, Eingabeschemas, erforderliche Fähigkeiten und die jeweilige HTTP/Application-Zuordnung |
| [Ticket-Receipt](schemas/ticket-receipt.schema.json), [Link-Collections](schemas/task-links.schema.json), [Ereignishülle](schemas/event-envelope.schema.json) | JSON-Schemas für häufige HTTP- und MCP-Antworten |
| [Intake-Rückfrage](examples/intake-needs-information.json), [Link-Collections](examples/task-link-collections.json), [Task-Move](examples/task-moved.json) | Beispielpayloads zu den öffentlichen Schemas |

## Lokale Prüfung

Führe `make contracts` im Repository aus, um OpenAPI-Referenzen, MCP-Zuordnungen, Eingabeschemas, Beispiele und Anforderungs-/Abnahmeverweise zu prüfen.

Die Prüfung validiert die Vertragsdateien lokal; sie ruft weder eine laufende Falkenwarte-Instanz noch T3 oder einen Decisions-Provider auf. Der [QA-Einstieg](../qa/README.md) beschreibt die Produktläufe.
