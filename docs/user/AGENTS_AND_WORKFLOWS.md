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

## T3-Projekt einem Falkenwarte-Projekt zuordnen

Wähle nach dem Laden in der gewünschten T3-Projektzeile **Projekt verbinden**. Im Dialog **T3-Projekt verbinden** kannst du unter **Vorhandenes Projekt wählen** ein Falkenwarte-Projekt auswählen oder unter **Neues Falkenwarte-Projekt anlegen** ein neues Projekt mit **Projektname** und **Kurzname** anlegen. Mit **Projekt anlegen und verbinden** legt Falkenwarte das Projekt an und speichert anschließend seine Zuordnung. Falls die Zuordnung fehlschlägt, zeigt der Dialog das bereits angelegte Projekt an. Du kannst die Bindung dort erneut speichern.

Die aktive Zuordnung bleibt in Falkenwarte gespeichert. Nach dem Laden der Seite öffnet **{Projektname} öffnen** in der T3-Projektzeile das zugeordnete Falkenwarte-Projekt. Ein Falkenwarte-Projekt hat jeweils eine aktive T3-Projektbindung.

Nach der Zuordnung kannst du über **Agentrolle einrichten** direkt eine Rolle für dieses Falkenwarte-Projekt und die verwendete T3-Verbindung anlegen.

## Agentrollen verwalten

Öffne **Agentrollen** in der Hauptnavigation und lege dort eine Rolle mit Name, Aufgabenrolle, T3-Verbindung und mindestens einem erlaubten Falkenwarte-Projekt an. **Agentrolle einrichten** aus einer Projektzeile übernimmt das Projekt und die T3-Verbindung. Das Ausführungsziel **T3-Projektstandard** überlässt T3 die Auswahl anhand der im gebundenen T3-Projekt eingerichteten Standardkonfiguration.

| Ausführungsziel | Wann es passt |
| --- | --- |
| **T3-Projektstandard** | T3 soll die im gebundenen Projekt eingerichtete Standardkonfiguration verwenden. |
| **T3-Providerinstanz** | Du willst eine bestimmte von T3 gemeldete Providerinstanz und ein Modell auswählen; dafür ist kein Referenzthread nötig. |
| **Vorhandener Referenzthread** | Du willst Routingwerte eines bestehenden Threads aus dem gebundenen T3-Projekt als Vorlage verwenden. |

Unter **Providerinstanz aus T3** siehst du die Instanzen, die T3 als ausführbar meldet. Neben dem Anzeigenamen steht der eindeutige Instanz-Slug. Daran erkennst du auch mehrere Varianten desselben Providers. Wähle unter **Modell aus T3** das gewünschte Modell. Meldet T3 genau ein Modell und ist die Liste vollständig, wählt Falkenwarte es vor. Bei einer gekürzten Liste kannst du über **Modellsuche in T3** nach Modell-ID oder Name suchen.

Zugangsdaten, Argumente, Umgebungsvariablen, Arbeitsverzeichnisse und Berechtigungen verwaltest du in T3. Falkenwarte speichert den Instanz-Slug und die Modell-ID. Nach Änderungen in T3 klickst du auf **Provider neu laden**. Beim Start prüft T3 außerdem, ob die Instanz für das jeweilige Projekt aktiviert ist.

Wenn eine gespeicherte Providerinstanz nicht mehr angeboten wird, kannst du die vorhandene Rolle über **Ausführungsziel ändern** auf ein anderes T3-Ziel umstellen. Die Änderung gilt für spätere Starts; bereits gespeicherte Runs behalten ihren eingefrorenen Ziel-Snapshot.

Wenn du ein bestehendes T3-Threadziel weiterverwenden möchtest, wähle **Vorhandener Referenzthread**. Unter **Referenzthread aus T3** kannst du einen angebotenen Thread wählen oder mit **ID manuell eingeben** eine bekannte Thread-ID eintragen. T3 muss für diesen Thread die Provider- und Modellreferenz liefern, und der Thread muss zum gebundenen T3-Projekt gehören.

Für zwei aufeinanderfolgende Rollen wie **Bearbeitung** und **Review** kannst du in T3 im gebundenen Projekt je einen Referenzthread mit passendem Provider und Modell auswählen und speichern. Benenne die Threads so, dass ihre Aufgabe erkennbar ist, und weise jeder Falkenwarte-Rolle im Modus **Vorhandener Referenzthread** den entsprechenden Thread zu. Alternativ wählst du bei jeder Rolle direkt **T3-Providerinstanz**; dafür ist kein Referenzthread nötig. Ein Referenzthread überträgt nur die von T3 gelieferten Routingwerte. Jeder neue Auftrag startet einen neuen T3-Thread und übernimmt weder den Gesprächsverlauf noch Skills oder Berechtigungen des Referenzthreads. Läufe für dasselbe gebundene T3-Projekt werden nacheinander ausgeführt.

Die Projektbindung ordnet das Falkenwarte-Projekt einem T3-Projekt zu. Das Ausführungsziel der Rolle legt fest, ob T3 seinen Projektstandard, das Provider-/Modellziel aus einem Referenzthread oder eine ausdrücklich gewählte Providerinstanz mit Modell erhält. Falkenwarte speichert diese Auswahl mit der Rolle und friert sie für einen Start ein.

Die Projektbindung und das Ausführungsziel benötigen weder einen lokalen Provider in Falkenwarte noch einen MCP-Zugang des Agents. Richte Provider und Instanzoptionen in T3 ein. Stelle den technischen MCP-Zugang separat für Agents bereit, die Ticketkontext lesen oder Ergebnisse an Falkenwarte melden sollen. [Agent-Skill und MCP-Zugang einrichten](AGENT_SKILL.md)

Eine Rolle lässt sich nur starten, wenn sie aktiviert, korrekt konfiguriert und für das aktuelle Projekt freigegeben ist. Pro Rolle ist höchstens ein gleichzeitiger Auftrag vorgesehen.


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
