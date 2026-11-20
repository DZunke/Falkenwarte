---
name: falkenwarte
description: Use when Falkenwarte dispatches a task into the active project or the user requests a read-only Falkenwarte connection check. Read its handoff, work in the assigned phase, and report only work and evidence actually completed.
---

# Falkenwarte-Aufträge bearbeiten

Dieser Skill dient allein der Arbeit am beauftragten Zielprojekt. Falkenwarte verwaltet Ticket, Projektfreigaben, Rollen, Phasen und Laufstatus; der Agent führt die eigentliche Projektarbeit aus. Ein Bericht ist eine Meldung und keine von Falkenwarte ausgeführte Prüfung.

## Start und Übergabe

Nutze Projekt-ID, Ticket-ID, Phase-ID, Run-ID, Versuch und Aufgabenrevision aus dem Startauftrag als feste Referenz (`project_id`, `task_id`, `stage`, `run_id`, `attempt_no`, `task_revision`). Lies die Anweisungen des Zielprojekts und bleibe in der zugewiesenen Phase und Rolle.

Für einen ausdrücklich angeforderten Verbindungstest vor dem ersten Ticket rufe `tasks_list` mit der mitgeteilten `project_id` und `limit: 1` auf. Auch eine erfolgreiche leere Liste bestätigt den Zugriff. Bei einem Lesetest mit einer konkreten `task_id` verwende `task_handoff_get`. Melde das tatsächliche Ergebnis oder den Verbindungsfehler. Diese Tests verwenden ausschließlich lesende Werkzeuge.

Rufe `task_handoff_get` mit der gelieferten `task_id` und dem im Startauftrag genannten vorherigen `source_run_id` auf, wenn eines angegeben ist. Ohne `source_run_id` liefert das Werkzeug Ticket, Kriterien, Nachweise und Link-Collections; offene Fragen des vorherigen Laufs sind nur mit diesem optionalen Argument enthalten. Der eingefrorene Run-Snapshot und der Startauftrag gehören zu deinem Lauf; ersetze sie nicht durch einen späteren Ticketstand.

Nutze nur Werkzeuge, Zugänge und Projektpfade, die deine Umgebung tatsächlich anbietet. Bitte den Nutzer nie, ein Token in den Chat einzufügen; nenne fehlende Berechtigungen oder Provider-Konfiguration und bitte um sichere Bereitstellung. Ändere weder Agentenrolle noch Workflow. Technische Agenten dürfen einen Folgeauftrag nur mit ausdrücklich erteiltem `runs.request` und passendem `parent_run_id` anfordern; dieses Recht ist standardmäßig nicht erteilt.

## Rückfragen und Intake

Wenn dein Phasenauftrag Übergänge mit Labels anbietet, kannst du einen davon im Ergebnisbericht auswählen. Nimm den zum tatsächlichen Ergebnis passenden `outcome` und übermittle die angebotene Label-ID als `route_label_id`. Soll die Discovery eine Fachfrage klären, schreibe die konkrete Frage in `open_questions`, beschreibe in `summary`, was davon abhängt, und verwende das dafür konfigurierte Label. Falkenwarte übergibt deinen Bericht an die nächste Rolle. Enthält die Übergabe einen Hinweis des Eigentümers zur Überarbeitung, richte deine Bearbeitung daran aus.

Lass `route_label_id` weg, wenn Falkenwarte anhand der Themenlabels am Ticket entscheiden soll. Willst du ausdrücklich den im Auftrag angebotenen Standardübergang für dein Ergebnis wählen, sende `route_label_id: null`. Bei einem Einzellauf lässt du das Feld weg.

Stelle eine Rückfrage über den sichtbaren T3- oder Nutzer-Dialog, wenn dieser eine Antwort aufnehmen kann. Wenn eine fehlende Antwort die Arbeit stoppt und kein solcher Weg verfügbar ist, melde sie konkret in `summary` und `open_questions` und verwende `blocked`; erfinde keine Antwort. T3-Berechtigungsanfragen müssen in T3 selbst freigegeben werden.

Lege ein Falkenwarte-Ticket nur auf ausdrücklichen Auftrag an. `tasks_create` benötigt `project_id`, `title` und eine neue `client_request_id`; `outcome=accepted` quittiert die Anlage, nicht den Abschluss der asynchronen Klassifikation. Lies den Intake mit `tasks_intake_get({"task_id":"<task_id>"})` und der Fähigkeit `tasks.read`. Bei `needs_information` darfst du nur an den ursprünglichen Melder gerichtete Felder mit `tasks_supply_information` beantworten: `task_id`, `answers` als Liste aus `{"field_key":"...","value":"..."}`, neue `client_request_id` und aktuelle Taskversion als `expected_version`. Beide schreibenden Werkzeuge benötigen `tasks.write`; lies danach den Intake erneut. Eigentümerentscheidungen triffst du nicht.

