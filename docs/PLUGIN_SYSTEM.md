# Plugin-System und austauschbare Bridges

**Status:** Verbindlicher Fachvertrag aus Konzeptfassung 2.0. Der Umsetzungs- und Abnahmenachweis steht in [TRACEABILITY.md](TRACEABILITY.md).

## 1. Ziel

Plugins erweitern Falkenwarte über veröffentlichte Verträge. Sie dürfen deaktiviert werden, ohne dass Aufgaben, Historie oder alte Ergebnisse unlesbar werden. Die neue Fähigkeit entsteht in einem eigenen Paket; Änderungen am fachlichen Core sind dafür nicht vorgesehen.

Das System unterscheidet drei Ebenen:

1. **Installation:** Code und Assets sind im geprüften App-Image enthalten.
2. **Aktivierung:** Die Runtime-Registry erlaubt Beiträge und Anwendungsfälle.
3. **Nutzung:** Projekt und Principal dürfen die konkrete Fähigkeit verwenden.

Ein installiertes Plugin ist nicht automatisch aktiviert. Ein aktiviertes Plugin ist nicht automatisch für jeden technischen Agent-Principal freigegeben.

## 2. Vertragsarten

| Vertrag | Bedeutung |
|---|---|
| PluginManifest | Identität, Version, API-Kompatibilität und Beiträge |
| PluginDefinition | PHP-Registrierung vorhandener Implementierungen |
| CapabilityRegistry | Aktive Fähigkeiten und deren Anbieter |
| AgentExecutionBridge | Ausführung externer Agents |
| DecisionGateway | Fachliche Fragen und Antworten über Symfony AI / OpenAI Decisions |
| UiChangePublisher | Private Änderungshinweise über Mercure |
| DomainEventSubscriber | Reaktion auf veröffentlichte fachliche Ereignisse |
| ActionEventSubscriber | Reaktion auf Anwendungsaktionen |
| UiContribution | Vorinstallierte Komponente oder deklaratives Widget |
| MigrationProvider | Versionierte, plugin-eigene Datenmigrationen |

Die Dateien unter contracts/schemas enthalten den maschinenlesbaren Manifest- und Event-Umschlag. Der folgende PHP-Vertrag ist ein Architekturentwurf für eigene Klassen, kein Code aus dem Symfony-MCP-SDK.

~~~php
namespace Falkenwarte\Contracts\Execution;

interface AgentExecutionBridge
{
    public function capabilities(ConnectionReference $connection): BridgeCapabilities;

    public function dispatch(
        ImmutableDispatch $dispatch,
        ConnectionReference $connection,
    ): DispatchReceipt;

    public function observe(
        ExternalRunReference $run,
        ConnectionReference $connection,
    ): RunObservation;

    public function sendInput(
        ImmutableInput $input,
        ExternalRunReference $run,
        ConnectionReference $connection,
    ): DispatchReceipt;

    public function requestCancel(
        ImmutableCancellation $cancellation,
        ExternalRunReference $run,
        ConnectionReference $connection,
    ): CancellationReceipt;
}
~~~

ConnectionReference enthält die interne Connection-ID, Konfigurationsversion und Authentifizierungsgeneration. Das Auflösen eines Secrets geschieht im Infrastrukturadapter. Ein Domain-Objekt erhält keinen Bearer-Token.

ImmutableDispatch enthält die eingefrorene Auftragsrevision, Projekt-/Profilreferenzen, Korrelation, stabilen client_request_id und die fachlich benötigten Optionen. Die konkrete T3-Payload entsteht in der T3McpBridge und wird für wiederholte Aufrufe unverändert gespeichert.

DispatchReceipt bedeutet angenommene beziehungsweise wiedergefundene externe Arbeit. Ein Receipt ist kein erfolgreicher Abschluss. RunObservation enthält den normalisierten Zustand, den externen Originalstatus, Beobachtungszeit, Herkunft und verfügbare externe IDs.

## 3. Bridge als strukturelles Entwurfsmuster

Die fachliche Abstraktion ExecutionCoordinator kann unabhängig von der Implementierung AgentExecutionBridge weiterentwickelt werden. Ein anderer Workflow verändert den Coordinator, ohne T3-Transportcode zu ändern. Ein anderer Ausführungsdienst implementiert die Bridge, ohne Task-Regeln umzuschreiben.

Dieses Bridge-Pattern wird durch Ports und Adapter an der Clean-Architecture-Grenze realisiert. Die beiden Konzepte ergänzen sich. Ein Interface allein ohne klare Zuständigkeiten wäre noch kein vollständiger Integrationsvertrag.

