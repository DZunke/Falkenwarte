# Metriken lesen

Öffne **Metriken**, wenn du wissen möchtest, wie viele Tickets abgeschlossen wurden, wie lange ihre Bearbeitung gedauert hat oder wie oft Rückfragen anfallen. Die Übersicht führt dich zu einzelnen offenen Aufgaben. Die Metriken zeigen, wie sich die Arbeit über einen Zeitraum verteilt.

## Eine Woche auswerten

1. Wähle bei **Projekt** das gewünschte Projekt. Mit **Alle erreichbaren Projekte** erhältst du die gemeinsame Auswertung.
2. Stelle **Von** und **Bis** ein. Beide gewählten Kalendertage zählen zum Zeitraum.
3. Wähle **Täglich** für den Verlauf oder **Gesamt** für das gesamte Fenster. Die Tabelle **Definition und Herkunft** zeigt die Werte mit Quelle, Qualität und Stichprobengröße.

Ein abgeschlossenes Ticket zählt beim Durchsatz. Ein erfolgreich gemeldeter Run betrifft dagegen den Auftrag eines Agents. Zu einem Ticket können mehrere Runs gehören, bevor du seine Abschlusskriterien erfüllst. [Tickets und Kriterien](PROJECTS_AND_TICKETS.md) · [Agents und Workflows](AGENTS_AND_WORKFLOWS.md)

## Fehlende Daten einordnen

Lies die Spalten **Quelle**, **Qualität** und **Stichprobe** gemeinsam. **Lokal beobachtet** bezeichnet Vorgänge, die Falkenwarte selbst erfasst. Die Cycle-Time ab Arbeitsbeginn ist der Median der gemessenen Bearbeitungszeiten. Ihre Stichprobe zeigt, für wie viele abgeschlossene Tickets diese Zeitspanne vorliegt. Bei den Anbieterkosten steht **Keine Daten**, weil Falkenwarte keine verifizierten Abrechnungsdaten erhält. Ein leeres Kostenfeld ist daher keine Kostenangabe von null.

Mit **Projektion neu aufbauen** beauftragst du im Hintergrund eine Neuberechnung aus den vorhandenen Daten. Fehlt eine Anbieterabrechnung, bleibt diese Kennzahl auch nach der Neuberechnung unbekannt.
