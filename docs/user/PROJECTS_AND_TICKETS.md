# Projekte und Tickets

Ein Projekt hält Tickets, Status, Labels, Felder und Boards zusammen. Du kannst ein Projekt vollständig für menschliche Aufgabenarbeit verwenden und T3 erst dann hinzufügen, wenn externe Ausführung gebraucht wird.

## Projekt und Board einrichten

1. Öffne **Projekte** und wähle **Projekt anlegen**.
2. Vergib einen **Namen** und einen **Kurznamen**, der in Ticketkennungen erscheint. Wähle ein Symbol und eine Farbe. Ergänze bei Bedarf eine Beschreibung.
3. Öffne die Projektkarte über **Board öffnen**. Bei einem neuen Projekt wählst du **Board einrichten**, gibst einen Boardnamen ein und bestätigst mit **Board erstellen**.
4. Falkenwarte erstellt beim ersten Board die passenden Statuskategorien, darunter einen Standardstatus für neue Tickets.

Du kannst mehrere Boards pro Projekt anlegen und zwischen ihnen wechseln. **Boardansicht** gruppiert Tickets nach Spalten. **Listenansicht** zeigt dieselben Tickets als Tabelle.

Mit **Tickets filtern** grenzt du die Ansicht nach Kennung, Titel oder Beschreibung ein.

Mit **Status bearbeiten** pflegst du die Projektstatus. Eine verwendete Statuskategorie lässt sich nur ändern, wenn Projektregeln und Boards gültig bleiben.

Über **Projektfelder** definierst du zusätzliche Ticketinformationen. Erforderliche Felder müssen bereits beim Anlegen ausgefüllt werden.

## Ticket anlegen und bewegen

Wähle **Neues Ticket** oder das Pluszeichen in einer Boardspalte und gib mindestens einen Titel ein. Beschreibung, Priorität, ein Erfolgskriterium pro Zeile und Projektfelder kannst du sofort ergänzen oder später bearbeiten.

Ziehe eine Karte in eine andere Spalte oder öffne ihr Aktionsmenü und wähle einen Status. Beide Wege ändern dasselbe Ticket. Unter **Spalten bearbeiten** benennst du Spalten um und setzt ein WIP-Limit mit der Regel **Warnen** oder **Blockieren**.

Bei **Warnen** weist Falkenwarte auf die überschrittene Grenze hin. Bei **Blockieren** wird die Bewegung abgewiesen. Öffne die Spalteneinstellungen oder verschiebe ein anderes Ticket, statt denselben Schritt immer wieder zu versuchen.

Ein archiviertes Projekt bleibt lesbar, nimmt aber keine neuen Tickets an. Öffne es unter **Projekte** und wähle das Wiederherstellen-Symbol. Bestätige mit **Wiederherstellen**, um es zu reaktivieren.

## Ticketdetails, Nachweise und Verlauf

Öffne eine Karte, um das Ticket zu lesen. In **Details** bearbeitest du Tickettext, Status und Erfolgskriterien und verwaltest Projektfelder sowie Link-Sammlungen.

Über **Meldung hinzufügen** hängst du einen Nachweis an ein Erfolgskriterium. Die Meldung hält fest, was ein Mensch oder Agent berichtet hat. Sie ist keine automatische Code- oder CI-Prüfung.

Bei einem Agentenlauf ordnet der Agent die Nachweise im Ergebnisbericht den Erfolgskriterien zu, die sie belegen. Diese Zuordnung ist eine Agentenmeldung und keine fachliche Bestätigung.

Für einen bestehenden, noch nicht zugeordneten Nachweis öffnest du **Details → Gemeldete Nachweise**, klickst **Kriterien zuordnen**, wählst offene Kriterien aus und speicherst mit **Zuordnung speichern**. Inhalt und Herkunft der Meldung bleiben erhalten. Zurückgewiesene oder veraltete Nachweise lassen sich nicht zuordnen. Bereits zugeordnete Kriterien zeigt Falkenwarte an und bietet sie nicht erneut zur Auswahl an.

Prüfe die Meldungen am jeweiligen Erfolgskriterium. Für die fachliche Bestätigung wählst du **Bestätigen**, gibst eine Begründung ein und klickst auf **Fachlich bestätigen**. Beim Verschieben der Karte in **Erledigt** bleiben deine Bestätigung und der zugehörige Nachweis erhalten. Die im Nachweis angegebene Ticketversion zeigt, auf welchen Stand er sich bezieht.

Für externe Referenzen wählst du **Link hinzufügen**, benennst Sammlung und Link und registrierst die URL. Falkenwarte speichert diese Referenz, ruft aber den Inhalt und Status der externen Seite nicht selbst ab.

Unter **Ablauf** siehst du, welche Phasen ein gestarteter Workflow bereits durchlaufen hat, wo er steht und welche Übergabe die nächste Rolle erhalten hat. [Den Ablauf eines Tickets lesen](AGENTS_AND_WORKFLOWS.md#den-ablauf-eines-tickets-lesen)

Im Tab **Verlauf** siehst du frühere Revisionen. **Wiederherstellen** verlangt einen Grund und erzeugt eine neue Revision. Bereits bei T3 gestartete Arbeit wird dadurch nicht zurückgenommen.

## Labels und Fehlerhilfe

Öffne **Labels**, wähle das Projekt und lege entweder ein Themenlabel oder eine Workflowroute an. Themenlabels beschreiben den fachlichen Inhalt. Workflowrouten verweisen auf einen eingerichteten Ablauf und starten ihn nicht selbst.

| Anzeige oder Problem | Was du tun kannst |
| --- | --- |
| **WIP-Grenze überschritten** | Prüfe, ob die Spalte warnt oder blockiert. Verschiebe ein Ticket oder passe die Grenze unter **Spalten bearbeiten** an. |
| Das Speichern meldet einen Versionskonflikt | Lies den neu geladenen Stand, übernimm nötige eigene Änderungen erneut und speichere erst danach. |
| Ein Ticket oder Board kann nicht geladen werden | Wähle **Erneut laden**. Bleibt der Fehler bestehen, prüfe, ob Falkenwarte erreichbar ist. |
| Erfolgskriterium ist noch nicht bestätigt | Öffne das Kriterium, prüfe die verknüpften Meldungen und bestätige es mit einer Begründung. |

Siehe auch [Eingänge und Entscheidungen](INTAKE_AND_DECISIONS.md) für offene Rückfragen und [Agents und Workflows](AGENTS_AND_WORKFLOWS.md) für externe Aufträge.