Capabilities benennen konkrete Fähigkeiten und Grenzen, beispielsweise:

- start_with_initial_message
- observe_run
- send_input
- cancel_run
- idempotent_dispatch
- idempotency_scope
- reference_target_resolution

Die Werte kommen aus verifizierter Adapterkonfiguration oder einer externen Capability-Abfrage. Fehlt eine Fähigkeit, wird die entsprechende UI-/API-Aktion nicht angeboten oder klar abgewiesen. Es gibt keinen stillen Wechsel zu einer anderen Bridge.

Die zweite aktive Integrationsgrenze ist `DecisionGateway`: Der Classification-Service besitzt die fachlichen Fragen und Policies; `SymfonyAiDecisionAdapter` übersetzt diese in die gewählte Symfony-AI-Platform. Eine native beziehungsweise eng ergänzte OpenAI-Decisions-Bridge ist austauschbar, ohne Taxonomie, Intake oder Rückfragen umzuschreiben. Details und die Grenzen des offenen PR #2956 stehen in `docs/AI_DECISIONS.md`.

Falkenwarte implementiert in dieser Fassung keine Repository-, IssueTracker- oder Remote-Test-Bridge. Eine Erweiterung dieser Verantwortung benötigt eine neue Scope-Entscheidung. Das Beispielplugin `falkenwarte.link-notes` ergänzt ausschließlich lokale Notizen zu vorhandenen Linkreferenzen; es ruft keine URLs ab.

## 4. Manifest

Jedes Paket liefert ein statisches Manifest. Das Beispiel in contracts/examples/plugin-manifest.json beschreibt ein eigenes geplantes Beispielplugin und behauptet nicht, dass dieses Composer-Paket bereits veröffentlicht wurde.

Pflichtfelder sind:

- id, version, name und description.
- contract_version.
- api_compatibility für Backend und optional Frontend.
- dependencies mit benötigter Plugin-ID und Versionsbereich.
- capabilities mit registrierten Implementierungs-IDs.
- subscriptions mit Ereignistypen und Schema-Versionen.
- settings_schema für die Projekt-/Plugin-Konfiguration.
- migrations mit eigenem Namespace und aktueller Datenversion.
- ui mit freigegebenen Beitragspunkten.
- data_retention.

Das Manifest enthält keine Secrets, frei auszuführenden Shellkommandos oder beliebige JavaScript-URLs. Einstellungen dürfen Secret-Referenzen anfordern. Ein Schemafeld im Passwortmodus ist noch kein Secret-Speicher; der Server behandelt es ausdrücklich als write-only.

## 5. Backend-Registrierung

Die Composer-Pakete und Symfony-Services werden beim Image-Build registriert. Compiler-Passes erfassen PluginDefinition-Implementierungen und prüfen auf doppelte IDs. Die Runtime-Registry wird aus diesen Definitionen und dem Datenbankstatus aufgebaut.

Jeder öffentliche Einstieg prüft:

1. Installierte Paketversion passt zur Contract-Version.
2. Plugin ist für die konkrete Aktion aktiviert.
3. Erforderliche Abhängigkeiten sind aktiv.
4. Projekt- und Principal-Rechte erlauben die Aktion.
5. Die verwendete Konfigurationsversion ist nachvollziehbar.

Ein registrierter Service darf nicht allein durch direkten Containerzugriff als öffentlich nutzbare Fähigkeit behandelt werden. MCP-Tools, Controller und Worker gehen durch dieselben Gates.

Vor einem externen Effekt prüft der Worker den aktuellen Zustand erneut. Bereits akzeptierte Arbeit behält ihre Konfigurations- und Paketreferenz. Die Drain-Policy bestimmt ausdrücklich, welche Fortsetzungs-/Beobachtungsaktionen während der Deaktivierung erlaubt bleiben.

Die Pluginverwaltung zeigt aktive Aufträge, wartende Arbeit, ungeklärte externe Aktivitäten und namentlich die aktivierten Abhängigkeiten, die eine Deaktivierung verhindern. Nach Klärung offener Arbeit kann der Eigentümer den Drain erneut prüfen. Bei Linknotizen lässt ein leerer Labelfilter alle Tickets zu. Das Speichern prüft die beim Bearbeiten geladene Pluginrevision und weist veraltete Änderungen mit HTTP 412 zurück.

