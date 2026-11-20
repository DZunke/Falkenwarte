# Falkenwarte-Handbuch

In Falkenwarte bündelt ein Ticket die Arbeit an einer Aufgabe. Es gehört zu einem Projekt und kann von dir selbst oder mit einem Agent bearbeitet werden. Welchen nächsten Schritt ein Ticket braucht, siehst du an seinen Kriterien, Rückfragen und offenen Entscheidungen.

## Falkenwarte benutzen

- [Ein Projekt und das erste Ticket anlegen](user/PROJECTS_AND_TICKETS.md)
- [Eine Agentenmeldung einordnen und Rückfragen klären](user/INTAKE_AND_DECISIONS.md)
- [Den Falkenwarte-Skill für Agents im eigenen Projekt installieren](user/AGENT_SKILL.md)
- [Eine Agentrolle einsetzen und einen Workflow begleiten](user/AGENTS_AND_WORKFLOWS.md)
- [Metriken und ihre Herkunft lesen](user/METRICS.md)
- [Alle Bedienungsanleitungen](USER_GUIDE.md)

## Eine Installation betreiben

- [Die Anwendung starten und konfigurieren](operations/DEPLOYMENT_AND_CONFIGURATION.md)
- [Einem Agenten Zugriff auf ein Projekt geben](operations/ACCESS.md)
- [Daten sichern und eine Sicherung wiederherstellen](operations/BACKUP_AND_RESTORE.md)
- [Betrieb und Fehlerdiagnose](OPERATIONS.md)

## Das Fachmodell verstehen

| Frage | Wo du die Antwort findest |
| --- | --- |
| Was unterscheiden Ticket, Action und Run? | [Glossar](domain/GLOSSARY.md) |
| Welches Modul entscheidet über eine Änderung? | [Verantwortung der Fachkontexte](domain/BOUNDED_CONTEXTS.md) |
| Welche Informationen tauschen die Kontexte aus? | [Context Map](domain/CONTEXT_MAP.md) |
| Wann darf ein Ticket oder ein Run abgeschlossen werden? | [Lebenszyklen und Übergänge](domain/LIFECYCLES.md) |
| Was lässt sich aus einem Ereignis ablesen? | [Ereignisse und Objektgeschichte](domain/EVENTS.md) |

## Entwickeln und integrieren

- [Architektur und Weg eines Schreibzugriffs](ARCHITECTURE.md) · [Entscheidungen zur Architektur](DECISIONS.md)
- [HTTP, MCP und öffentliche Schemas](API.md) · [T3-Anbindung](T3_INTEGRATION.md) · [OpenAI Decisions](AI_DECISIONS.md) · [Symfony AI einsetzen](SYMFONY_AI.md)
- [Plugins entwickeln](PLUGIN_SYSTEM.md) · [Live-Updates mit Mercure](LIVE_SERVICES.md)
- [Änderungen prüfen](TESTING.md) · [Fixtures und externe Testdienste](QA_FIXTURES.md)
- [Pull Requests und Releases](GITHUB_DELIVERY.md) · [Das Handbuch bearbeiten](DOCUMENTATION.md)
