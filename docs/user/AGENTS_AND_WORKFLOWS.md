# Agents und Workflows

Falkenwarte verwaltet T3-Verbindungen, Projektfreigaben, Rollen und den Status der Aufträge. Modelle, Provider, Arbeitsverzeichnisse und Toolberechtigungen bleiben in T3. Falkenwarte zeigt Meldungen und beobachtete Zustände, führt aber keine eigene externe Agentenumgebung aus.

## T3-Verbindung einrichten

1. Öffne **Agents & T3** und gib unter **Verbindung hinzufügen** einen Namen und die kanonische HTTPS-Adresse des T3-MCP-Endpunkts ein.
2. Wähle **Verbindung speichern**. Wähle danach **Verbindung testen**. Das Ergebnis zeigt Netzwerk, Autorisierung, MCP-Verbindung und verfügbare Fähigkeiten getrennt.
3. Wenn eine Anmeldung fehlt, wähle **Bei T3 anmelden** und schließe die Anmeldung beim T3-Dienst ab.
4. Wähle **Projekte laden**, um die vorhandenen T3-Projektkennungen zu lesen.

Eine Verbindung mit **Eingeschränkt**, **Nicht erreichbar** oder **Protokoll prüfen** ist nicht startbereit. Lies die angezeigte Diagnose und prüfe T3-URL, Anmeldung und Protokollkompatibilität. Tickets und Boards kannst du währenddessen weiterverwenden.

## Rollen verwalten

Die Rollenverwaltung ist über `/#/roles` auf derselben Falkenwarte-Adresse erreichbar. Sie hat derzeit keinen Eintrag in der Hauptnavigation.

Lege dort eine Rolle mit Name, Aufgabenrolle, T3-Verbindung und mindestens einem erlaubten Projekt an. Als Ausführungsziel kannst du den T3-Projektstandard oder einen vorhandenen T3-Referenzthread wählen. Eine optionale Auftragsvorlage ergänzt den Rollenhinweis.

Eine Rolle lässt sich nur starten, wenn sie aktiviert, korrekt konfiguriert und für das aktuelle Projekt freigegeben ist. Pro Rolle ist höchstens ein gleichzeitiger Auftrag vorgesehen.

Die Projektbindung zu einem vorhandenen T3-Projekt kannst du im Browser nicht setzen. Dafür gibt es `PUT /api/v1/projects/{project_id}/binding`. Details stehen im [Binding-Vertrag](../../contracts/openapi.yaml).

## Einzellauf starten und verfolgen

1. Öffne ein Ticket und wechsle zu **Ausführung**.
2. Lies **Startbedingungen** und löse alle dort genannten Sperren auf. Falkenwarte prüft Ticketstand, Rolle, T3-Verbindung und freien Ausführungsplatz beim Start erneut.
3. Wähle startbereites **Rollenprofil** und **Phase**, dann **Einzellauf anfordern**.
4. Verfolge den Auftrag unter **Ausführungen**. Wähle **Aktualisieren**, wenn du den Stand sofort neu laden möchtest.

**Warteschlange**, **Läuft in T3** und **Wartet auf eine Antwort** zeigen, dass ein Auftrag wartet oder läuft. Bei **T3-Anmeldung fehlt** meldest du dich im T3-Dienst an. Bei **T3-Status wird abgeglichen** wartest du auf den bestätigten externen Zustand. Fordere denselben Auftrag nicht erneut an.

Wenn der laufende Auftrag eine Frage an dich richtet, kannst du sie unter **Eingabe an den laufenden Auftrag** beantworten. Das geht nur, wenn **Antwort über Falkenwarte möglich** angezeigt wird.

Eine T3-Berechtigungsanfrage musst du direkt in T3 freigeben. Eine Nachricht in Falkenwarte ersetzt diese Freigabe nicht.

## Workflows verwenden

Öffne **Workflows**, lege bei Bedarf einen **Zwei-Phasen-Workflow** an und wähle Projekt sowie optionale Agentrolle. Dieser Ablauf enthält eine Bearbeitungs- und eine Reviewphase. Nach einer angenommenen Meldung folgt das Review. Bei **Änderungen nötig** kehrt der Ablauf zur Bearbeitung zurück.

Unter **Workflowlabels zuordnen** verbindest du ein Workflowlabel mit einem aktiven Workflow. Die Route fixiert eine Workflowversion für neue Starts. Sie erteilt keine Startfreigabe. Eine fehlende oder mehrdeutige Route erfordert eine menschliche Entscheidung.

Ein **Manueller Trigger** richtet einen ausdrücklich angeforderten Start ein. Er führt keinen Code aus und startet keine Aufträge im Hintergrund.

## Ergebnisse richtig einordnen

Ein Agentenbericht ist eine Meldung, keine automatische Bestätigung. Prüfe Bericht, Ticketrevision und verknüpfte Nachweise unter **Ausführung** und **Entscheidungen**. Eine Annahme bestätigt die fachliche Phasenmeldung, schließt aber nicht automatisch das Ticket.

Weitere Hilfe: [Eingänge und Entscheidungen](INTAKE_AND_DECISIONS.md) und [Projekte und Tickets](PROJECTS_AND_TICKETS.md).
