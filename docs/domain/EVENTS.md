# Ereignisse, Actions und Objektgeschichte

**Status:** Verbindlicher Fachvertrag aus Konzeptfassung 2.0. Der Umsetzungs- und Abnahmenachweis steht in [TRACEABILITY.md](../TRACEABILITY.md).

## 1. Vier verschiedene Aussagen

| Typ | Aussage | Beispiel |
|---|---|---|
| Command | Eine Änderung wird angefordert. | RegisterTicket, RequestRun |
| Domain Event | Eine fachliche Änderung ist committed. | TicketClassified, LinkRegistered |
| Action Event | Ein Anwendungsaufruf wurde angenommen oder verarbeitet. | ActionAccepted, ActionSucceeded |
| UI-Hinweis | Eine Ressource kann neu geladen werden. | Ressourcentyp Task, ID und Version |

Commandnamen und Beispiele sind Projektverträge, keine Symfony-Bordmittel. Symfony Messenger transportiert versionierte Nachrichten; Symfony EventDispatcher darf synchrone interne Benachrichtigungen unterstützen. Der dauerhafte fachliche Nachweis entsteht in den expliziten Tabellen und Transaktionen.

## 2. Fachlicher Katalog

| Ereignis | Produzent | Fachliche Aussage und typische Reaktion |
|---|---|---|
| ProjectCreated / ProjectArchived | Portfolio | Identität beziehungsweise Archivierung ist gespeichert; UI und Metriken aktualisieren. |
| TicketRegistered | WorkManagement | Task existiert. Bei technischem Eingang ist der Intake mitpersistiert. |
| TaskMoved | WorkManagement | Tatsächlicher Statuswechsel unter WIP- und Abschlussguards; Verlauf und Durchsatzprojektion aktualisieren. |
| TaskReopened | WorkManagement | Frühere Beendigung wurde mit Grund aufgehoben; neue Durchlaufepisode beginnt. |
| LabelDefinitionChanged | Classification | Fachliche Taxonomieänderung wurde versioniert; alte Klassifikationen werden nicht umgeschrieben. |
| TicketClassified | Classification | Zulässige Einordnung wurde auf die geprüfte Revision angewandt. |
| InformationRequested / InformationSupplied | Classification | Konkrete fehlende Felder beziehungsweise nachgereichte Antworten sind gespeichert. |
| HumanAttentionRequired / HumanAttentionResolved | Zuständiger Fachcontext | Ein konkreter Grund ist offen beziehungsweise durch seine Auflösungsaktion erledigt. |
| LinkRegistered / LinkChanged / LinkRemoved | WorkManagement | Referenzbestand wurde geändert; keine Aussage über den externen Inhalt oder Status. |
| RunRequested | Orchestration | Snapshot, Startidentität und reservierter Slot sind committed. |
| RunDispatched | Orchestration | Ein zugeordneter externer Annahmebeleg liegt vor. |
| RunObservationRecorded | Orchestration | Ein externer Zustand wurde zu einem Zeitpunkt beobachtet. |
| RunResultReported | Orchestration | Eine zugeordnete Agentbehauptung wurde gespeichert. |
| HumanDecisionRecorded | Orchestration / Classification | Eigentümer hat über die konkret gebundenen Daten entschieden. |
| RunFinished | Orchestration | Phasenpolicy hat einen nachvollziehbaren Endzustand ergeben. |
| WorkflowPhaseAdvanced | Automation | Eine konkrete Workflowinstanz hat unter ihren Guards die Phase gewechselt. |
| PluginActivationChanged | Extensions | Beiträge wurden freigeschaltet oder gesperrt; aktive Arbeit folgt ihrer Drainpolicy. |

Die Tabelle ist der fachliche Katalog. Die endgültigen serialisierten Typnamen werden im jeweiligen Schema fixiert. Öffentlich verwendete Namen werden nicht durch Refactoring einer PHP-Klasse geändert. Das Beispiel `contracts/schemas/task-moved.schema.json` zeigt einen konkreten versionierten Vertrag.

