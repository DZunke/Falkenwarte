# HTTP-, MCP- und Integrationsschnittstellen

Über die JSON-API kannst du Projekte und Tickets verwalten. Agenten greifen über MCP auf dieselben fachlichen Operationen zu. Felder, Berechtigungen und Antworten findest du im [OpenAPI-Vertrag](../contracts/openapi.yaml) und im [MCP-Toolkatalog](../contracts/mcp-tools.json).

## Adressen und Formate

Alle Adressen beginnen mit dem Origin der Falkenwarte-Installation, zum Beispiel `https://localhost:8443`. Verwende in Produktivinstallationen HTTPS und ergänze den öffentlichen Origin nicht um einen zweiten Host oder einen abweichenden API-Prefix.

| Schnittstelle | Pfad | Format und Zweck |
|---|---|---|
| JSON-HTTP | `/api/v1` | JSON-Endpunkte aus dem OpenAPI-Vertrag, relativ zur Adresse der Installation |
| MCP | `/mcp` | Streamable HTTP mit MCP-Protokollrevision `2025-06-18`. Tools und Eingaben stehen in `mcp-tools.json` |
| Bereits gespeicherte Ereignisse | `/api/v1/events` | JSON-Catch-up-Abfrage mit einem eigenen Datenbankcursor. Mercure-IDs sind keine Catch-up-Cursor |

HTTP erwartet für Requests mit JSON-Body `Content-Type: application/json`. Fachliche HTTP-Fehler verwenden `application/problem+json`. Bei Ticket-Eingängen beschreibt `outcome` den Intake-Stand und nicht den Status eines Agentenlaufs.

## Anmeldung und Berechtigungen

Browser und Eigentümer-UI verwenden eine Same-Origin-Sitzung im HttpOnly-Cookie `falkenwarte_session`. Mutationen mit dieser Sitzung brauchen zusätzlich den `X-CSRF-Token` aus `GET /api/v1/session`. Bearer-Clients brauchen keinen CSRF-Header.

Server-Integrationen verwenden ein technisches Bearer-Token mit `Authorization: Bearer <token>`. Ein Eigentümer stellt solche Tokens über `POST /api/v1/tokens` aus und bindet sie an Projekt-IDs, Fähigkeiten und ein Ablaufdatum. Falkenwarte zeigt den Klartext bei der Ausgabe genau einmal. Verwahre ihn sicher und verwende bei Verlust ein neues Token.

Ein technisches Token für HTTP oder MCP ist weder die Eigentümer-Sitzung noch ein T3-OAuth-Token. T3-OAuth-Zugänge werden separat für die Verbindung zum Ausführungsdienst verwendet.

Jeder Aufruf prüft die Projektbindung und die für den Vorgang benötigten Fähigkeiten serverseitig. Eine übergebene Projekt-, Ticket- oder Run-ID ersetzt diese Berechtigung nicht. Die OpenAPI-Operationen nennen ihre zulässigen Authentifizierungen und Fähigkeiten. Der MCP-Server bietet nur passende Tools an und prüft die Berechtigung bei jedem Aufruf erneut.

Die JSON-API ist standardmäßig Same-Origin und stellt kein offenes CORS-Profil bereit. Bei Browser-Sitzungen wird der Cookie mit dem CSRF-Token verwendet. Für Server-zu-Server-Aufrufe ist das technische Bearer-Token vorgesehen.

## Tickets anlegen und technischen Eingang verfolgen

HTTP legt ein Ticket mit `POST /api/v1/projects/{project_id}/tasks` an. Das MCP-Gegenstück heißt `tasks_create`. HTTP nimmt `project_id` im Pfad entgegen, MCP als Argument. Beide verwenden denselben Application-Vorgang und liefern ein `TicketReceipt` statt einer vollständigen Ticketdarstellung.

`title` ist erforderlich. `task_type` ist ein beschreibendes Ticketfeld und standardmäßig `task`. Der aktuelle UI-Katalog aus `GET /api/v1/ui/config` bietet `task`, `bug` und `feature`. Das OpenAPI-Schema nimmt `task_type` als Zeichenfolge an, nicht als Herkunft oder Authentifizierungsmodus.