Der Drain-Auftrag liefert eine Action-ID. Sobald der Worker seine Prüfung abgeschlossen hat, zeigt die Action `succeeded`. Bestätigt er dabei den bereits gespeicherten Zustand und dieselben Arbeitszähler, bleibt die Pluginrevision gültig. Ein Wechsel auf `disabled` oder geänderte Zähler erzeugen eine neue Revision.

## 6. Frontend-Registrierung

Komplexe React-Beiträge werden beim Frontend-Build aufgenommen. Die Registry enthält stabile component_id-Werte; der Server liefert nur IDs aktivierter und erlaubter Beiträge. Der Client lädt die passende vorinstallierte Komponente.

Unterstützte Beiträge:

| Slot | Typischer Beitrag |
|---|---|
| global.navigation | Eigene Seite innerhalb der bekannten Router-Struktur |
| project.tabs | Projektbezogene Ansicht |
| task.tabs | Linknotizen oder zusätzliche lokale Fachinformationen |
| dashboard.widgets | Kleine datenbezogene Übersicht |
| task.actions | Erlaubter Anwendungsfall mit Bestätigung und Ergebniszustand |
| settings.sections | Typisiertes Konfigurationsformular |

Der Server bleibt für Berechtigungen und Actions maßgeblich. Ein ausgeblendeter Button ist keine Zugriffskontrolle.

Ein deklaratives Widget kann Tabellen, Kennzahlen, Text und Links aus einem freigegebenen Schema verwenden. Dadurch können zusätzliche Einstellungen und Darstellungen ohne neuen JavaScript-Code entstehen. Beliebiges remote geladenes JavaScript ist keine MVP-Fähigkeit.

UI-Beiträge verwenden dieselben shadcn-Tokens, Query-/Mutation-Patterns und Live-Invalidierung wie der Core. Mercure liefert Änderungshinweise; Daten werden über den typisierten JSON-Client bezogen.

## 7. Migrationen und Datenbesitz

Jedes Plugin besitzt einen eindeutigen Tabellenpräfix, beispielsweise plg_link_notes_. Es verändert keine privaten Core-Tabellen. Verweise auf Core-IDs erfolgen über veröffentlichte Verträge und dokumentierte Referenzen.

Eine Migration wird mit Plugin-ID, Datenversion und Checksumme registriert. Vor Aktivierung laufen erforderliche Migrationen unter derselben zentralen Migrationssperre. Fehlschläge lassen das Plugin im letzten sicheren deaktivierten Zustand.

Additive Migrationen sind der Standard. Destruktive Änderungen erfordern einen vorherigen Export und eine separate Betriebsentscheidung. Uninstall löscht keine Daten durch einen versteckten Down-Migration-Aufruf.

Historische Ereignisse und Objektrevisionen enthalten Schema- und Plugin-Version. Nach Deaktivierung bleibt ein generischer JSON-/Text-Viewer verfügbar. Das Deserialisieren alter Historie darf keine entfernte PHP-Klasse benötigen.

## 8. Aktivierung, Drain und Deaktivierung

| Übergang | Voraussetzungen und Wirkung |
|---|---|
| discovered -> installed_disabled | Manifest und Paket vorhanden; API kompatibel |
| installed_disabled -> enabling | Eigentümeraktion, Abhängigkeiten und Einstellungen geprüft |
| enabling -> enabled | Migrationen und Registrierungsprüfung erfolgreich |
| enabled -> draining | Keine neuen Aufträge; vorhandene Ausführungen bleiben beobachtbar |
| draining -> disabled | Keine von der Fähigkeit abhängige aktive oder ungeklärte Arbeit |
| disabled -> uninstall_pending | Eigentümer erstellt einen Entfernungsplan; aktive Arbeit und aktivierte Abhängigkeiten sind ausgeschlossen, neue Nutzung wird gesperrt |
| uninstall_pending -> removed | Maintenance bestätigt nach einem Imagewechsel ohne Paketmanifest die Entfernung und speichert Zustandsrevision, Domain-Event und abgeschlossenen Plan |
| removed -> removed | Das Tombstone und die Pluginhistorie bleiben bei weiteren Images ohne Paket erhalten |

Der Entfernungsplan löscht weder Plugin-Daten noch Konfiguration. Vor dem Imagewechsel kann der Eigentümer ihn zurücknehmen; der vorherige sichere deaktivierte Zustand wird wiederhergestellt.

Drain ist selbst eine asynchrone Action. Die UI zeigt aktive Runs, abhängige Plugins und den Grund einer Blockade.

