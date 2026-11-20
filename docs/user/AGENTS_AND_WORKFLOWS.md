# Agents und Workflows

Falkenwarte verwaltet T3-Verbindungen, Projektfreigaben, Rollen und den Status der Aufträge. Modelle, Provider, Arbeitsverzeichnisse und Toolberechtigungen bleiben in T3. Falkenwarte zeigt Meldungen und beobachtete Zustände, führt aber keine eigene externe Agentenumgebung aus.

Richte den Skill im Arbeitsprojekt oder für den von T3 verwendeten Agenten ein. Er erklärt, wie der Agent den Ticketkontext liest und sein Ergebnis für die nächste Phase meldet. [Agent-Skill installieren](AGENT_SKILL.md)

## T3-Verbindung einrichten

1. Öffne **Agents & T3** und gib unter **Verbindung hinzufügen** einen Namen und die HTTPS-Basisadresse des T3-Diensts ein, zum Beispiel `https://t3.example.net`. Hänge kein `/mcp` an. Falkenwarte ergänzt diesen Pfad beim Zugriff selbst.

   Bei der Windows-App mit WSL-Backend braucht Falkenwarte eine HTTPS-Adresse, unter der sein Container den T3-Server erreicht. Ein bereits eingerichtetes T3-Relay liefert eine solche Adresse. `localhost` bezeichnet im Container den Container selbst.

2. Wähle **Verbindung speichern**. Wenn bei der Verbindung **Autorisierung fehlt**, **Zugang abgelaufen** oder **Widerrufen** steht, wähle **Bei T3 anmelden**, schließe die Anmeldung beim T3-Dienst ab und kehre zu **Agents & T3** zurück. Bei mehreren Verbindungen wähle die gewünschte Verbindung aus.
3. Starte **Verbindung testen** erst, wenn die Verbindung als **Autorisiert** angezeigt wird. Die Prüfung läuft im Hintergrund. **Prüfung läuft** wechselt automatisch zum endgültigen Ergebnis. Starte sie nicht erneut, während sie läuft.
4. Mit **Projekte laden** rufst du die Projekte dieser T3-Verbindung ab.

Eine Verbindung mit **Eingeschränkt**, **Nicht erreichbar** oder **Protokoll prüfen** ist nicht startbereit. Lies die Diagnose zu Netzwerk, Autorisierung, MCP-Verbindung und Fähigkeiten. Bei einem Netzwerkfehler prüfe, ob der Backend-Container die eingetragene HTTPS-Adresse erreicht. Tickets und Boards kannst du währenddessen weiterverwenden.

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

## Den Ablauf eines Tickets lesen

Öffne das Ticket auf dem Board und wähle **Ablauf**. Unter **Ticketstand** siehst du den aktuellen Status, den Grund für eine Blockade und welche Erfolgskriterien noch offen sind. Das funktioniert auch bei rein manuellen Tickets. Über **Details öffnen** kannst du die Kriterien bearbeiten.

Bei einem gestarteten Workflow siehst du die Phasen seiner beim Start gespeicherten Version. Welche Phase als Nächstes beginnt, hängt vom Ergebnis der laufenden Phase und den Bedingungen des Übergangs ab. Wenn das Review Änderungen verlangt, kannst du die erneute Bearbeitung von der ersten Runde unterscheiden.

Öffne den Lauf der empfangenden Phase und wähle **Übergabeprotokoll ansehen**. Du siehst, welchen Bericht, welche Fragen und welche registrierten Links diese Rolle beim Start erhalten hat. Versuch und Ticketrevision geben an, auf welchen Stand sich die Übergabe bezieht. Im selben Lauf kannst du anschließend die eigene Meldung der Rolle und eine spätere menschliche Entscheidung nachlesen.

Um einen Auftrag zu starten oder auf eine Frage im laufenden Auftrag zu antworten, wechsle zu **Ausführung**.

## Ergebnisse richtig einordnen

Ein Agentenbericht ist eine Meldung, keine automatische Bestätigung. Prüfe Bericht, Ticketrevision und verknüpfte Nachweise unter **Ausführung** und **Entscheidungen**. Eine Annahme bestätigt die fachliche Phasenmeldung, schließt aber nicht automatisch das Ticket.

Weitere Hilfe: [Eingänge und Entscheidungen](INTAKE_AND_DECISIONS.md) und [Projekte und Tickets](PROJECTS_AND_TICKETS.md).
