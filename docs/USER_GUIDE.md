# Benutzerhandbuch

Falkenwarte ordnet Projekte und Tickets an einem Ort und hält Änderungen, offene Entscheidungen und externe Aufträge nachvollziehbar fest. Die Anwendung ist für einen Eigentümerzugang ausgelegt. Projekte, Boards und Tickets funktionieren auch ohne T3- oder OpenAI-Verbindung.

## Dein erster Arbeitsablauf

Möchtest du deinen ersten Auftrag an einen T3-Agenten vergeben? Die Anleitung führt dich durch Projektbindung, Board, MCP-Lesetest und Start des Agenten. [Von der Einrichtung zur ersten Aufgabe](user/AGENTS_AND_WORKFLOWS.md)

Für ein Board, auf dem du deine Tickets selbst bearbeitest, genügen diese Schritte.

1. Melde dich mit dem Eigentümerpasswort an. Beim ersten Aufruf richtest du das Eigentümerkonto mit dem Einrichtungstoken ein.
2. Öffne **Projekte**, wähle **Projekt anlegen** und gib Name, Kurzname, Symbol, Beschreibung und Farbe an.
3. Öffne das Projekt und richte mit **Board einrichten** das erste Board ein.
4. Lege mit **Neues Ticket** ein Ticket mit Titel, Beschreibung, Priorität und bei Bedarf Erfolgskriterien und Projektfeldern an.
5. Öffne das Ticket, um Details, Entscheidungen, Ausführung und Verlauf zu bearbeiten.

Die Hauptnavigation enthält **Übersicht**, **Projekte**, **Labels**, **Agents & T3**, **Workflows**, **Plugins** und **Metriken**. **Einstellungen** und **Dokumentation** stehen am unteren Rand der Navigation. Auf einem schmalen Bildschirm öffnest du sie über die Menüschaltfläche oben links.

Mit **Ctrl+K** oder **⌘K** suchst du Projekte, Ticketkennungen und Titel. Die Suche beginnt ab zwei Zeichen. Die Übersicht zeigt offene Tickets, erforderliche menschliche Entscheidungen, aktive T3-Aufträge und Rückfragen an Agents.

## Nach Aufgabe weiterlesen

| Du möchtest … | Anleitung |
| --- | --- |
| Projekte, Boards, Tickets und Verlauf pflegen | [Projekte und Tickets](user/PROJECTS_AND_TICKETS.md) |
| Einen T3-Agenten im eigenen Projekt mit Falkenwarte arbeiten lassen | [Agent-Skill installieren](user/AGENT_SKILL.md) |
| T3 verbinden, Projektboard und Agentenzugang prüfen, erste Aufgabe starten | [Von der Einrichtung zur ersten Aufgabe](user/AGENTS_AND_WORKFLOWS.md) |
| Rückfragen, Einordnungen und Freigaben bearbeiten | [Eingänge und Entscheidungen](user/INTAKE_AND_DECISIONS.md) |
| Laufzeiten und Metriken verstehen | [Metriken](user/METRICS.md) |
| Falkenwarte auf Linux starten oder aktualisieren | [Betrieb](OPERATIONS.md) |

## Wenn etwas nicht klappt

Öffne bei einem Ticketfehler den angezeigten Hinweis und lade den aktuellen Stand neu, bevor du eine Änderung wiederholst. Bei einem Versionskonflikt zeigt Falkenwarte den neueren Stand und behält den eigenen Entwurf soweit möglich. Vergleiche beide Fassungen, bevor du speicherst.

**Mensch erforderlich** nennt den noch offenen Grund im Tab **Entscheidungen**. Löse dort die passende Frage, statt nur ein Label zu ändern. **Rückfrage an Agent** bedeutet, dass der ursprüngliche Agent die angefragten Angaben ergänzt. Die Rückfrage ist keine Eigentümerfreigabe.

Wenn die Oberfläche nicht geladen werden kann, wähle **Erneut versuchen** oder **Erneut laden**. Bleibt Falkenwarte nicht erreichbar, prüfe die [Anleitung zur Statusprüfung](OPERATIONS.md#status-prüfen) oder bitte den Betreiber um Hilfe.
