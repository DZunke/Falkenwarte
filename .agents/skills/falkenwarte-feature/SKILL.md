---
name: falkenwarte-feature
description: Ändere eine Fachregel oder öffentliche Operation im Falkenwarte-Quellbaum. Nutze diesen Skill für Modulgrenzen, Symfony-DI, DBAL und den Weg vom OpenAPI-Vertrag zum React-Client.
---

# Eine Funktion in Falkenwarte ändern

## Zuständigkeit und Verdrahtung

Ordne die Regel einem Fachkontext zu. Ein Application-Port im aufrufenden Kontext beschreibt, was dieser von einem anderen Modul braucht. So definiert AgentCatalog den Port für betroffene Runs, Orchestration implementiert ihn. Für eine separat aktivierbare Fähigkeit zeigen die Linknotizen den Weg über Manifest, Migration, UI-Beitrag und MCP-Werkzeug. [Context Map](../../../docs/domain/CONTEXT_MAP.md) · [RunImpactPort](../../../src/AgentCatalog/Application/RunImpactPort.php) · [Linknotizen](../../../packages/link-notes/manifest.json)

Injiziere Abhängigkeiten im Konstruktor. Der Symfony-Container erkennt `OperationHandler` und Pluginverträge anhand ihrer Interfaces. Für einen DBAL-Adapter kann `#[AsAlias]` den Application-Port an die Implementierung binden. Benannte Clients und skalare Werte erhalten ihren konkreten Dienst oder Parameter über `#[Autowire]`. [Servicekonfiguration](../../../config/services.php) · [Beispiel für einen Adapter](../../../src/Orchestration/Infrastructure/DbalTaskFlowReader.php)

Lege sichere gemeinsame Konfigurationswerte in `.env` ab, lokale Überschreibungen in `.env.local`. Löse Umgebungsvariablen im Container auf und reiche dem Service den typisierten Wert. Ein neuer Schalter braucht so keinen `getenv()`-Aufruf im Fachcode. [Umgebung](../../../.env) · [Konfigurationsparameter](../../../config/packages/falkenwarte.yaml)

## Persistenz und öffentlicher Vertrag

Fasse zusammengehörige Schreibvorgänge mit `Store::atomic()` zusammen, damit Objektstand, Journal und auszuliefernde Ereignisse gemeinsam wirksam werden. Führe externe Provideraufrufe außerhalb der SQLite-Schreibtransaktion aus. Für eine gefilterte Lesesicht eignet sich ein DBAL-Reader hinter einem Port, wie bei der Abfrage nach Projekt und Ticket. [Store](../../../src/Shared/Infrastructure/DbalStore.php) · [TaskFlowReader](../../../src/Orchestration/Application/TaskFlowReader.php)

Beschreibe neue HTTP-Operationen in OpenAPI mit Ein- und Ausgabe, Zugriff und Schreibbedingungen. Der RouteLoader erzeugt die Routen. Für ein benötigtes MCP-Werkzeug verweist der Toolkatalog auf dieselbe Operation. So durchlaufen beide Einstiege denselben Gateway und Application-Handler. Eine reine Eigentümeransicht wie `task_flow_get` braucht keinen MCP-Eintrag. [OpenAPI](../../../contracts/openapi.yaml) · [MCP-Katalog](../../../contracts/mcp-tools.json) · [Gateway](../../../src/Presentation/Gateway.php)

Erzeuge nach Vertragsänderungen die React-Typen mit `npm --prefix frontend run generate:api` und nimm die generierte Änderung in denselben Commit auf. `make frontend-check` regeneriert die Typen und meldet Abweichungen zum Git-Index. [Generierter Clientvertrag](../../../frontend/src/generated/api.ts)

Für Modulgrenzen, DI und öffentliche Verträge gibt es `make architecture`, `make container` und `make contracts`. `make format-check` und `make phpstan` prüfen den PHP-Code. Für den beobachtbaren Nutzerablauf wähle den passenden Test aus dem [QA-Skill](../falkenwarte-qa/SKILL.md).
