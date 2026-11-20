# Wie Falkenwarte Symfony AI nutzt

Falkenwarte setzt Symfony AI an drei Stellen ein. Ein Worker klassifiziert Tickets mit OpenAI Decisions. Der MCP-Server gibt beauftragten Agents Zugriff auf ihre Tickets. Ein separater MCP-Client startet und beobachtet ihre Aufträge in T3.

| Aufruf | Eingesetzte Symfony-Komponenten | Verantwortung von Falkenwarte |
| --- | --- | --- |
| Worker → OpenAI Decisions | AI Bundle, `Platform`, `Provider`, `InMemoryModelCatalog`, `RawHttpResult` und `ObjectResult` | Fragen aus der Projekttaxonomie bilden, das Decisions-Format übersetzen und die Antworten am richtigen Ticketstand anwenden |
| Agent → Falkenwarte | MCP Bundle als HTTP-Server auf `/mcp`, mit Routing, Controller und dem offiziellen PHP-MCP-SDK | Technisches Token prüfen, Werkzeuge passend zu Berechtigungen und aktiven Plugins freigeben und Fachoperationen ausführen |
| Falkenwarte → T3 | `TransportFactory` und `ServerConnection` des MCP Bundle mit einem eigenen SDK-Client je Vorgang | Die hinterlegte T3-Verbindung auswählen, OAuth durchführen und T3-Threads den Aufträgen zuordnen |

## Wie ein Ticket zu einer Decisions-Anfrage wird

Der Worker ruft den Application-Port `DecisionGateway` auf. Dessen Adapter erhält die benannte `PlatformInterface`-Implementierung `ai.platform.openai.decisions` aus dem Symfony-Container. Dahinter stehen eine Symfony-AI-`Platform`, ein `Provider` und ein Katalog mit dem freigegebenen Modell `gpt-6-luna`. Der Dienst trägt das Tag `ai.platform`. [Servicekonfiguration](../config/services.php) · [Adapter](../src/Classification/Infrastructure/SymfonyAiDecisionAdapter.php)

Der eigene `OpenAiDecisionsModelClient` implementiert die Symfony-AI-Schnittstelle für Modellclients. Er löst die Secret-Referenz unmittelbar vor dem HTTP-Aufruf auf und sendet die benannten Fragen an `POST /v1/decisions`. So erhält nur der ausgehende HTTP-Request den Schlüsselwert. Der Konverter liest `answers`, Request-ID, Modell und die vom Anbieter gemeldeten Eingabetokens. Ob eine Antwort die Klassifikation verändern darf, entscheidet der Intake anhand des gespeicherten Ticketstands. [ModelClient](../src/Classification/Infrastructure/OpenAiDecisionsModelClient.php) · [Ergebniskonverter](../src/Classification/Infrastructure/DecisionResultConverter.php) · [Regeln und Konfiguration für Decisions](AI_DECISIONS.md)

## Was beim Containerbau feststeht und was erst beim Aufruf

**Eingehendes MCP.** Pfad, Transport und Protokollversion stehen in der Paketkonfiguration. Welche Werkzeuge ein Agent sieht, bestimmt der registrierte Loader bei der Anfrage. Der Server erhält dafür eine eigene Registry. Bestehende Dateisitzungen und Sperren liegen im Verzeichnis des jeweiligen technischen Principals. Ein Werkzeug ruft über denselben Gateway wie die JSON-API die zuständige Fachoperation auf. [MCP-Konfiguration](../config/packages/mcp.yaml) · [Werkzeugkatalog](../src/Presentation/McpToolCatalogLoader.php) · [Sitzungen](../src/Presentation/McpSessionStorageFactory.php) · [Öffentliche Schnittstellen](API.md)

**Ausgehendes MCP.** Der Eigentümer kann T3-Verbindungen im Dashboard anlegen und neu autorisieren. URL und aktueller Bearer stehen daher erst beim Aufruf fest. Die Session-Factory kombiniert beide mit dem konfigurierten HTTP-Client. Die Bridge liest die angebotenen Werkzeuge seitenweise und schließt die Sitzung nach dem Vorgang. Neue Verbindungen erfordern keinen Containerneubau. OAuth-Discovery, Browser-Anmeldung und Tokenaustausch gehören zum T3-Adapter. [Session-Factory](../src/Orchestration/Infrastructure/T3McpSessionFactory.php) · [T3-Bridge](../src/Orchestration/Infrastructure/T3McpBridge.php) · [T3-Anbindung](T3_INTEGRATION.md) · [Symfony MCP Bundle](https://symfony.com/doc/current/ai/bundles/mcp-bundle.html)

## Paketstand und Grenzen

`symfony/ai-bundle`, `symfony/ai-platform` und `symfony/mcp-bundle` sind auf `1.0.0-BETA1` festgelegt, `mcp/sdk` auf `0.9.0`. Die ebenfalls installierten Bridges `symfony/ai-open-ai-platform` und `symfony/ai-open-responses-platform` bieten in dieser Version keinen Client für den benötigten Decisions-Endpunkt. Deshalb ergänzt Falkenwarte den ModelClient und den Ergebniskonverter. Es gibt keinen Fallback auf die Responses API. Agenten führt T3 aus. Für diesen Ablauf sind weder das Symfony-AI-Agent- noch das Store-Paket eingebunden. [Paketstand](../composer.lock) · [Symfony AI Platform](https://symfony.com/doc/current/ai/components/platform.html)

Die Verdrahtung lässt sich lokal ohne Providerkonto prüfen. `debug:router` zeigt den Bundle-Controller für die öffentliche Route. Die beiden Containerabfragen zeigen die registrierte Decisions-Platform und den Loader für die Werkzeuge.

```sh
php bin/console debug:router _mcp_endpoint_falkenwarte
php bin/console debug:container --tag=ai.platform
php bin/console debug:container --tag=mcp.loader
```
