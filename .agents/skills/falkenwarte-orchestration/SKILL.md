---
name: falkenwarte-orchestration
description: Diagnostiziere oder ändere den Falkenwarte-Code für Decisions-Intake, T3-Dispatch, Workflowphasen, eingefrorene Übergaben und den Ticketablauf.
---

# Einen Ticketablauf untersuchen

## Ein technischer Eingang wartet

Verfolge Intake-ID und Generation vom gespeicherten Eingang bis zum Hintergrundauftrag `intake.classify`. Vergleiche vor der Übernahme einer Decisions-Antwort die fixierte Ticketrevision und die Versionen von Taxonomie, Policy und Routing. Prüfe am Intake, ob Angaben des Melders fehlen, ein Eigentümer entscheiden muss oder der Provider nicht erreichbar war. Ein Workflowlabel wählt die Route. Startfreigaben werden gesondert geprüft. [IntakeHandler](../../../src/Classification/Application/IntakeHandler.php) · [Decisions-Ablauf](../../../docs/AI_DECISIONS.md) · [Intake-Browserfälle](../../../tests/e2e/tests/decisions-intake.spec.mjs)

## Ein Start fehlt oder erscheint doppelt

Lies den gespeicherten Dispatch-Request für den betroffenen Versuch. Vergleiche seine ID, den gespeicherten Payload und die OAuth-Generation `auth_epoch` mit dem T3-Journal. Wenn eine Antwort verloren ging, muss derselbe Versuch dieselbe Anfrage wiederverwenden. Ist der externe Ausgang nach einem OAuth-Wechsel unklar, muss der Abgleich ihn klären. Prüfe die tatsächlich gesendete Startnachricht auf Projekt-ID, Ticket-ID, Phase, Run-ID, Versuch und eingefrorene Ticketrevision. [RunHandler](../../../src/Orchestration/Application/RunHandler.php) · [T3-Bridge](../../../src/Orchestration/Infrastructure/T3McpBridge.php) · [Dispatch-Browsertests](../../../tests/e2e/tests/t3-orchestration.spec.mjs)

## Eine Übergabe fehlt oder ein Abschluss wirkt falsch

Lies beim empfangenden Lauf dessen eingefrorenen Snapshot samt Quelllauf und Quellbericht. Für den externen Agenten liefert `task_handoff_get` mit `tasks.read` den Ticketkontext und mit `source_run_id` auch die übernommenen offenen Fragen. Zum Berichten liest der Agent die aktuelle Run-Version mit `runs_get` (`runs.read`) und reicht sie zusammen mit Versuch, Aufgabenrevision und Idempotenzschlüssel bei `runs_report_result` (`runs.report`) ein. Ein angenommener Bericht, der bestätigte Phasenabschluss und der Abschluss des Tickets sind getrennte Schritte. [MCP-Vertrag](../../../contracts/mcp-tools.json) · [Skill für den Agenten im Zielprojekt](../../../skills/falkenwarte/SKILL.md)

Die Eigentümeransicht nutzt `GET /api/v1/tasks/{task_id}/flow` (`task_flow_get`). Vergleiche die beim Start fixierte Workflowversion mit den gespeicherten `selected_transitions`. `branch_history_status` zeigt die Vollständigkeit der Aufzeichnung. Bei `not_recorded` und `selected_transitions: null` ist die damalige Auswahl unbekannt. Zeige weiterhin belegte Runs, Berichte und Übergaben. Eine mögliche Kante in der Definition belegt keinen tatsächlichen Übergang. [OpenAPI](../../../contracts/openapi.yaml) · [TaskFlowHandler](../../../src/Orchestration/Application/TaskFlowHandler.php)

Reproduziere Phasenwechsel, Reparaturlimit und Review-Übergabe über die öffentlichen Schnittstellen. Die vorhandenen Playwright-Fälle verwenden einen zustandsbehafteten T3-Mock und melden Ergebnisse an Falkenwartes echten MCP-Einstieg. Für den isolierten Lauf verwende `make e2e`. [Übergabe-Browsertests](../../../tests/e2e/tests/workflow-handoff.spec.mjs)

Bei vermutetem Datenverlust nach einem Upgrade lege den Fall mit der betroffenen Vorversion über die öffentliche API in einem eigenen QA-Projekt an. Sichere Run-IDs, Report-IDs und die eingefrorene Übergabe. Starte das neue Image auf demselben Datenvolume ohne Fixture-Reset und vergleiche diese Daten im Ticketablauf. So lässt sich ein verlorener Bericht von einer früher nie gespeicherten Übergangsauswahl unterscheiden.
