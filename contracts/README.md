# Falkenwarte: öffentliche Verträge

Diese Dateien sind der **umsetzbare Vertragsentwurf**, keine bereits laufende Anwendung. `openapi.yaml` ist die kanonische JSON-HTTP-API; `mcp-tools.json` beschreibt die öffentliche MCP-Toolauswahl. Beide Adapter rufen dieselben Application-Handler auf. Das Frontend verwendet einen daraus generierten, typisierten API-Client und hält Fachregeln im Backend.

## Dateien

| Datei | Zweck |
|---|---|
| `openapi.yaml` | OpenAPI 3.1, Operationen, Request-/Response-DTOs, Authentifizierung, Versionierung und fachliche Erweiterungsangaben |
| `mcp-tools.json` | Toolkatalog mit eigenständigen Inputschemas, REST-/Application-Zuordnung, Capabilities und Ergebnisreferenzen |
| `schemas/` | JSON Schema 2020-12 für Domain-/Action-/UI-Events, Pluginmanifest, Intake-Receipt, Klassifikationsnachweis und Link-Collections |
| `examples/` | Konkrete, syntaktisch und gegen die Schemas geprüfte Beispiele mit illustrativen IDs und Referenzen |

Die aktuelle Fassung enthält 110 HTTP-Pfade, 144 Operationen, 201 Komponentenschemas und 35 MCP-Tools. Viele Operationen sind einfache Konfigurations- und Lesewege. Diese Anzahl ist keine Umsetzungspflicht für eine einzelne erste Iteration; der Projektplan bestimmt die Reihenfolge. Der vereinbarte Gesamtumfang bleibt über die Verträge vollständig erreichbar.

## Zuständigkeit und Schreibrechte

Ein technischer Principal wird aus seinem Credential bestimmt. `source` und `origin` gehören nicht zu einem schreibbaren Ticketinput. Jeder MCP-Eingang und jede technische JSON-Anlage durchläuft den Pflichtintake; händische Anlage durch den authentifizierten Eigentümer ist getrennt geregelt. Kein Agent kann menschliche Bestätigungen ausstellen oder seine Klassifikation durch `manual` umgehen.

Mutationen verwenden einen dauerhaften Idempotenzschlüssel. Bei bestehenden Aggregaten kommt eine erwartete Version hinzu. HTTP verwendet `Idempotency-Key` und einen starken `If-Match`-ETag; MCP verwendet `client_request_id` und `expected_version`. Die Zuordnung steht je Tool unter `http_mapping`. Bei Child-Commands wie Linkregistrierung ist die geprüfte Version die **Taskversion**, nicht eine unabhängig erfundene Linkversion.

Zusätzlich zu JSON Schema gelten die dokumentierten Domainregeln, beispielsweise Projektzugehörigkeit, vorhandene Label-IDs, eindeutiges Routing, harte WIP-Limits, Principalrechte und die Auflösung eines konkreten Aufmerksamkeitsgrundes. Schema-Validität allein autorisiert keine Operation.

## Kanonische Begriffe

| Begriff | Vertrag |
|---|---|
| Themenkategorie | `LabelDefinition.kind=topic`; `Task.primary_topic_label_id` bestimmt die Hauptkategorie |
| Weiteres fachliches Tag | Weiteres Topiclabel in `Task.label_ids` |
| Workflowtag | `LabelDefinition.kind=workflow`; explizite `WorkflowRoutingRule` verweist auf Workflow-ID und Definitionsversion |
| Mensch erforderlich | `HumanAttention.required=true` mit persistenten, serverseitig abgeleiteten Gründen |
| Rückfrage an Agent | Intake wartet auf `requester`; erzeugt für sich allein keinen menschlichen Handlungsbedarf |
| Agentprofil | Rolle und T3-Referenz über `T3ExecutionTarget`; keine eigene Provider- oder Modellkonfiguration |
| Nachweis | `reported`, `human_confirmed` oder `rejected`; kein unabhängig gemessener Code-/Teststatus |
| Link | Passive `registered_reference` in einer benannten Task-Collection |

