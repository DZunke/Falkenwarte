# Fachmodule, Verantwortungen und Regeln

Falkenwarte ist ein modularer Symfony-Monolith: die Anwendung läuft in einem Prozess, und ihre Fachmodule sind durch Verzeichnisse, veröffentlichte Application-Ports und statische Importregeln getrennt.

Die meisten Fachdatensätze werden als typisierte JSON-Datensätze über den gemeinsamen `Store` geladen und geändert. Es gibt keine eigene Aggregate- oder Repositoryklasse pro Ressource. Domain-Policies und Application-Handler setzen die fachlichen Guards um.

## Module und Datenverantwortung

| Modul | Verantwortung | Relevante Umsetzung |
|---|---|---|
| Portfolio | Projekte, Projektschlüssel, projektspezifische Abschlussregeln und Zusatzfelddefinitionen. | `src/Portfolio/Application/PortfolioHandler.php`, `src/Portfolio/Domain/ProjectSlug.php`, `src/Portfolio/Domain/CustomFieldPolicy.php` |
| WorkManagement | Aufgaben, Status, Boards, Labels, Link-Collections, Kriterien, Nachweise und fachliche Aufgabenhistorie. | `src/WorkManagement/Application/WorkHandler.php`, `src/WorkManagement/Domain/BoardWipPolicy.php`, `src/WorkManagement/Domain/TaskCompletionPolicy.php`, `src/WorkManagement/Domain/TaskLinkPolicy.php` |
| Classification | Intake, Klassifikationsnachweise, projektbezogene Decision-Policies und versionierte Workflowzuordnungen. `DecisionGateway` kapselt den technischen Bewertungsaufruf. | `src/Classification/Application/IntakeHandler.php`, `src/Classification/Domain/IntakeOutcome.php`, `src/Classification/Application/DecisionGateway.php` |
| AgentCatalog | T3-Verbindungen, Anmeldezustand, Projektbindungen und Agentprofile samt zulässigen Projekten und Ausführungsziel. | `src/AgentCatalog/Application/AgentCatalogHandler.php`, `src/AgentCatalog/Application/AgentCatalogReader.php`, `src/AgentCatalog/Domain/` |
| Orchestration | Runs und ihre T3-Versuche, Ergebnisberichte, Workflowdefinitionen und -instanzen, Trigger, Eigentümerentscheidungen sowie Wiederherstellungsinventur. | `src/Orchestration/Application/RunHandler.php`, `src/Orchestration/Domain/`, `src/Orchestration/Infrastructure/` |
| Automation | Prüfung von Workflowdefinitionen und Auswahl eines passenden Phasenübergangs. Das Modul speichert keine Workflowinstanzen und startet keine Runs. | `src/Automation/Domain/WorkflowDefinitionPolicy.php`, `src/Automation/Application/WorkflowPolicyService.php`, `src/Automation/Infrastructure/SymfonyWorkflowTransitionSelector.php` |
| Extensions | Vertrauenswürdige Pluginmanifeste, registrierte Beiträge, Capability-Gates und Aktivierungs-, Drain- und Entfernungsabläufe. | `src/Extensions/Application/PluginRegistry.php`, `src/Extensions/Application/PluginHandler.php`, `src/Extensions/Domain/PluginLifecyclePolicy.php` |
| Access | Eigentümerkonto und Sitzung, technische Principals, Fähigkeiten, technische Zugangsdaten und Geheimnisreferenzen. | `src/Access/Presentation/Access.php`, `src/Access/Application/AccessPersistence.php`, `src/Access/Domain/TechnicalCredential.php` |
| Metrics | Dashboard und wiederaufbaubare Messwerte aus gespeicherten Aufgaben, Runs und Ereignissen. | `src/Metrics/Application/MetricsHandler.php`, `src/Metrics/Domain/MeasurementWindow.php` |
| Operations | Ereignisjournal-Abfragen, Exporte, Backups und kontrollierte Wiederherstellung. | `src/Operations/Application/JournalHandler.php`, `src/Operations/Application/BackupHandler.php`, `src/Operations/Infrastructure/RestoreOfflineProcessor.php` |

`src/Shared/` enthält gemeinsam genutzte Ports und Werte wie `Actor`, `Clock`, `OperationHandler` und `Store`. `src/Shared/Infrastructure/DbalStore.php` implementiert Speicherung, Revisionen und Ereignisablage.

`src/Presentation/` stellt OpenAPI-Verträge, HTTP- und MCP-Einstiege sowie `Gateway` bereit. `src/Live/Infrastructure/Live.php` liefert Ressourcenhinweise über Mercure aus und speichert keine Fachzustände.