## Ergebnisbericht

Rufe unmittelbar vor dem Bericht `runs_get({"run_id":"<Run-ID>"})` auf. Die Antwortfelder `id`, `attempt_no`, `snapshot.task_revision` müssen zu deinem Startauftrag passen; verwende `version` als `expected_version`. Wenn Lesen oder aktuelle Version fehlen, rate nicht, sondern bitte um `runs.read`.

Melde mit `runs_report_result` die Werte `run_id`, `report_id`, `attempt_no`, `task_revision`, `expected_version`, `client_request_id`, `outcome`, `summary` und `artifacts`. `report_id` ist eine UUID; `client_request_id` ist ein Idempotenzschlüssel.

Schreibe `summary` für die Person, die das Ticket abnimmt. Nenne zuerst das konkrete Ergebnis, etwa welche Abhängigkeiten von welcher auf welche Version aktualisiert wurden. Trenne Änderungen, Prüfergebnisse und verbleibende Grenzen durch Leerzeilen. Gehe auf jedes Erfolgskriterium des Tickets ein. Wenn du eine Prüfung ausgelassen hast, nenne den Grund. Zahlen, Versionsstände und Prüfresultate stammen ausschließlich aus deiner Arbeit im Zielprojekt.

Gib Nachweisen kurze, aussagekräftige Bezeichnungen. In einem Prüfnachweis steht pro Zeile ein ausgeführter Befehl mit Ergebnis, etwa die Zahl bestandener Tests. Fasse lange Logs zusammen. Falls eine gewünschte Aktualisierung blockiert ist, nenne die betroffene Abhängigkeit und die konkrete Einschränkung. Falkenwarte übernimmt die Zeilenumbrüche aus deinen Textfeldern.

Lies die IDs und Texte der Erfolgskriterien aus der Übergabe. Gib bei jedem Artefakt in `criterion_ids` genau die IDs an, für die **dieser Nachweis** eine Aussage belegt. Ein Installationsprotokoll kann beispielsweise das Installationskriterium belegen, ein Testprotokoll das Prüfkriterium. Deckt derselbe Nachweis beide ab, kannst du beide IDs zuordnen. Bleibt ein Kriterium ungeprüft, nenne es in der Zusammenfassung. Bei einem älteren Server, dessen Werkzeugschema keine `criterion_ids` im Artefakt anbietet, schreibe die Zuordnung in den Nachweistext. Die fachliche Bestätigung trifft der Eigentümer.

Beispiel für einen erfolgreichen Aufruf:

```text
runs_report_result({
  run_id: "<Run-ID>",
  report_id: "<neue UUID>",
  attempt_no: <Versuch>,
  task_revision: <eingefrorene Aufgabenrevision>,
  expected_version: <runs_get.version>,
  client_request_id: "<neue UUID>",
  outcome: "reported_success",
  summary: "<Änderung und Auswirkung auf das Projekt>.\n\n<Was Installation, Lint und Tests ergeben haben>.\n\n<Verbleibende Versionsgrenze und Grund, falls vorhanden>.",
  artifacts: [{
    kind: "test_report",
    label: "Installation und Tests",
    criterion_ids: ["<ID des Installationskriteriums>", "<ID des Prüfkriteriums>"],
    text: "<Installationsbefehl>: <Ergebnis>\n<Lint-Befehl>: <Ergebnis>\n<Testbefehl>: <beobachtete Anzahl bestandener und fehlgeschlagener Tests>"
  }],
  open_questions: []
})
```

Wähle `reported_success` nur, wenn die Phasenkriterien erfüllt sind; sonst nutze passend `needs_changes`, `blocked` oder `failed`. Jeder Eintrag in `artifacts` braucht `kind`, `label` und entweder tatsächlichen `text` oder registrierte `link_ids`. Gültige Standardarten sind `test_report`, `document`, `review` und `note`; verwende keine frei erfundenen Ticketlink-IDs. Schreibe nur über tatsächlich ausgeführte Prüfungen.

Wenn eine Antwort verloren geht, wiederhole denselben Bericht mit identischem Payload, `report_id` und `client_request_id`. Bei einem echten `412 version_conflict` wurde der Bericht nicht angenommen: Lies `runs_get` erneut und fahre nur fort, wenn Run-ID, Versuch und Aufgabenrevision noch passen; verwende die aktuelle `version` und eine neue `client_request_id`. Behalte die `report_id` nur, wenn der Bericht inhaltlich unverändert ist.

Die Annahme des Berichts setzt den Lauf nicht auf `succeeded`. Falkenwarte gleicht T3-Status, Bericht, Nachweise und Eigentümerentscheidungen anhand der gespeicherten Phasenregeln ab. Behaupte keinen bestätigten Gesamterfolg, solange der gelesene Laufstatus ihn nicht zeigt.
