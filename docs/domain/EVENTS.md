# Kommandos, Ereignisse und Objektgeschichte

Falkenwarte speichert Befehlsannahme, fachliche Änderung, Hintergrundauftrag und Live-Hinweis als getrennte Aussagen, weil sie unterschiedliche Zeitpunkte und Zuständigkeiten beschreiben.

## Vier Verträge mit unterschiedlicher Bedeutung

| Vertrag | Bedeutung | Ablage oder Beispiel |
|---|---|---|
| Operation / Kommando | Ein Akteur fordert eine lesende oder mutierende Anwendungshandlung an. | OpenAPI-`operationId`, `OperationHandler`, `commands`-Auftrag für Hintergrundarbeit. |
| Domain-Ereignis | Ein Datensatz wurde lokal erstellt, geändert oder entfernt. | Umschlag `kind=domain` in `events`. Beispiele sind `task.created`, `run.queued` und `classification.applied`. |
| Action-Ereignis | Ein Anwendungsaufruf wurde angenommen, gestartet oder abgeschlossen. | `action.accepted`, `action.started`, `action.succeeded` und `action.failed`. |
| UI-Änderungshinweis | Der Client soll die Ressource erneut laden. | `change_json` mit Ressourcentyp, ID, Projekt, Version und Änderung. |

Ein Auftragsdatensatz in `commands` ist kein Domain-Ereignis. Er veranlasst einen Worker, während ein Journalereignis eine bereits gespeicherte lokale Änderung beschreibt.

## Persistierter Ereignisumschlag

Das [Event-Envelope-Schema v1](../../contracts/schemas/event-envelope.schema.json) benennt Event-ID, Typ, Schema-Version, Zeitpunkt, Projekt, Akteur, Korrelations- und Action-ID, optionale Causation-ID, Aggregate-Referenz und Nutzdaten.

`DbalStore::journal()` leitet die meisten `event_type`-Werte aus dem Journalnamen des Handlers ab. Punkte bleiben erhalten, CamelCase wird in Kleinbuchstaben mit Unterstrichen umgewandelt. Ein Aufgabenstatuswechsel erhält den festen Typ `work.task_moved` aus dem [Task-Moved-Schema v1](../../contracts/schemas/task-moved.schema.json).

`DbalStore` setzt `correlation_id` und `action_id` auf dieselbe Action-ID. Der Store schreibt `causation_id` als `null`, sodass die Ereignisse keine Verursachungskette enthalten.

Normale Datensatzänderungen erhalten `kind=domain` und Action-Datensätze `kind=action`. Für nicht als UUID verwendbare Datensatz-IDs setzt `DbalStore` `kind=integration`. Das Schema erlaubt außerdem `ui`. Der Store legt UI-Hinweise separat als `change_json` ab.

Der aktuelle Datensatz liegt in `records`. Das Journal ergänzt ihn. `DbalStore` lädt Ressourcen aus den Datensätzen und baut sie nicht ausschließlich aus Ereignissen wieder auf.

## Actions und Hintergrundaufträge

`Presentation\Gateway` erzeugt für mutierende API-Aufrufe eine Action mit Status `accepted` und `started`. Wenn kein Hintergrundauftrag offen bleibt, setzt der Gateway sie auf `succeeded`.

`Shared\Infrastructure\Consumer` aktualisiert die Action nach Abschluss aller Aufträge auf `succeeded` oder nach dem letzten fehlgeschlagenen Versuch auf `failed`. Intake und Run behalten ihren eigenen Outcome.

Der Consumer routet den Auftrag über seinen Präfix, prüft den `inbox`-Marker und wiederholt fehlgeschlagene Aufträge höchstens dreimal. Der Marker verhindert doppelte lokale Verarbeitung desselben Auftrags. Ein externer Provideraufruf kann trotzdem wiederholt werden. T3-Aufträge mit unsicherem Ausgang werden abgeglichen.

Das [Action-Event-Schema v1](../../contracts/schemas/action-event.schema.json) enthält einen Befehlstyp, das Ziel, eine mögliche Ergebnisressource und redigierte Fehlerangaben.

## Revisionen und Live-Zustellung

Für Datensatztypen aus `Store::PUBLIC_TYPES` schreibt `DbalStore::save()` eine Revision mit Ressource, Version, Projekt, Akteur, Action, Zusammenfassung, Änderungen und redigiertem Snapshot. Die Revision ist ein Änderungsverlauf und kein eigener Bounded Context.

`DbalStore` markiert nur nicht entfernte Tasks als wiederherstellbar. `WorkHandler` prüft Rechte und aktuelle Regeln, bevor es eine Taskrevision als neue Änderung speichert.

Für UI-fähige Ressourcentypen speichert der Store einen minimierten `change_json`-Hinweis mit Version und Ressourcen-ID. `Live::publish()` liefert offene Hinweise privat über Mercure aus und markiert sie als zugestellt. Der Browser lädt danach die aktuelle Ressource über JSON.

Das [UI-Change-Schema v1](../../contracts/schemas/ui-change.schema.json) ist daher ein Invalidierungshinweis und kein Ersatz für die autoritative Ressource oder ein vollständiges Domain-Ereignis.

`DbalStore::journal()` schreibt Änderungsart und ausgewählte Zustandsfelder in Ereignisse, nicht den vollständigen Datensatz. `DbalStore::redact()` entfernt Secret-, Passwort- und Tokenfelder aus Revisions-Snapshots.

## Projektionen

`MetricsHandler` berechnet Dashboardwerte aus aktuellen Aufgaben, Runs und Journalereignissen und kann gespeicherte Metrikprojektionen neu aufbauen. Ein Rebuild verändert Metrikdatensätze, wiederholt aber keine T3-Ausführung und keine Eigentümerentscheidung.

Workflow-Trigger lesen passende Domain-Ereignisse des Projektjournals ab einem gespeicherten Cursor. Bei einem Treffer erzeugen sie einen separaten `workflow.trigger`-Auftrag.
