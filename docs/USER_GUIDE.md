# Menschliche Arbeitsabläufe

**Status:** Verbindlicher Fachvertrag aus Konzeptfassung 2.0. Der Umsetzungs- und Abnahmenachweis steht in [TRACEABILITY.md](TRACEABILITY.md).

Diese Anleitung beschreibt die fachlichen Sollabläufe. Die aktuelle Oberfläche wird in Browserläufen geprüft; belegte Abläufe und offene Abnahmen stehen im [Traceability-Bericht](TRACEABILITY.md).

## 1. Ein Projekt anlegen

Name, Icon und Farbe geben dem Projekt seine sichtbare Identität. Danach werden die benötigten Status, Labels und ein erstes Board eingerichtet. Eine vorhandene T3-Projektreferenz wird erst dann gebunden, wenn Aufträge aus Falkenwarte gestartet werden sollen. Ein Projekt lässt sich vollständig für menschliche Aufgabenarbeit verwenden.

Ein archiviertes Projekt bleibt lesbar. Offene externe Arbeit und Rückfragen sind weiterhin sichtbar. Neue automatische Starts sind gesperrt.

## 2. Ein Ticket bearbeiten

Das Ticket-Sheet zeigt Beschreibung, Kriterien, Status, Labels, offene Fragen, Link-Collections und Verlauf. Ein gespeicherter Entwurf ist von einer erfolgreichen Serveränderung unterscheidbar. Bei Versionskonflikt werden die neueren Daten gezeigt; der eigene ungespeicherte Text bleibt soweit möglich erhalten.

Ein Board ist eine Sicht auf diese Aufgabe. Dieselbe Aufgabe kann in einem zweiten Board anders sortiert erscheinen. Drag-and-drop besitzt eine Menü-/Tastaturalternative. Eine volle harte WIP-Spalte erklärt, warum die Bewegung nicht möglich ist.

## 3. Einen MCP-Eingang klären

Ein Agent erhält nach der Meldung eine dauerhafte Ticket-/Intake-Referenz. Während die Einordnung läuft, erscheint „Einordnung ausstehend“. Fehlen Angaben, zeigt die Rückfrage konkret, welche Information benötigt wird und wer antworten soll.

„Rückfrage an Agent“ bedeutet, dass der Melder Angaben nachreichen kann. „Mensch erforderlich“ nennt dagegen einen offenen Eigentümergrund und eine passende Aktion, beispielsweise Workflow wählen, eine Agentfrage beantworten oder einen unklaren T3-Start klären. Das bloße Entfernen eines Labels erledigt keinen dieser Gründe.

## 4. Labels und Workflow pflegen

Name, Farbe und Beschreibung sind konfigurierbar. Themenlabels ordnen Inhalte ein. Workflowlabels sind mit einer vorhandenen Bearbeitungsroute verbunden. Eine neue Route wird erst bei einer ausdrücklichen Start-/Routingaktion angewendet. Ein bereits laufender Auftrag behält seine eingefrorene Konfiguration.

Wer eine Beschreibung fachlich verändert, erzeugt eine neue Taxonomieversion. Alte Tickets verlieren dadurch ihre historische Klassifikation nicht. Eine erneute Einordnung ist eine sichtbare Handlung mit eigener Herkunft.

## 5. Eine Agentrolle verwenden

Eine Rolle beschreibt Auftrag und Projektfreigaben. Ihr Ziel ist der T3-Projektstandard oder ein vorhandener Referenzthread. Provider, Modelle und deren Zugänge werden in T3 eingerichtet. Falkenwarte zeigt die auflösbare Referenz und einen verständlichen Verbindungszustand.

Vor einem Start zeigt die Oberfläche Aufgabe, Rolle, Phase und die gebundene Revision. Ein angenommener Start erscheint zunächst als laufender Vorgang. Bei verlorener Antwort kann „Abgleich erforderlich“ erscheinen; ein erneuter Klick erzeugt keinen unkontrollierten zweiten Auftrag.

## 6. Ergebnisse und Links verstehen

Ein Agent kann eine Ergebniszusammenfassung und mehrere Links melden. Eine Sammlung „Quelle“ kann das ursprüngliche Issue enthalten, eine Sammlung „Ergebnis“ einen oder mehrere Pull/Merge Requests. Links werden als externe Referenzen geöffnet. Falkenwarte liest ihren Inhalt und Status nicht selbst.

Eine Meldung „Tests erfolgreich“ bleibt eine Agentmeldung. Eine menschliche Bestätigung dokumentiert, wer die Aussage fachlich akzeptiert hat. Sie verwandelt die Anwendung nicht in einen Code- oder CI-Prüfer.

Eine Folgephase kann den Bericht samt Links übernehmen. Für den Abschluss des gesamten Tickets gelten weiterhin dessen Kriterien und Workflowregel. Ein erfolgreicher einzelner Run schließt das Ticket nicht zwingend ab.

## 7. Dashboard und Metriken

Die Übersicht priorisiert offene menschliche Entscheidungen, laufende Aufträge und Fragen. Projektkennzahlen zeigen ihren Zeitraum und Datenstand. Unbekannte Werte erscheinen als unbekannt. Die Oberfläche zeigt keine erfundenen Modellbudgets oder aus PR-Links erratenen Mergezustände.

## 8. Plugins und Dokumentation

Installierte Erweiterungen können in ihren freigegebenen Grenzen aktiviert oder deaktiviert werden. Eine Deaktivierung mit laufender Arbeit zeigt, warum sie noch wartet. Entfernte Funktionen löschen nicht automatisch historische Daten.

Der Dokumentationsbereich erklärt Begriffe, Fachregeln, Lebenszyklen und Entscheidungen. Bei einer unklaren Produktregel ist ihr dokumentierter Kontext wichtiger als ein beliebiger Gesprächsverlauf mit einem Agenten.
