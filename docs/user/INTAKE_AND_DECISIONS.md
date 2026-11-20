# Eingänge und Entscheidungen

Der Tab **Entscheidungen** trennt Rückfragen an den ursprünglichen Agenten von Entscheidungen, die du selbst treffen musst. Lies den angezeigten Grund und nutze die dazugehörige Aktion. Entferne nicht einfach das Hinweislabel.

## Technischen Eingang einordnen

Technische Eingänge aus MCP oder der API erscheinen am Ticket unter **Eingang und Einordnung**. Je nach Projektregeln wird das Ticket eingeordnet, eine Pflichtangabe erfragt oder eine menschliche Entscheidung angefordert.

Bei **Rückfrage an Agent** liest du die fehlenden Angaben und den Adressaten. Der ursprüngliche Agent ergänzt die Angaben über MCP. Du musst die Rückfrage nicht selbst freigeben.

Bei **Menschliche Entscheidung nötig** prüfst du das Ticket und wählst ein Hauptthema sowie einen Arbeitsablauf. Ergänze bei Bedarf weitere Themen. Begründe die Auswahl mit **Einordnung festlegen**.

Diese Zuordnung startet keinen Workflow. Fordere den Start anschließend im Tab **Ausführung** an.

Wenn **Einordnung nicht verfügbar** angezeigt wird, wähle **Einordnung erneut versuchen** und gib eine Begründung ein. Der neue Lauf verwendet die aktuelle Ticketrevision.

Prüfe unter **Einstellungen** und **Einordnung**, ob die OpenAI-Entscheidungsverbindung eingerichtet und verfügbar ist.

## OpenAI Decisions einrichten

Öffne **Einstellungen** und gehe zum Bereich **Einordnung**. Lege unter **OpenAI Decisions** eine Secret-Referenz mit API-Schlüssel an. Wähle diese Referenz aus und speichere die Verbindung. Der gespeicherte Schlüssel wird später nicht wieder angezeigt.

Wähle unter **Rückfragen und Schwellen** das Projekt und pflege Pflichtangaben, Rückfragevorlagen und Schwellen. Technische Eingänge bleiben einordnungspflichtig. Die zusätzliche Einordnung handangelegter Tickets ist eine separate Option.

Ohne OpenAI-Verbindung kannst du Projekte, Boards und handangelegte Tickets weiterverwenden. Nur die davon abhängigen automatischen Einordnungen stehen dann nicht zur Verfügung.

## Menschliche Aufmerksamkeit bearbeiten

Das Label **Mensch erforderlich** nennt einen offenen Grund. Beispiele sind eine mehrdeutige Route, eine ausstehende Ergebnisfreigabe, fehlende T3-Autorisierung oder ein nötiger T3-Abgleich.

Öffne den Tab **Entscheidungen** oder **Ausführung** und bearbeite den dort genannten Grund.

Eine Rückfrage an den Agenten wartet auf die Antwort des ursprünglichen Melders. **Mensch erforderlich** nennt eine Entscheidung, für die du verantwortlich bist. Das Entfernen eines Labels erledigt weder die Rückfrage noch die Entscheidung.

## Ergebnisfreigabe entscheiden

Wenn ein Ergebnisbericht auf eine Freigabe wartet, öffne **Entscheidungen**, lies den Bericht und seine Nachweise und gib eine Begründung ein. Wähle **Annehmen** oder **Zurückweisen** passend zur fachlichen Entscheidung.

Eine Annahme bezieht sich auf den gemeldeten Versuch und die dazugehörige Ticketrevision. Sie ist keine automatische Prüfung von Quellcode, Tests oder externen Links und ersetzt nicht die Abschlussregel des Tickets.

Bei einem Schreibkonflikt lädt Falkenwarte den aktuellen Ticket- und Entscheidungsstand neu. Prüfe diesen Stand und begründe eine neue Entscheidung erst danach.
