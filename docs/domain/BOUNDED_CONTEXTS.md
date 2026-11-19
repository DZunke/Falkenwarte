# Bounded Contexts, Aggregate und Invarianten

**Status:** Verbindlicher Fachvertrag aus Konzeptfassung 2.0. Der Umsetzungs- und Abnahmenachweis steht in [TRACEABILITY.md](../TRACEABILITY.md).

## 1. Modulkonvention

Der modulare Monolith verwendet `src/<Context>/{Domain,Application,Infrastructure,Presentation}`. Frameworkattribute, DBAL-Queries und MCP-Objekte gehören nicht in die Domain. Ein gemeinsamer DBAL-Transaktionskoordinator darf mehrere ausdrücklich veröffentlichte lokale Teilnehmer verbinden. Ein Context erhält dadurch keinen beliebigen Schreibzugriff auf fremde Tabellen.

Im Startumfang liegen die Contexts in einem Repository und einem Prozessraum. Ihre Grenzen werden durch Ordner, Composer-Autoloading, Interfaces und statische Importregeln sichtbar. Es wird kein Netzwerkdienst pro Context gebaut.

## 2. Fachlicher Besitz

| Context | Wichtige Aggregate / Modelle | Invarianten und veröffentlichte Grenze |
|---|---|---|
| Portfolio | Project, ProjectBinding | Eindeutiger Slug; archivierte Projekte starten keine neue automatische Arbeit. Projektidentität wird über lesbare Referenzen veröffentlicht. |
| WorkManagement | Task, Board, TaskStatusCatalog, LinkCollection | Jede Referenz liegt im selben Projekt; Abhängigkeiten sind azyklisch; Abschlussregeln gelten unabhängig vom Eingangskanal; Links werden nicht abgerufen. Commands betreffen Aufgabe, Reihenfolge, Kriterien und Linkregistrierung. |
| Classification | LabelCatalog, Intake, ClassificationRecord, RequirementProfile | Zulässige Taxonomiewerte, stabile Labelkeys und Herkunft; eine Bewertung gilt für genau einen Eingabestand. Regeln für menschlichen Handlungsbedarf werden nicht vom Modell überschrieben. |
| AgentCatalog | AgentProfile, T3Connection | Rollen referenzieren vorhandene T3-Ziele. Secrets bleiben außerhalb öffentlicher DTOs. Capability- und Authänderungen sind versioniert. |
| Orchestration | Run, Dispatch, ResultReport, Approval, ExecutionSlot | Stabile Startidentität; keine zweite belegte Ausführung im gesperrten Scope; Meldung und Beobachtung bleiben getrennt; Freigabe ist an Revision und Ergebnisdigest gebunden. |
| Automation | Workflow, WorkflowInstance, RoutingRule, Schedule | Definitionen sind versioniert; Instanzen behalten ihren Snapshot; keine stillen Routenwechsel; Schleifen und Wiederholungen sind begrenzt. |
| History | ObjectRevision, ChangeRecord | Jede erfolgreiche fachliche Änderung hat eine unveränderliche redigierte Revision; alte Schemas bleiben lesbar; Wiederherstellung erzeugt eine neue Version. |
| Metrics | ProjectMetricProjection, MetricDefinition | Kennzahlen haben definierte Quellen, Zeiträume und Stichproben; Rebuilds erzeugen keine fachlichen Außenwirkungen. |
| Extensions | PluginInstallation, CapabilityRegistration | Pakete und aktivierte Fähigkeiten sind verschieden; Drain erhält Beobachtbarkeit; Deaktivierung löscht keine Historie. |
| Access | OwnerSession, TechnicalPrincipal, CredentialReference | Genau ein Eigentümer; technische Zugriffe sind projekt-/fähigkeitsbezogen; Secretwerte werden weder historisiert noch an die UI geliefert. |

## 3. Task und Board

Das Task-Aggregat hält Titel, Beschreibung, Kriterien, Status, Blockade, erlaubte Referenzen und Version. Link-Collections können wegen ihrer eigenständigen Reihenfolge eigene Aggregate mit Task-ID sein; ein Linkcommand prüft den aktuellen Task-/Projektscope. Anzahl und Länge werden in den API-Schemas begrenzt.

Boards besitzen eine eigene Version und eine Sichtdefinition. Eine Karte ist eine Darstellung desselben Tasks. Boardpositionen besitzen boardbezogene Ordnung. Das Verschieben in eine Statusspalte ist ein Task-Command; Sortieren innerhalb derselben Spalte ist ein Boardpositions-Command.

