# QA-Bausteine für die Umsetzung

Dieses Dokument beschreibt deterministische Fixtures und externe Traffic-Mocks. Der ausführbare Playwright-Harness liegt unter `tests/e2e`; seine echten Ergebnisse stehen in `qa/results.json` und [VALIDATION.md](VALIDATION.md). Die `falkenwarte.qa.*`-Formate beschreiben ausschließlich projektspezifische Testdaten; eingebettete HTTP-/JSON-RPC-Nachrichten halten sich an die jeweiligen externen Protokolle.

Die verbindlichen Regeln stehen in [Teststrategie](TESTING.md), die fachlichen Ergebnisse in [Abnahme](ACCEPTANCE.md). Eine statische Fixture-Prüfung ersetzt keinen E2E-Lauf.

## Inhalt

| Datei | Zweck |
|---|---|
| `fixture-seed.json` | Referenz-Ausgangslage für geplante Szenarien; der aktuelle Playwright-Runner lädt diese Datei noch nicht |
| `scenarios.json` | Katalog von 22 geplanten E2E-Szenarien mit Abnahme-IDs und externen Störungen; ausgeführte Fälle stehen separat in `qa/results.json` |
| `fixtures/mcp/t3-legacy-session.json` | Konkreter Legacy-Handshake, Toolkatalog, Launch, Wait und Sessionende |
| `fixtures/mcp/t3-faults.json` | 12 zustandsbehaftete Störfälle und die erforderlichen Zustandsübergänge des T3-Testdiensts |
| `fixtures/mcp/agent-intake.json` | Agent legt ein Ticket am echten MCP-Endpunkt an, verfolgt es und ergänzt Angaben/Links |
| `fixtures/mcp/early-agent-report.json` | Echter eingehender Agentbericht, während die externe Launch-Antwort zurückgehalten wird |
| `fixtures/decisions/intake-request.json` | Native Anfrage an `/v1/decisions` mit `input_json`, `predicate` und `choice` |
| `fixtures/decisions/intake-responses.json` | Sieben Antwort-/Fehlervarianten des externen Decisions-Diensts |
| `github/` | Noch nicht aktivierte Repository- und Release-Please-Vorlagen |

## Aktueller Harness und seine Grenzen

Der Browser- und Schnittstellenrunner liegt in `tests/e2e`; die externe T3- und Decisions-Kommunikation übernehmen die Node-Dienste aus `qa/mocks`. `compose.test.yaml` beschreibt ein isoliertes App-/Mock-/Runner-Profil mit internem Netzwerk, und `scripts/ci-e2e.sh` startet dieses Profil mit eigenem Compose-Projektnamen und Datenvolume. Dieser Compose-Lauf ist noch nicht als ausgeführt belegt; der aktuelle direkte Playwright-Lauf gegen lokal gestartete Prozesse steht in [VALIDATION.md](VALIDATION.md).

Die tatsächlichen Tests erzeugen ihre Anwendungsdaten über öffentliche JSON-/MCP-Aufrufe. `fixture-seed.json` ist vorhanden, wird vom aktuellen Runner aber nicht eingelesen. Die T3- und Decisions-Mocks lesen ihre jeweiligen Protokoll- und Antwortfixtures direkt und protokollieren angenommene Wirkungen.

Playwright ist auf einen Chromium-Worker begrenzt. Ein Compose-Lauf erhält ein eigenes Datenvolume und Mockprozesse; der direkte lokale Lauf verwendet hingegen den vorhandenen lokalen App-/Mockzustand und ist kein Nachweis der Isolation durch Compose. Die derzeitige Playwright-Konfiguration lädt keine statische Seed-Datei und setzt die externen Mockdienste nicht zwischen beliebigen Testfällen zurück.

Die Mockdienste werden nur in den QA-Imagezielen gebaut; das App-Testprofil erlaubt die festgelegten internen Mockadressen und verwendet nicht produktive Schlüssel. Der Produktionsbuild enthält die Mockserver nicht. Ein erfolgreiches Mock-Szenario belegt weder einen echten T3-Handshake noch den Zugriff auf ein produktives OpenAI-Konto.

## Ausgehendes T3-MCP

