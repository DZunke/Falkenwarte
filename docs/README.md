# Falkenwarte-Dokumentation

Diese Dokumentation enthält den Fachvertrag aus Konzeptfassung 2.0 und die Bedienungs- und Betriebsanleitungen für die Anwendung. Ob ein Verhalten implementiert und geprüft wurde, steht im [Anforderungs- und Abnahmenachweis](TRACEABILITY.md). Konzeptbeschreibung, vorhandener Code und bestandene E2E-Abnahme sind getrennte Aussagen.

## Einstieg

| Anliegen | Dokument |
|---|---|
| Produktumfang und Zuständigkeiten | [Produktkonzept](PRODUCT_CONCEPT.md) |
| Projekte, Tickets, Rückfragen und Links bedienen | [Benutzerhandbuch](USER_GUIDE.md) |
| Begriffe und Modulverantwortung | [Glossar](domain/GLOSSARY.md), [Bounded Contexts](domain/BOUNDED_CONTEXTS.md), [Context Map](domain/CONTEXT_MAP.md) |
| Zustandsübergänge nachvollziehen | [Lebenszyklen](domain/LIFECYCLES.md) |
| Ereignisse und Objektgeschichte einordnen | [Ereigniskatalog](domain/EVENTS.md) |
| Architekturentscheidungen prüfen | [ADR-Index](DECISIONS.md) |
| Decisions- und T3-Grenzen verstehen | [OpenAI Decisions](AI_DECISIONS.md), [T3-Integration](T3_INTEGRATION.md) |
| Plugins und Live-Updates verstehen | [Plugin-System](PLUGIN_SYSTEM.md), [Mercure](LIVE_SERVICES.md) |
| API, MCP und Schemas nutzen | [Verträge](../contracts/README.md) |
| Testläufe und Ergebnisse prüfen | [Teststrategie](TESTING.md), [Fixture- und Mockprofil](QA_FIXTURES.md), [Abnahmeplan](ACCEPTANCE.md), [Traceability](TRACEABILITY.md), [Prüfergebnisse](VALIDATION.md) |
| Linux-Installation und Wiederherstellung | [Betrieb](OPERATIONS.md) |
| Entwicklung und Releases | [GitHub und Releases](GITHUB_DELIVERY.md) |
| Fachtexte aktuell halten | [Dokumentationspflege](DOCUMENTATION.md), [Quellen](SOURCES.md) |

## Verbindliche Quellen

Konzept und Domain-Dokumente erklären Fachregeln. `contracts/openapi.yaml` und `contracts/mcp-tools.json` definieren öffentliche Formen. Die Abnahmefälle beschreiben beobachtbares Produktverhalten. Bei Widersprüchen wird die Fachregel, der Vertrag und der Abnahmefall gemeinsam korrigiert.

Die Architekturentscheidungen in `adr/` gelten als gewählte Richtung. Ihre Umsetzung wird erst durch konkrete Dateien, statische Prüfungen und Abnahmen nachgewiesen. Der [Traceability-Bericht](TRACEABILITY.md) hält diese Nachweise pro Anforderung fest.

## Dokumentationsstatus

Die Konzept- und Architekturtexte sind normative Vorgaben. Benutzer- und Betriebsanleitungen beschreiben den gelieferten Funktionsumfang und werden nach Browser- und Betriebsläufen mit echten Ergebnissen aktualisiert. Der Build veröffentlicht ausschließlich versionierte Dokumentdateien aus diesem Verzeichnis.