Ein harter WIP-Check betrifft alle aktiven Boards, deren Filter die Aufgabe nach der Änderung erfüllt. Die Prüfung und Änderung verwenden eine gemeinsame projektbezogene Konsistenzgrenze. Zwei gleichzeitig freie Plätze dürfen nicht durch voneinander unabhängige Taskversionen doppelt vergeben werden. Dasselbe gilt für gleichzeitiges Anlegen zyklischer Abhängigkeiten.

## 4. Klassifikation und menschliche Aufmerksamkeit

Classification besitzt Definition und Herkunft der Labels. WorkManagement besitzt die Zuordnung am Task. Eine öffentliche lokale Anwendungsschnittstelle validiert Label-IDs und nimmt die Taskänderung innerhalb derselben Transaktion vor. Ausgehende Modellaufrufe liegen außerhalb dieser Transaktion.

Eine ClassificationRecord ist ein unveränderlicher Entscheidungsnachweis: Eingaberevision, Taxonomie, Regeln, Modell-/Adapterversion, Frageversion, Antwortwerte, angewandte Schwellen und Ergebnis. Sie enthält keine pauschale Garantie, dass eine Modellwahrscheinlichkeit stimmt.

Ein offener Handlungsgrund besitzt intern stabile ID, Code, Task/Run/Intake-Bezug, Adressat, Entstehung, Auflösungsvoraussetzung und optionalen Auflösungszeitpunkt. Die API darf diese Daten kompakt als `human_attention` zusammenfassen. Eine Anfrage an den meldenden Agenten erzeugt nicht allein deshalb einen menschlichen Grund. Ein technischer Akteur kann offene Eigentümerentscheidungen nicht durch Labelschreiben erledigen.

## 5. Run und Workflow

Ein Run bindet Ticketrevision, Phase, Profil-/Promptversion, T3-Ziel, clientRequestId und die unveränderliche gesendete Startpayload. Der Referenzthread-Modus enthält aufgelöste Routingwerte; beim Projektstandard steht die wirksame T3-Auswahl erst nach erster Annahme fest. Die später veränderte Konfiguration darf einen Retry nicht semantisch verändern. Als Projektentscheidung gilt im MVP höchstens ein aktiver Run je T3-Projektbindung und je entsprechend begrenztem Profil.

Der Run endet nach seiner Phasenpolicy. Der Task endet nach seiner gesonderten Aufgabenpolicy. Ein Bearbeitungsergebnis darf deshalb einen Reviewlauf anstoßen, obwohl die Gesamtaufgabe noch nicht erfüllt ist. Menschlich bearbeitete Aufgaben erhalten keinen künstlichen Agentlauf.

Ein unbekannter externer Zustand hält den Ausführungsplatz konservativ belegt. Der lokale Status `abandoned` bedeutet aufgegebene lokale Bearbeitung; er beweist keine Beendigung des externen Agents. Erst der dokumentierte Abgleich beziehungsweise eine begründete manuelle Wiederherstellung löst die Quarantäne.

## 6. Shared Kernel und veröffentlichte Verträge

Gemeinsam sind nur IDs, Versionswert, Clock, ActorRef, Correlation/Causation-ID und Ereignisumschlag. Ein universelles Task-Objekt mit allen Infrastrukturfeldern gehört nicht in den Shared Kernel. Andere Module verwenden veröffentlichte DTOs, Query-Ports oder versionierte Ereignisse.

Domain Events bleiben fachlich benannt. Interne PHP-Klassennamen sind keine dauerhaften Schema-IDs. SQL-Migrationen, JSON-Schemas und Ereignisversionen werden zusammen dokumentiert. Lesende Projektionen dürfen gezielt über mehrere Tabellen lesen; fachliche Mutationen bleiben an den zuständigen Context gebunden.

## 7. Sicherheit der fachlichen Grenzen

Projekt- und Principalprüfungen erfolgen vor einer Mutation und erneut vor externen Wirkungen. Replay eines Idempotenzschlüssels gibt einem inzwischen gesperrten Principal keine alten Daten zurück. Prompt- und Tickettext sind Eingaben, keine Anweisung an den Autorisierungsmechanismus. Eine Decision darf nur vorhandene Auswahlwerte vorschlagen und keinen neuen Toolzugriff erzeugen.