## 3. Umschlag und Datenminimierung

Der Eventvertrag v1 umfasst den [gemeinsamen Umschlag](../../contracts/schemas/event-envelope.schema.json), die [Action-Ereignisse](../../contracts/schemas/action-event.schema.json), den [Ticketstatuswechsel](../../contracts/schemas/task-moved.schema.json) und die [öffentlichen Änderungshinweise](../../contracts/schemas/ui-change.schema.json).

Jeder Umschlag enthält stabile Event-ID, Typ, Schemaversion, Zeitpunkt, Projekt-/Aggregatreferenz, Aggregatversion, ActorRef, correlation_id, causation_id und Payload. Die Korrelation verbindet Intake, Run und Folgephase. Die Causation-ID verweist auf den konkreten Auslöser.

Secrets, Authorization-Header, Sessioncookies und rohe fremde Transkripte gehören nicht in Ereignisse. Externe Antworten werden vor dem Speichern normalisiert und redigiert. Für die Klassifikation genügen nachvollziehbare Eingabereferenz, Fragen-/Policyversion und benötigte Antwortwerte; eine vollständige Promptkopie ist keine pauschale Loggingpflicht.

## 4. Atomarer lokaler Abschluss

Der Application-Handler öffnet eine kurze DBAL-Transaktion, prüft Version und Guards, verändert Zustand, schreibt Revision, Domain Events, Outboxeinträge und den lokalen Actionausgang und committet gemeinsam. Ein Consumer speichert Inbox-Marker und lokale Wirkung ebenfalls gemeinsam.

HTTP zu T3, Decisions oder Mercure findet außerhalb dieser Transaktion statt. Ein Netzwerkfehler kann so keinen langen SQLite-Schreiblock halten. Nach Timeout wird je Außenwirkung entschieden, ob derselbe Auftrag wiederholbar ist oder ein Abgleich nötig ist.

Mindestens-einmal-Zustellung ist die technische Annahme. Genau-einmal-Wirkung entsteht nur dort, wo eine konkrete Deduplizierung nachweisbar greift. Besonders T3-Idempotenz ist an den beobachteten Auth-Namespace gebunden und wird nicht als universelle Garantie formuliert.

## 5. History und Wiederherstellung

History speichert redigierte Snapshots und daraus lesbare Änderungen mit Schema, Akteur und Grund. Eine Revisionsansicht benötigt keine damalige PHP-Klasse oder ein noch installiertes Plugin. Bekannte Kernfelder werden verständlich gerendert; unbekannte alte Zusatzfelder bleiben als beschriftetes JSON/Text lesbar.

Eine Wiederherstellung ist ein neuer Command gegen die aktuelle Version. Sie prüft heutige Rechte und Invarianten, kopiert nur erlaubte fachliche Felder und erzeugt eine neue Revision. Run-IDs, offene Freigaben, Authzustand oder externe Ausführung werden nicht aus einem historischen Snapshot blind zurückkopiert.

## 6. Projektionen und Rebuild

Metriken verarbeiten versionierte Ereignisse mit Consumer-ID und Cursor. Der Rebuild läuft mit ausdrücklich deaktivierten Ausführungswirkungen und ersetzt seine Projektion kontrolliert. Er sendet keine Agentaufträge und spielt keine menschlichen Entscheidungen erneut ab.

Für Lead-/Cycle-Time wird eine Episode vom jeweiligen fachlichen Beginn bis zum Abschluss betrachtet. Wiedereröffnung erzeugt eine weitere Episode; die Definition nennt, ob erste oder aktuelle Episode dargestellt wird. Unvollständige oder unbekannte Zeitwerte werden nicht als Null eingebucht.

## 7. Abnahme

Die E2E-Fälle A04–A06 zeigen atomare Änderung, Wiederaufnahme und History. A10–A12 behandeln externe Unsicherheit. A16 prüft Metriken und Rebuild. Ergänzende Backend-Funktionstests dürfen ausschließlich die erlaubten Background-Aufgaben abdecken; es entsteht keine separate Domain-Unit-Suite.
