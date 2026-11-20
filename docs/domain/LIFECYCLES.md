# Lebenszyklen und Outcomes

Die Zustände beschreiben unterschiedliche Fachobjekte: Aufgabenstatus, Intake-Ergebnis, Runzustand, Approval, Action und Workflowinstanz können sich unabhängig voneinander ändern.

Der Gateway schließt eine Action nach lokaler Verarbeitung oder nach Abschluss ihrer Hintergrundaufträge. `WorkHandler` verschiebt eine Aufgabe erst dann nach `done`, wenn die Projektpolicy erfüllt ist.

## Aufgaben, Status und Nachweise

`PortfolioHandler` legt neue Projekte mit den Kategorien `backlog`, `ready`, `active`, `review`, `done` und `cancelled` an. Neue Aufgaben verwenden den Standardstatus `Backlog` in der Kategorie `backlog`. Ein Projekt kann mehrere eigene Status pro Kategorie verwalten.

| Vorgang | Guard und Wirkung |
|---|---|
| Aufgabe anlegen | `WorkHandler` verwendet den Standardstatus des Projekts, prüft Label- und Zusatzfeldbezüge und speichert Aufgabenrevision 1. Technische Aufgaben erhalten zusätzlich einen Intake. |
| Status wechseln | `tasks_move` akzeptiert einen Status desselben Projekts. Ein Wechsel in die Kategorie `done` prüft die Completion-Policy des Projekts. |
| Harten WIP-Grenzwert prüfen | `BoardWipPolicy` zählt Aufgaben für jede nicht archivierte Boardspalte, deren Filter die Aufgabe einschließt. Eine Änderung wird abgewiesen, wenn sie eine harte WIP-Grenze überschreiten würde. |
| Abhängigkeit setzen | Jede abhängige Aufgabe muss zum selben Projekt gehören. Selbstbezug und Zyklen werden abgewiesen. |
| Nachweis melden | Der Nachweis wird an Aufgabenrevision, optionale Run-ID und Versuch sowie den Snapshot registrierter Links gebunden und zunächst als `reported` gespeichert. |
| Nachweis prüfen | Nur der Eigentümer darf den aktuellen Nachweis bestätigen oder ablehnen. `WorkHandler` weist die Prüfung ab, sobald Aufgabenrevision oder verwendeter Link nicht mehr zum Nachweis passen. |
| Aufgabe abschließen | Je nach Projektpolicy verlangt `TaskCompletionPolicy` bestätigte Kriterien, menschlich bestätigte Nachweise oder eine Approval. Sie blockiert außerdem die Runzustände `queued`, `dispatching`, `running`, `waiting_input`, `auth_blocked`, `reconciling` und `cancel_requested`. |

Die Projektpolicy entscheidet über den Wechsel der Aufgabe nach `done`. Ein erfolgreicher Run verschiebt die Aufgabe nicht selbst in diesen Status.

## Intake und Klassifikation

Ein technischer Eingang legt Aufgabe und Intake dauerhaft an und stellt eine Bewertung als Hintergrundauftrag ein. Bei manueller Erfassung gibt die Anwendung direkt `ready` zurück, wenn die Projektpolicy keine Klassifikation manueller Aufgaben verlangt.

Der Receipt enthält das fachliche `outcome`. `assessment_status` beschreibt den Bewertungsjob und `waiting_for` den nächsten zuständigen Akteur.

| Outcome | Bedeutung und zulässige Fortsetzung |
|---|---|
| `accepted` | Intake ist gespeichert und die Bewertung ist eingereiht oder erneut angestoßen. Ein klassifiziertes Ergebnis wurde noch nicht auf die Aufgabe angewandt. |
| `ready` | Die aktuelle Bewertung wurde angewandt oder der manuelle Pfad benötigt keine Bewertung. Ein Run startet nur über eine eigene Operation und nach den Startguards. |
| `needs_information` | Benannte Angaben fehlen. Der ursprüngliche Melder kann angeforderte Feldschlüssel ergänzen. Danach stellt die Anwendung eine neue Bewertung ein. |
| `needs_human_decision` | Eine Route oder Entscheidung ist unklar. Der Eigentümer erhält einen offenen Handlungsgrund und kann zulässige Themen- und Workflowlabels auswählen. |
| `classification_unavailable` | Eine Providerbewertung konnte nicht abgeschlossen werden. Der Intake ist nicht startbereit. Der Eigentümer oder ein Principal mit `tasks.classify` kann über `tasks_reclassify` eine erneute Bewertung anfordern. |