Die konkreten Nachrichten nutzen **MCP 2025-06-18**. Der Legacy-Client sendet `initialize`, übernimmt die vom Server ausgestellte Session-ID, sendet `notifications/initialized` und fragt die Werkzeuge ab. Spätere Nachrichten tragen den vereinbarten Protokollheader und die Session-ID. Der Mock spiegelt die jeweils eingegangene JSON-RPC-ID; die Zahlen in der Beispieldatei sind keine fest verdrahteten IDs des späteren Clients.

Die Basisdatei zeigt das kleinste benötigte T3-Teilprofil für Launch und Wait. Sie ist kein vollständiger Export aller T3-Werkzeuge. Weitere tatsächlich eingesetzte Werkzeuge werden bei der Implementierung aus dem gepinnten T3-Vertrag ergänzt. Nicht implementierte oder unerwartete Aufrufe schlagen fehl und erscheinen im Journal; es gibt keinen generischen Erfolg für beliebige Toolnamen.

Das optionale Feld `modelSelection` wird im Launch-Request bewusst nicht gesendet. T3 erbt seine vorhandene Konfiguration. Die entsprechenden Pflichtfelder im nativen Launch-Ergebnis sind Fixture-Metadaten und keine neue Modellkonfiguration in Falkenwarte.

`content[].text` enthält beim erfolgreichen Toolergebnis denselben JSON-Inhalt wie `structuredContent`. Der Störfall einer widersprüchlichen Antwort dient der Absicherung des Adapters. Ein Transportfehler, ein JSON-RPC-Fehler und ein Toolergebnis mit `isError:true` bleiben unterscheidbar. Ein `timedOut:true` beim Wait bedeutet dagegen nicht automatisch einen fehlgeschlagenen externen Run.