Der Server bestimmt bei der Ticketanlage die Herkunft aus Credential und Transport. `origin` und `source` sind für Eingaben gesperrt. Ein Eigentümer legt über Sitzung/JSON standardmäßig ein manuelles Ticket an, während `tasks_create` mit technischem API-Token oder über MCP immer den Klassifikations-Intake durchläuft. Ein Projekt kann Klassifikation auch für manuelle Tickets aktivieren.

Ein technischer Client kann `suggested_label_ids` als Hinweise auf aktive Topiclabels senden. Diese Hinweise legen die Klassifikation nicht fest. `label_ids` darf nur der Eigentümer direkt setzen. Technische Clients können darüber weder Workflowrouten noch Attention-Zustände vorgeben.

Das folgende Beispiel zeigt einen technischen HTTP-Aufruf. Ersetze Origin, Projekt-ID, Token und Request-ID durch Werte dieser Installation.

```bash
curl --include --request POST \
  "$FALKENWARTE_ORIGIN/api/v1/projects/$PROJECT_ID/tasks" \
  --header "Authorization: Bearer $FALKENWARTE_TOKEN" \
  --header 'Content-Type: application/json' \
  --header "Idempotency-Key: $REQUEST_ID" \
  --data '{
    "title": "Fehler bei der Ticketansicht beheben",
    "description": "Die Detailansicht zeigt die gespeicherten Kriterien nicht an.",
    "task_type": "bug",
    "priority": "normal"
  }'
```

Der Server speichert technische Tickets dauerhaft und stellt den Klassifikationsauftrag in die Verarbeitung ein. Die HTTP-Antwort quittiert den Eingang mit `outcome=accepted`. Sie wartet aktuell nicht auf das Klassifikationsergebnis. `prefer_wait_ms` wird aus Kompatibilitätsgründen weiterhin angenommen, ändert dieses Verhalten aber nicht. Nutze `poll_after_ms` als empfohlenen Abstand für die nächste Abfrage.

| HTTP-Antwort | Bedeutung |
|---|---|
| `201 Created` | Direkter manueller Eingang des Eigentümers, standardmäßig ohne Klassifikation. Das Receipt hat `outcome=ready` und `intake_id=null`. |
| `202 Accepted` | Ein Intake wurde zur Klassifikation angenommen: immer bei technischen Anlagen und auch bei manuellen Anlagen, wenn die Projektpolicy Klassifikation aktiviert. Das Receipt hat `outcome=accepted`. Frage den Intake später ab. |

`ready` bezeichnet einen abgeschlossenen Intake, nicht einen belegten Agentenlauf oder ein bestätigtes Arbeitsergebnis. `needs_information` enthält konkrete `missing_fields` samt `addressed_to`. Der ursprüngliche Melder kann an ihn adressierte Angaben für dieselbe `task_id` über `POST /api/v1/tasks/{task_id}/intake/information` oder MCP `tasks_supply_information` nachreichen, statt ein zweites Ticket anzulegen. An den Eigentümer adressierte Felder und `needs_human_decision` verlangen eine Eigentümerhandlung. `classification_unavailable` bleibt ein sichtbarer Intake-Ausgang und darf nicht als erfolgreiche Einordnung behandelt werden.

Für einen asynchronen Intake fragt der ursprüngliche technische Principal `GET /api/v1/tasks/{task_id}/intake` beziehungsweise MCP `tasks_intake_get` ab. Die Berechtigung gilt weiterhin für das zugehörige Projekt. Die erhaltene `action_id` kann zusätzlich über `GET /api/v1/actions/{action_id}` oder MCP `actions_get` nachverfolgt werden.

Im MCP sind solche Intake-Ausgänge fachliche Ergebnisse im `structuredContent` und kein JSON-RPC-Toolfehler. `isError: true` kennzeichnet stattdessen Fehler wie ungültige Eingaben, fehlende Berechtigungen oder Versionskonflikte.