Der Bewertungsjob verwendet `queued`, `running`, `completed`, `stale` und `failed`. `waiting_for` verwendet `none`, `requester` oder `owner`. Eine nur an den Melder gerichtete Frage öffnet keinen Eigentümergrund.

Vor dem Anwenden vergleicht `IntakeHandler` die aktuelle Aufgabenrevision und die Taxonomie-, Policy- und Routingversionen mit den gespeicherten Bewertungsständen. Bei einer Abweichung bleibt das Ergebnis unangewandt.

Der [Ticket-Receipt-Vertrag v1](../../contracts/schemas/ticket-receipt.schema.json) und der [ClassificationRecord-Vertrag v1](../../contracts/schemas/classification-record.schema.json) enthalten die öffentlichen Ergebnisfelder und Versionierungsbezüge.

## Runs und Workflows

Ein Run benötigt eine aktuelle Aufgabenrevision, eine startbereite Agentenkonfiguration, Projekt- und Verbindungsbindung, aktivierten Ausführungsprovider sowie eine erlaubte Workflowphase. Das Agentprofil legt fest, ob T3 seinen Projektstandard, ein validiertes Referenzthreadziel oder eine ausdrücklich gewählte Providerinstanz samt Modell erhält. Neue Runs werden mit diesem Ziel im Snapshot im Zustand `queued` gespeichert und über `run.dispatch` an den Hintergrundworker gestellt.

Beim direkten Providerziel stammen Instanz-ID und Modell-ID aus der aktuellen T3-Auswahl und werden gemeinsam im Dispatch-Snapshot eingefroren. Beim Projektstandard wird `modelSelection` ausgelassen, damit T3 seinen Standard bei Annahme auflöst. Ein Referenzthread liefert nur belegte Routingwerte, die Falkenwarte für den Start eines neuen T3-Threads verwendet; der Verlauf des Referenzthreads wird nicht als Kontext übernommen.

| Runzustand | Bedeutung |
|---|---|
| `queued` | Auftrag und Startidentität sind lokal angelegt. |
| `dispatching` | T3-Start oder dessen Annahme wird verarbeitet. |
| `running` | Die externe Ausführung wurde als laufend beobachtet. |
| `waiting_input` | Der Run wartet auf eine zulässige Eingabe oder beantwortbare Frage. |
| `auth_blocked` | T3-Anmeldung oder Berechtigung verhindert eine sichere Fortsetzung. |
| `reconciling` | Startannahme, Beobachtung oder Bericht muss mit dem externen Zustand abgeglichen werden. |
| `cancel_requested` | Der Abbruch wurde angefordert. Der Run bleibt bis zur T3-Beobachtung in diesem Zustand oder wird abgeglichen. |
| `result_reported` | Ein Ergebnisbericht wurde dem aktuellen Runversuch zugeordnet und die Prüfung angestoßen. |
| `verifying` | RunCompletionPolicy prüft Bericht und T3-Beobachtung. |
| `succeeded`, `failed`, `cancelled` | Der Run hat einen geklärten lokalen Abschlusszustand erreicht. |
| `abandoned` | Der Eigentümer hat die lokale Weiterbearbeitung aufgegeben. Der Run-Datensatz enthält keinen T3-Abschlussstatus. `abandoned` steht nicht in `ACTIVE_RUN_STATES`. Deshalb kann `RunHandler::requestRun()` für dieselbe T3-Projektbindung einen neuen Run anlegen. |

Ein Ergebnisbericht ist eine Agentmeldung und kann Nachweise mit Status `reported` anlegen. `RunHandler` verarbeitet ihn als aktuell, wenn Versuch, Aufgabenrevision und Runzustand zum gemeldeten Stand passen. Andernfalls speichert es den Bericht als nicht akzeptiert.