Der Labeltyp `attention` umfasst auch einen systemseitigen Hinweis „Rückfrage an Agent“. Er ist nicht gleichbedeutend mit `HumanAttention.required=true`: Dieser Wert und seine Gründe beziehen sich ausschließlich auf noch offene Eigentümerentscheidungen.

Labelname, Farbe und Beschreibung sind editierbar. ID, Key und Typ bleiben stabil. Die Konfiguration unter `GET/PUT /projects/{project_id}/routing-rules` ordnet jeweils `workflow_label_id`, `workflow_id` und `workflow_definition_version` zu. Ohne eindeutige gültige Route gibt es keinen automatischen Start. Laufende Workflowinstanzen behalten ihren eingefrorenen Stand.

## Eingang und Rückfrage

1. `tasks_create` entspricht `POST /projects/{project_id}/tasks` und liefert einen `TicketReceipt`.
2. Ein schneller fertiger Entscheid kann sofort erscheinen. Sonst ist `outcome=accepted` dauerhaft über `tasks_intake_get` nachverfolgbar.
3. Bei `needs_information` bleibt die Aufgabe bestehen. `missing_fields` enthält konkrete Feldschlüssel, Vorlagenfragen und den Adressaten.
4. `tasks_supply_information` beantwortet diese Fragen für dieselbe Task-ID und erzeugt eine neue fachliche Revision.
5. `needs_human_decision` und `classification_unavailable` bleiben sichtbare fachliche Zustände. Ein ausdrücklicher Owner-Command kann die erlaubten Intakegründe auflösen.

Diese Outcomes sind im MCP reguläre Ergebnisse mit `isError:false`. Ein berechtigter, wohlgeformter Aufruf hat funktioniert. Ungültige Argumente, fehlende Rechte oder ein Versionskonflikt bleiben Fehler. Der Client legt bei einer Rückfrage kein zweites Ticket an.

`ClassificationRecord` hält Versionen, Fingerprints, angebotene Taxonomie und typisierte Providerantworten fest. Spät eintreffende Resultate dürfen nicht auf eine veränderte Eingangsrevision angewandt werden. Manuelle Labelentscheidungen bleiben geschützt. Die native OpenAI- und Symfony-AI-Leitung einschließlich PR #2956 wird in `docs/AI_DECISIONS.md` erklärt.

## Link-Collections und Ergebnisse

`tasks_links_list` liefert `{task_id, task_version, items:[...]}`. Jede Collection hat Name, Art (`source`, `delivery`, `reference`) und eine Linkliste. Links führen Titel, HTTP(S)-URL, Art und Beziehung, etwa `source_issue`/`part_of` oder `pull_request`/`delivers`.

`kind` und `relation` sind Pflichtfelder; `other` ist als neutraler Linktyp verfügbar. Links und Collections erscheinen in stabiler Erfassungsreihenfolge. Neue Einträge werden angehängt, Bearbeitung verändert ihre Position nicht. Eine Reorder-Funktion oder frei konfigurierbare Position gehört nicht zum Konzeptumfang.

Die Agenten registrieren diese Referenzen selbst. Falkenwarte ruft sie nicht ab und behauptet keinen externen Issue-, Test-, PR- oder Merge-Status. Entfernte oder geänderte Referenzen bleiben in der Objektgeschichte nachvollziehbar. Bereits bestätigte Meldungen müssen bei einer relevanten Änderung erneut bewertet werden.

`runs_report_result` übergibt eine Agentmeldung. `accepted_for_reconciliation` bedeutet, dass sie der Abstimmung des gespeicherten Versuchs zugeführt wurde. Der technische Runzustand `verifying` steht nur für die Prüfung dieser Zuordnung, des beobachteten T3-Zustands und der Phasenregeln. Die UI benennt ihn als „Ergebnismeldung prüfen“.

## Entwicklungsnachweis

Die Konzeptprüfung löst Referenzen auf, prüft Schema-Syntax, Beispielpayloads und die Parität aller veröffentlichten MCP-Tools mit HTTP. Sie belegt die Konsistenz dieser Artefakte. Sie ist weder ein Produkt-Unit-Test noch ein behaupteter E2E-Nachweis einer Anwendung. Die spätere Produktprüfung läuft über die vereinbarten E2E-Szenarien und echten HTTP-/MCP-Grenzen mit kontrollierten Providerfixtures.