## MCP-Tools verwenden

Verbinde den Client mit `<FALKENWARTE_ORIGIN>/mcp` und sende dasselbe technische Bearer-Token wie bei einer technischen HTTP-Integration. `tools/list` zeigt nur die Tools, die für die Projekt- und Fähigkeitsbindung des Tokens sowie aktive Plugins verfügbar sind.

| MCP-Tool | HTTP-Zuordnung | Verwendung |
|---|---|---|
| `task_handoff_get` | `GET /api/v1/tasks/{task_id}/handoff` | Aktuellen Ticketkontext lesen. Mit `source_run_id` kommen die offenen Fragen des genannten Ausgangslaufs hinzu. |
| `runs_get` | `GET /api/v1/runs/{run_id}` | Versuch, Startrevision, gespeicherte Übergabe und aktuelle Run-Version lesen |
| `runs_report_result` | `POST /api/v1/runs/{run_id}/result-reports` | Ergebnis, Prüfnachweise und offene Fragen für den zugewiesenen Versuch melden |
| `tasks_create` | `POST /api/v1/projects/{project_id}/tasks` | Ticket anlegen und technischen Intake starten |
| `tasks_intake_get` | `GET /api/v1/tasks/{task_id}/intake` | Intake-Ausgang und offene Rückfragen lesen |
| `tasks_supply_information` | `POST /api/v1/tasks/{task_id}/intake/information` | Angeforderte Angaben für dasselbe Ticket nachreichen |
| `actions_get` | `GET /api/v1/actions/{action_id}` | Einen dauerhaften Command-Ausgang nachverfolgen |

MCP-Argumente werden anhand des jeweiligen `inputSchema` validiert und an die im `operation_id` angegebene Application-Operation geleitet. `client_request_id` übernimmt die Rolle des HTTP-Idempotenzschlüssels. Für versionierte Änderungen übernimmt `expected_version` die Rolle von `If-Match`; `http_mapping.version_resource` sagt, welches Aggregat diese Version bezeichnet.

Die MCP-Eingabe für `tasks_create` benötigt `project_id`, `title` und `client_request_id`. `task_type`, `description`, `priority`, `prefer_wait_ms`, `suggested_label_ids` und `link_collections` entsprechen den Feldern des HTTP-Vertrags. `prefer_wait_ms` bleibt auch bei `tasks_supply_information` und `tasks_reclassify` aus Kompatibilitätsgründen gültig, löst aktuell aber in keinem dieser Aufrufe ein Warten aus. Lies den neuen Intake-Ausgang danach über `tasks_intake_get`.

## Den Ticketablauf lesen