`RunCompletionEvaluator` prüft T3-Beobachtung und gespeicherte Phasenpolicy, bevor der Run abgeschlossen wird. Ein Approval bindet Aufgabenrevision, Runversuch und Ergebnisdigest. Bei geändertem Bezug setzt `RunHandler` den Status auf `invalidated`.

| Approvalstatus | Wirkung |
|---|---|
| `pending` | Für den aktuellen Ergebnisdigest steht eine Eigentümerentscheidung aus. |
| `approved` | Orchestration prüft anschließend den Phasenabschluss erneut. |
| `rejected` | Der gemeldete Phasenabschluss wird zurückgewiesen und der Run als fehlgeschlagen markiert. |
| `invalidated` | Ergebnisdigest oder Aufgabenrevision weichen vom aktuellen Stand ab. Die Anwendung überträgt die alte Entscheidung nicht auf den neuen Stand. |

Eine Workflowdefinition enthält versionierte Phasen, Bedingungen, Übergänge und Laufzeitgrenzen. `WorkflowDefinitionPolicy` prüft Grenzen, Übergänge und zeitlich erreichbare Bedingungen. Eine gestartete Instanz verwendet den Snapshot ihrer Definition.

`RunHandler` verwaltet Workflowinstanzen in den Zuständen `running`, `paused`, `succeeded` und `cancelled`. Die Automation-Regel wählt den Übergang anhand des Run-Outcomes. Offene Bedingungen und erreichte Wiederholungs- oder Laufzeitgrenzen pausieren die Instanz.

Ein gewählter Phasenübergang hält die Ausgangsphase, die Zielphase und den auslösenden Lauf fest. Die nächste Rolle erhält bei ihrer Beauftragung den gespeicherten Übergabestand mit Bericht, Versuch, Ticketrevision, offenen Fragen und registrierten Referenzen. Die Ablaufansicht kann deshalb auch nach einer Ticketänderung zeigen, womit das Review begonnen hat. Für ältere Instanzen kennzeichnet sie fehlende oder unvollständige Übergangshistorien.

Die TaskCompletionPolicy für die gesamte Aufgabe bleibt von einer RunCompletionPolicy für eine einzelne Workflowphase getrennt.

## Actions, Hintergrundarbeit und Plugins

`Presentation\Gateway` speichert eine mutierende Operation als Action `accepted` und `started`. Wenn kein Hintergrundauftrag offen bleibt, setzt der Gateway sie auf `succeeded`. Andernfalls setzt der Consumer sie nach Abschluss der Aufträge auf `succeeded` oder nach dem letzten fehlgeschlagenen Versuch auf `failed`.

| Pluginstatus | Bedeutung |
|---|---|
| `installed_disabled` | Paket ist im Image registriert, aber Beiträge sind deaktiviert. |
| `enabling` | Aktivierung wurde angefordert und wartet auf den Pluginworker. |
| `enabled` | Beiträge sind verfügbar, sofern die Pluginabhängigkeiten erfüllt sind. |
| `draining` | Das Plugin nimmt keine neue Arbeit an. Bestehende Arbeit darf fertig werden oder wird gemäß Drainpolicy abgebrochen. |
| `disabled` | Der Drain ist beendet. Der Betreiber kann das Plugin danach deaktivieren. |
| `uninstall_pending` | Ein Betreiberplan wartet auf ein neues Image ohne das registrierte Paket. |
| `removed` | Das Paket ist im laufenden Image nicht mehr registriert und der lokale Entfernungsplan konnte abgeschlossen werden. |

Die reguläre Deaktivierung folgt auf einen abgeschlossenen Drain. Vor der Entfernung prüft `PluginHandler` offene Runs, Jobs, externe Aktivität und aktive Pluginabhängigkeiten. Aktivierung und Entfernung laden keinen Code in den laufenden Prozess.

## Archivierung und Wiederherstellungsinventur

`projects_archive` archiviert oder reaktiviert ein Projekt. `RunHandler` weist neue Runs eines archivierten Projekts ab. Die Archivierung ändert den Zustand einer bereits laufenden T3-Ausführung nicht.

Nach einer Wiederherstellung sperrt das Recovery-Gate neue Starts, bis der Eigentümer die T3-Inventur freigibt. SQLite ändert den Zustand eines externen Runs nicht. Die Anwendung beobachtet und gleicht diese Runs deshalb weiter ab.