Die Dateien beruhen auf dem T3-Stand `v0.1.10` und dessen nativen Verträgen: [HTTP-Transport](https://github.com/pingdotgg/t3code/blob/v0.1.10/apps/server/src/mcp/McpHttpServer.ts), [Transportnachweise](https://github.com/pingdotgg/t3code/blob/v0.1.10/apps/server/src/mcp/McpHttpServer.test.ts), [Launch-Werkzeug](https://github.com/pingdotgg/t3code/blob/v0.1.10/apps/server/src/mcp/toolkits/project/tools.ts), [Thread-/Run-Verträge](https://github.com/pingdotgg/t3code/blob/v0.1.10/packages/contracts/src/orchestratorMcp.ts).

Das ebenfalls vorhandene T3-Profil `2026-07-28` hat einen anderen Lebenszyklus mit `server/discover`. Es wird nicht mit diesen Legacy-Nachrichten behauptet. M0 bestätigt den konfigurierbaren Dialekt des Symfony-MCP-Clients. Erst ein eigener bestätigter Fixture-Satz erlaubt einen Wechsel des Profils.

## Zustandsbehafteter Ausfall und frühe Rückmeldung

Beim Fall `lost_reply_after_accept` speichert der Mock zunächst den extern angenommenen Launch einschließlich Thread-/Run-Identität und anfänglichem Laufzustand dauerhaft. Erst danach bricht er die Verbindung ab. Ein Neustart von Falkenwarte und des Mockprozesses erhält diesen externen Datensatz. Der wiederholte Aufruf mit demselben Auth-Namespace und `clientRequestId` liefert dieselben Thread-/Run-IDs mit dem zu diesem Zeitpunkt aktuellen Laufstatus. Die ursprüngliche Antwort wird nicht als unveränderlicher Status-Snapshot wiedergegeben. Das Journal muss genau eine externe Wirkung belegen.

Die Nutzlast bleibt durch Falkenwartes persistierte Dispatch-Identität unverändert. Ein Payload-Hash wird nicht als zusätzliche, unbelegte T3-Garantie in den Mock hineingeschrieben. Der Mock darf eine abweichende Nutzlast journalisieren; die Falkenwarte-Abnahme muss zeigen, dass sie gar nicht erneut gesendet wird.

`qa-t3-token-A` und `qa-t3-token-B` stehen für zwei verschiedene OAuth-Namespaces. Eine neu ausgehandelte MCP-Session unter Token A erhält dagegen dieselbe externe Idempotenzgrenze. Beim Wechsel zu Token B verhindert Falkenwarte einen blinden Neustart ungeklärter Arbeit.

Für `report_before_launch_reply` hält der Harness die Launch-Antwort zurück und lässt den Agent-Simulator `runs_report_result` auf Falkenwartes echtem `/mcp` aufrufen. Der lokale Run existiert zu diesem Zeitpunkt bereits. Der Rückweg nutzt einen zum Auftrag passenden technischen Zugang und dessen tatsächlichen Übergabekontext. Dies ist **kein angenommener T3-Webhook**.

## Eingehendes Agent-MCP

`agent-intake.json` beschreibt Aufrufe an die echte Anwendung. Die Felder `response_example` dienen der Lesbarkeit; sie dürfen nicht als Antwortstubs vor die Anwendung gesetzt werden. Der Simulator übernimmt `task_id`, Versionen und Collection-IDs aus tatsächlichen Antworten und ersetzt die dokumentierten Beispielwerte vor Folgeaufrufen.

Der Fixture-Agent darf durch frei gewählte Eingaben weder eine manuelle Herkunft vortäuschen noch einen Projekt-Scope erweitern. Ein noch laufender Intake wird nachverfolgt, eine Rückfrage ergänzt dasselbe Ticket. Die vereinbarten Tools und Eingabeschemas liegen in [mcp-tools.json](../contracts/mcp-tools.json).

Die GitHub-Beispieladressen sind ausschließlich inerte Linkwerte. Kein Szenario lädt sie herunter, prüft einen Pull Request, liest fremden Code oder behauptet bestandene fremde Tests. Link-Collections werden über die vorgesehenen öffentlichen Commands angelegt und gelesen.

## Decisions-HTTP

Die native Anfrage und die nativen Antworten folgen der [OpenAI Decisions API](https://developers.openai.com/api/reference/resources/decisions/methods/create). Der Testdienst ersetzt den Provider außerhalb des PHP-Prozesses. Falkenwartes Symfony-AI-Integration, Jobverarbeitung und fachliche Übersetzung bleiben aktiv.

Die Seed-Taxonomie hat Version 3. Fragen heißen `primary_topic`, `tag.<label-id>`, `workflow` und `missing.expected_behavior`. Label-IDs sind die zugelassenen Auswahlwerte; `unknown` ist ein ausdrücklicher Ausgang. Fehlende Angaben werden durch feste Fragevorlagen der Anwendung konkretisiert. Der Provider erzeugt in diesen Fixtures keine erfundene freie Rückfrage und kein fertiges Falkenwarte-Receipt.

Die Antworten unterscheiden eindeutige Klassifikation, Informationsmangel, mehrdeutige Workflowwahl, Refusal, temporäres Rate-Limit, dauerhaftes Transportversagen und eine verspätete Antwort. Für das Refusal-Szenario muss die native strukturierte Information durch den ausdrücklich typisierten Adapterpfad erhalten bleiben. Ein bloßer SDK-Exceptiontext darf keinen Refusal vortäuschen; nicht typisierbare Konvertierungsfehler ergeben `classification_unavailable`. Die Anwendungsrichtlinie entscheidet über Schwellen, Routing und Human-Attention; sie wird vom Mock nicht ersetzt.

## Nachweis und offene Szenarien

Der Playwright-Reporter schreibt pro ausgeführtem Fall Abnahme-ID, Ergebnis, erwartete und beobachtete Wirkung sowie Commit-, Image- und Fixturefelder nach `qa/results.json`. Ein fehlender Commit oder ein fehlendes Image bleibt sichtbar und verhindert die Einstufung als release-fester Abnahmenachweis. Geplante Szenarien ohne Laufbeleg bleiben offen.

Fehlgeschlagene Abläufe behalten Traces und Playwright-Artefakte unter `tests/e2e/results/`; diese lokalen Artefakte sind nicht automatisch ein freigegebener QA-Nachweis. Architektur-, Schema- und Dokumentationsprüfungen bleiben statisch. Zulässige Background-Funktionstests stehen getrennt in `tests/BackgroundFunctional`; diese Vorgabe führt keine zusätzliche Unit- oder Controller-Testsuite ein.
