# Context Map und gerichtete Verträge

Die Tabelle beschreibt die heute vorhandenen Abhängigkeiten zwischen Modulen. Jede Zeile nennt den Aufrufer, den Vertrag und die Wirkung beim Empfänger.

## Gerichtete Beziehungen

| Von | Nach | Vertrag und Wirkung |
|---|---|---|
| HTTP- oder MCP-Einstieg | `Presentation\Gateway` | Beide Einstiege leiten API-Aufrufe an denselben Gateway. Er prüft OpenAPI-Vertrag, Akteur, Capability, Pluginvoraussetzung, Idempotenzschlüssel und `If-Match`, wenn die jeweilige Operation diese Angaben verlangt. Anschließend wählt er einen registrierten `OperationHandler`. |
| WorkManagement | Classification | `WorkHandler` ruft bei technischen Eingängen, manueller Klassifikation und geänderten technischen Aufgaben `WorkManagement\Application\TaskIntake` auf. `IntakeHandler` implementiert diesen Port und legt Intake sowie Bewertungsauftrag an. |
| Classification | OpenAI Decisions | `DecisionGateway` ist der Application-Port. `SymfonyAiDecisionAdapter` ruft die native Symfony-AI-Platform auf. `OpenAiDecisionsModelClient` ergänzt den fehlenden Decisions-Transport und `DecisionResultConverter` bildet `answers` auf ein Symfony-AI-Ergebnis ab. |
| Orchestration | AgentCatalog | `RunHandler` fragt über `AgentCatalogReader` Agentprofile, Projektbindung, Verbindung, Providerverfügbarkeit und Anmeldezustand ab. |
| Orchestration | Automation | `RunHandler` verwendet `WorkflowPolicy`, um Definitionen zu validieren und den nächsten Übergang auszuwählen. Orchestration speichert die Workflowdefinitionen und -instanzen. |
| Orchestration | WorkManagement | Hat eine Phase ein Boardziel, lässt Orchestration das Ticket beim Eintritt in diese Phase verschieben. WorkManagement prüft Board, Zielspalte und WIP-Grenzen. Der nächste Agent erhält die Aufgabenrevision nach dem Spaltenwechsel. |
| AgentCatalog | T3 MCP | `connection_providers_list` fragt die autorisierte T3-Verbindung bei der Zielauswahl nach den verfügbaren Providerinstanzen und ihren Modellen. Falkenwarte speichert nur die ausgewählten Instanz- und Modellreferenzen, nicht die Providerkonfiguration. |
| Orchestration | T3 MCP und OAuth | `AgentExecutionBridge` und `T3OAuthClient` sind Application-Ports. `T3McpBridge` und `T3OAuthAuthenticator` übersetzen T3-Antworten und Identitäten in Falkenwarte-Datensätze. |
| Extensions | Capability-Nutzer | `PluginRegistry` stellt Manifeste und Pluginzustände bereit. `PluginAvailability` gibt Beiträge und MCP-Werkzeuge nur frei, wenn Plugin und Abhängigkeiten aktiviert sind. |
| Extensions | Orchestration | Beim Drain verwendet `PluginHandler` `ProviderRunDrainPort`, um laufende oder offene Arbeit des Providers abzufragen. Die Drainpolicy kann außerdem einen Abbruch anfordern. |
| Application-Handler | Shared | Handler lesen und ändern typisierte Datensätze über `Shared\Application\Store`. Application-Ports importieren weder DBAL noch SQL. |
| DbalStore | Live und Browser | `DbalStore` legt für unterstützte Ressourcen einen UI-Änderungshinweis in `events.change_json` ab. `Live::publish()` versendet offene Hinweise privat über Mercure. Der Browser lädt danach die autoritative JSON-Ressource erneut. |
| Metrics | Shared-Ereignisjournal | `MetricsHandler` liest gespeicherte Aufgaben, Runs und Ereignisse für Dashboard und Messwerte. Ein Rebuild schreibt Projektionen, stellt aber keine Agentenaufträge zu. |

## Ablauf einer Änderung

Eine mutierende HTTP- oder MCP-Operation wird im `Gateway` gegen OpenAPI geprüft und erhält eine Action-ID. Der Gateway prüft Versions- und Idempotenzbedingungen vor dem Aufruf des zuständigen Handlers.

Der Handler prüft Projektbereich und fachliche Voraussetzungen und ändert Datensätze innerhalb einer gemeinsamen `Store::atomic()`-Grenze. Für registrierte Datensatztypen entstehen in derselben lokalen Transaktion Revisionen und Journalereignisse.

Wenn Folgearbeit nötig ist, schreibt der Handler einen Auftrag in `commands` und gibt eine Annahme mit Action- oder Ressourcenreferenz zurück. `Consumer` prüft den `inbox`-Marker und leitet den Auftrag anhand seines Präfixes an den zuständigen Worker weiter.

Der Worker führt lokale Verarbeitung in einer Transaktion aus. Für externe Arbeit ruft er den jeweiligen Adapter außerhalb der SQLite-Schreibtransaktion auf. Bei T3 werden Start, Beobachtung und Meldung als getrennte Schritte gespeichert und abgeglichen.

Der Gateway beendet die Action nach der lokalen Verarbeitung, wenn kein Hintergrundauftrag offen ist. Andernfalls beendet der Consumer die Action nach Abschluss der Aufträge oder markiert sie nach einem endgültigen Workerfehler als `failed`.

## Daten- und Integrationsgrenzen

Application-Handler verwenden gemeinsam gespeicherte Datensatztypen und veröffentlichte Application-Ports. `Store` kapselt den Persistenzzugriff. Die Anwendung besitzt für jede Ressource keine eigene Repositoryklasse.

Ein Domain- oder Action-Ereignis beschreibt eine lokale Änderung. Ein UI-Hinweis fordert den Client zum Neuladen einer Ressource auf. Ein Eintrag in `commands` fordert einen Worker zur Arbeit auf.

Die Anwendung speichert Aufgabenlinks als URLs. Sie fragt die Ziele weder ab noch synchronisiert sie Status aus Issue-, Pull-Request-, CI- oder Repositorydiensten.

T3 führt die Agentenaufträge aus. Falkenwarte speichert Bindungen, Profile, Runs, Berichte und Beobachtungen, die es zur Zuordnung und zum Abgleich verwendet.

Die öffentlichen JSON- und MCP-Formen stehen in [OpenAPI](../../contracts/openapi.yaml), [MCP-Werkzeugen](../../contracts/mcp-tools.json) und den [versionierten Ereignisschemas](../../contracts/schemas/event-envelope.schema.json).