Eine ausdrücklich erzwungene lokale Deaktivierung darf nicht gleichzeitig behaupten, ein externer Agent sei beendet. Bei ausdrücklich aufgegebener Arbeit bleiben betroffene Ausführungsplätze quarantänisiert. Ein Owner kann später eine getrennte Wiederherstellung oder externe Beendigung dokumentieren.

## 9. Paketänderungen über API und Betrieb

Die Plugin-Ansicht kann Installationspläne für `registry` und `local_build` sowie Entfernungspläne für installierte, deaktivierte Plugins erstellen. Ältere Installationsaufrufe ohne `operation` bleiben gültig und gelten weiter als Installation.

Ein Entfernungsplan wird abgewiesen, solange das Plugin aktiv ist, noch Runs oder ungeklärte externe Arbeit besitzt oder ein aktiviertes beziehungsweise drainendes Plugin davon abhängt. Die Erstellung setzt Plugin und Plan atomar auf `uninstall_pending` und `prepared`; damit sind die Fähigkeit und Konfigurationsänderungen gesperrt, während das Paket im aktuellen Image und die lokalen Daten erhalten bleiben.

Vor dem Imagewechsel kann der Eigentümer einen vorbereiteten Entfernungsplan zurücknehmen. Ist das Paket im laufenden Image vorhanden und stimmt der Plan noch mit dem Pluginzustand überein, setzt die Anwendung den vorherigen sicheren deaktivierten Zustand wieder her und markiert den Plan als `cancelled`.

Nach einem Imagewechsel ohne Manifest erkennt der laufende Maintenance-Command den vorbereiteten Entfernungsplan. Er persistiert `removed` und `completed` atomar, schreibt eine Pluginrevision und ein Domain-Event und bewahrt die gespeicherte Konfiguration sowie vorhandene Historie. Das API-Tombstone zeigt nur an, ob Konfiguration vorhanden ist; deren Werte sind ohne das Pluginmanifest nicht lesbar. Spätere Images ohne Paket erhalten diesen Abschlusszustand.

Der Export lädt den gespeicherten Plan über `GET /plugin-install-plans/{plan_id}` und speichert die API-Ressource als JSON-Datei. Das geprüfte Image und dessen Neustart setzt der Betreiber nach eigener Prüfung um; die Webanwendung führt keine Composer-, Shell- oder Containeraktion aus.

Der tatsächliche Composer-/Frontend-Build erfolgt im Projekt-/CI-Prozess. Das neue Image enthält eine vollständige, überprüfte Pluginmenge. Der lokale Betreiber startet den einen App-Container mit diesem Image neu.

Dieser Ablauf erfüllt dynamische Funktionserweiterung ohne Core-Änderung. Die Laufzeitaktivierung ist unmittelbar; die Installation neuen ausführbaren Codes besitzt eine kontrollierte Build-Grenze.

## 10. Ereignisverarbeitung durch Plugins

Subscriber erhalten versionierte Umschläge, keine lebenden Domain-Objekte. Eine lokale Folgeänderung verwendet den veröffentlichten Application-Vertrag des Zielmoduls.

Inbox-Marker und lokale Wirkung werden atomar gespeichert. Externe Effekte entstehen aus einer eigenen Outbox. Subscriber verwenden ursprüngliche correlation_id und eine neue causation_id. Schleifentiefe und wiederholte identische Auslösung werden begrenzt.

Ein deaktivierter Subscriber kann spätere Ereignisse je nach konfigurierter Policy überspringen oder nach Aktivierung begrenzt nachholen. Diese Policy wird im Manifest beschrieben. Ein Metrik-Rebuild darf keine Ausführungs-Subscriber auslösen.

## 11. Plugin-Abnahme

Das Plugin-System gilt erst als nachgewiesen, wenn:

1. Ein zweites kleines Plugin eine neue Fähigkeit und UI-Darstellung ohne Änderung einer Core-Domain-Datei ergänzt.
2. Aktivierung bei fehlender Abhängigkeit scheitert.
3. Deaktivierung mit laufendem Run sichtbar wartet.
4. Nach Deaktivierung Tool, API-Aktion und UI-Beitrag gesperrt sind, historische Daten lesbar bleiben und bei erneuter Aktivierung korrekt verwendet werden.
5. Ein fehlerhafter Manifest-/Migrationsstand das Gesamtsystem nicht unbemerkt aktiviert.

Die Plugin-Abnahme wird als E2E über die gestartete Anwendung durchgeführt. Es werden keine Plugin-Unit- oder Component-Tests eingeführt. Die Bridge-Mocks ersetzen externe Dienste am Netzwerk, nicht die zu prüfende produktive Adapterimplementierung.