Es gibt kein eigenständiges `History`-Modul: Revisionen entstehen in `DbalStore`, werden über WorkManagement gelesen oder für unterstützte Datensätze wiederhergestellt und über Operations exportiert.

## Fachliche Regeln

| Bereich | Regel und Zuständigkeit |
|---|---|
| Projekt | `ProjectSlug` normalisiert den Projektschlüssel. `PortfolioHandler` legt beim Erstellen die Standardstatus an. `RunHandler` weist neue Runs in archivierten Projekten ab. |
| Aufgabenstatus | Kategorien sind `backlog`, `ready`, `active`, `review`, `done` und `cancelled`. Projekte können eigene Status innerhalb dieser Kategorien führen. Ein Wechsel in `done` prüft die projektspezifische `TaskCompletionPolicy`. |
| Boards und WIP | Boardspalten ordnen Projektstatus zu. `BoardWipPolicy` prüft harte Grenzen über alle aktiven Boards, deren Filter die geänderte Aufgabe einschließt. |
| Abhängigkeiten | Eine Aufgabe kann nur von Aufgaben desselben Projekts abhängen. `WorkHandler` weist Selbstabhängigkeiten und gerichtete Zyklen zurück. |
| Kriterien und Nachweise | Agenten und technische Principals melden Kriterien und Nachweise. Der Eigentümer bestätigt oder lehnt sie ab. Ein Nachweis gilt nur für die gebundene Aufgabenrevision und aktuelle Linkfassung. |
| Links | `TaskLinkPolicy` und `contracts/schemas/task-links.schema.json` begrenzen Referenzen auf syntaktisch gültige HTTP- oder HTTPS-URLs. Die Anwendung ruft die Ziele nicht ab. |
| Labels | WorkManagement verwaltet Label-IDs und die Arten `topic`, `workflow` und `attention`. Classification bietet aktive Themen- und Workflowlabels als Auswahl an. Systemverwaltete Attentionlabels gehören nicht zu dieser Taxonomie. |
| Intake | Technische Aufgabeneingänge erhalten einen Intake. Eine manuelle Aufgabe wird nur bewertet, wenn die Projektpolicy Klassifikation für manuelle Eingänge einschaltet. Ergebnisse sind an Aufgabenrevision sowie Taxonomie-, Policy- und Routingversion gebunden. |
| Runs | `RunHandler` speichert einen Snapshot der Aufgabenrevision, Rolle, Zielbindung, Workflowphase und Ausführungspolicy. Bei `RunHandler` belegt jeder Run in `ACTIVE_RUN_STATES` die T3-Projektbindung. Das Set enthält nicht `abandoned`. Dieser lokale Status hält nicht fest, ob T3 die Ausführung beendet hat. |
| Workflow | Definitionen werden versioniert. Eine laufende Instanz behält ihre verwendete Definition als Snapshot. `WorkflowDefinitionPolicy` verlangt vollständige Laufzeitgrenzen und eindeutige Übergänge. Die Policy begrenzt parallele Runs auf einen je T3-Projektbindung. |
| Eigentümerentscheidung | Approval bindet Runversuch, Aufgabenrevision und Ergebnisdigest. Bei einer Abweichung markiert `RunHandler` die Entscheidung als `invalidated`. |
| Plugin | Ein Beitrag ist nur bei aktiviertem Plugin und erfüllten Abhängigkeiten verfügbar. Drain stoppt neue Arbeit und wartet auf offene Runs, Jobs und externe Aktivität. Paketentfernung erfordert ein neues App-Image. |

## Gemeinsamer Änderungsweg

HTTP- und MCP-Aufrufe verwenden dieselbe `Presentation\Gateway`-Instanz und dieselben `OperationHandler`. Der Gateway prüft Vertrag, Akteur, Pluginvoraussetzung, Version und Idempotenz, bevor er eine Änderung ausführt.

`Store::atomic()` verbindet Datensatzänderung, Version, unterstützte Revision, Ereignisumschlag und lokale Action in einer DBAL-Transaktion. Dauerhafte Hintergrundaufträge liegen in `commands`. `Shared\Infrastructure\Consumer` leitet sie an den passenden Handler.

Infrastrukturadapter führen externe HTTP-, MCP-, OAuth- und Mercure-Aufrufe aus. Der Handler hält während eines externen Aufrufs keine lange SQLite-Schreibtransaktion offen.

Die Grenzen sind bewusst pragmatisch: die Domainklassen enthalten reine Policies, während einige Fachmodule ihre Datensatzregeln in Application-Handlern durchsetzen. `scripts/check-architecture.php` prüft insbesondere Layerimporte, veröffentlichte Application-Ports und Zugriffe auf den rohen DBAL-Anschluss.