Die Eigentümersitzung kann über `GET /api/v1/tasks/{task_id}/flow` die Workflowdurchläufe und Einzelläufe eines Tickets abrufen. Die Antwort enthält die beim Start gültigen Phasen, zugehörige Versuche, Ergebnisberichte und Phasenentscheidungen. Das Übergabeprotokoll stammt aus dem gespeicherten Stand des empfangenden Laufs. Weitere Durchläufe lassen sich mit `next_cursor` und dem Abfrageparameter `cursor` laden. [Ablauf im Ticket](user/AGENTS_AND_WORKFLOWS.md#den-ablauf-eines-tickets-lesen)

## Wiederholungen und Versionen

Jeder schreibende HTTP-Vorgang mit Idempotenzparameter braucht einen `Idempotency-Key` mit 8 bis 256 Zeichen. Eine UUID pro neuer fachlicher Aktion ist geeignet. Ein Retry derselben Aktion verwendet denselben Schlüssel und unveränderte Eingaben, damit Falkenwarte dieselbe Action- und Ressourcenidentität zurückgeben kann. Derselbe Schlüssel mit abweichendem Request führt zu `409 idempotency_conflict`. Eine neue fachliche Aktion braucht einen neuen Schlüssel.

Schreibzugriffe auf bestehende, versionierte Ressourcen verwenden zusätzlich genau einen starken `If-Match`-ETag aus dem letzten GET. Ein fehlender oder ungültiger ETag führt zu `428`. Bei einer inzwischen geänderten Ressource antwortet Falkenwarte mit `412`, worauf der Client den aktuellen Stand erneut laden und seine Änderung darauf anwenden sollte.

Im MCP sind `client_request_id` und `expected_version` die entsprechenden Eingaben. Für Child-Commands gilt die Version des in `version_resource` genannten Parent-Aggregats, zum Beispiel die Taskversion beim Registrieren eines Links.

## Link-Collections und URL-Verhalten

Ein Ticket kann geordnete Link-Collections der Art `source`, `delivery` oder `reference` enthalten. Jeder Link braucht einen Titel, eine URL, eine Art (`source_issue`, `pull_request`, `merge_request`, `documentation` oder `other`) und eine Beziehung (`source`, `part_of`, `delivers` oder `references`).

Links müssen absolute HTTP- oder HTTPS-URLs ohne Zugangsdaten sein. Das OpenAPI-Schema begrenzt den Wert auf 4.000 Zeichen. Die zusätzliche Domainprüfung verwirft URLs mit mehr als 4.000 Bytes oder Steuerzeichen. Falkenwarte prüft die URL-Syntax und speichert sie als registrierte Referenz. Die Anwendung ruft keine Zielseite ab, zeigt keine Vorschau und prüft weder PR-Status noch Inhalt.

Neue Links werden in Erfassungsreihenfolge angehängt. Ändern oder Entfernen eines Links verändert keine externe Quelle. Falkenwarte meldet dadurch keinen Issue-, Merge-, Test- oder Veröffentlichungsstatus.

## Verträge und lokale Prüfungen

| Datei | Zweck |
|---|---|
| [OpenAPI](../contracts/openapi.yaml) | JSON-HTTP-Pfade, Eingaben, Antworten, Authentifizierungsregeln und Fehlerformen |
| [MCP-Toolkatalog](../contracts/mcp-tools.json) | MCP-Transportpfad, Tools, Fähigkeiten, Eingabeschemas und HTTP-Zuordnungen |
| JSON-Schemas | [Ticket-Receipt](../contracts/schemas/ticket-receipt.schema.json), [Link-Collections](../contracts/schemas/task-links.schema.json), [Ereignishülle](../contracts/schemas/event-envelope.schema.json), [Action-Ereignis](../contracts/schemas/action-event.schema.json), [Klassifikationsnachweis](../contracts/schemas/classification-record.schema.json), [Pluginmanifest](../contracts/schemas/plugin-manifest.schema.json), [Task-Move](../contracts/schemas/task-moved.schema.json) und [UI-Änderung](../contracts/schemas/ui-change.schema.json) |
| Vertragsbeispiele | [Intake-Rückfrage](../contracts/examples/intake-needs-information.json), [erfolgreiche Action](../contracts/examples/action-succeeded.json), [Task-Move](../contracts/examples/task-moved.json), [Link-Collections](../contracts/examples/task-link-collections.json), [Klassifikation](../contracts/examples/classification-record.json), [Pluginmanifest](../contracts/examples/plugin-manifest.json) und [UI-Änderung](../contracts/examples/ui-change.json) |

Im Repository führt `make contracts` die statische Prüfung der OpenAPI-Referenzen, MCP-/HTTP-Zuordnungen, MCP-Eingabeschemas, Vertragsbeispiele sowie Anforderungs- und Abnahmeverweise aus. Dieser Befehl startet keine Anwendung und prüft keine Live-Verbindung zu T3 oder einem Decisions-Provider.

Der [QA-Einstieg](../qa/README.md) beschreibt die lokalen Browser- und Schnittstellenläufe. Der [Abnahmekatalog](../qa/acceptance/ACCEPTANCE.md) beschreibt das erwartete Produktverhalten. Ergebnisse konkreter Läufe gehören zu deren CI- oder Release-Artefakten.
