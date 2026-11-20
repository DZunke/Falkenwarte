# Plugin-System und Erweiterungen

Plugins liefern versionierte, vorinstallierte Fähigkeiten. Ein geprüftes App-Image enthält den Code. Der Datenbankstatus steuert Aktivierung und Nutzung. Die Anwendung lädt keine beliebigen PHP-Pakete oder JavaScript-Dateien zur Laufzeit.

## Registrierung und Gates

`config/services.php` markiert Services, die `PluginDefinition` oder `PluginEventSubscriber` implementieren. `PluginRegistry` liest ihre Manifeste und prüft Plugin-ID, Contract-Version, Semver, Capability-Zuordnung, Abhängigkeiten und doppelte Bridge-Provider.

Eine Fähigkeit ist nur nutzbar, wenn das Plugin den Zustand `enabled` hat und seine Abhängigkeiten erfüllt sind. Die Registry filtert damit UI-Beiträge und MCP-Werkzeuge. Application-Handler prüfen zusätzlich Projekt-, Principal- und Aktionsrechte.

Der Vertrag erwartet ein statisches Manifest mit Paketidentität, Version, Fähigkeiten, Abhängigkeiten, Event-Abonnements, Konfigurationsschema, Migrationen, UI-Beiträgen und Aufbewahrungsregeln. Eigene Implementierungen verwenden `PluginDefinition` und `PluginCapability`. Siehe [Plugin-Vertrag](../src/Extensions/Application/PluginDefinition.php), [Registry](../src/Extensions/Application/PluginRegistry.php) und [Symfony-Service-Konfiguration](../config/services.php).

## Installierte Beispiele

| Plugin | Bereitgestellter Beitrag | Betriebsgrenze |
|---|---|---|
| `falkenwarte.t3-mcp-bridge` | `execution.bridge`, Adapter-ID `t3.mcp.v0_1_10`. Standardzustand `enabled` | Stellt die T3-Ausführungsbridge bereit. Enthält keine Plugin-Migration |
| `falkenwarte.link-notes` | Capability `links.notes`, UI-Beitrag `task.tabs / link-notes.tab` und vier MCP-Werkzeuge | Speichert lokale Notizen zu registrierten Tasklinks. Lädt deren URLs nicht |

Die Linknotizen begrenzen den Text auf 1 bis 2.000 Zeichen. Eine Notiz wird nur an eine Link-ID angehängt, die bereits bei derselben Aufgabe registriert ist. Änderungen erzeugen Revisionen und Entfernen erhält den historischen Eintrag. Die Einstellung `enabled_labels` kann auf Label-IDs begrenzen. Eine leere Liste gilt für alle Aufgaben.

Die Implementierung steht im [Link-Notes-Manifest](../packages/link-notes/manifest.json), im [Paketcode](../packages/link-notes/src/PluginDefinition.php) und in der vorinstallierten [LinkNotesPanel-Komponente](../frontend/src/features/plugins/LinkNotesPanel.tsx).

## Aktivierung und Stilllegung

Die Eigentümer-API unter `/api/v1/plugins` verwaltet Zustand und Konfiguration. Aktivierung verlangt die bestätigte Contract-Version, erfüllte Abhängigkeiten und ein gültiges Konfigurationsschema. Sie stellt zunächst einen Auftrag ein und wechselt von `enabling` zu `enabled`.

Ein Drain mit `finish_active` oder `request_cancel` sperrt neue Plugin-Nutzung und wartet auf aktive Runs, wartende Jobs und ungeklärte externe Aktivität. Die zweite Policy fordert bei Provider-Runs Abbruch an. Der Zustand wird erst `disabled`, wenn die Arbeit abgeglichen ist. Danach kann der Eigentümer deaktivieren, sofern kein aktives Plugin davon abhängt.

| Zustand | Bedeutung |
|---|---|
| `installed_disabled` | Code ist im Image, Beiträge sind ausgeschaltet |
| `enabling` / `draining` | Aktivierung oder Abwicklung läuft asynchron |
| `enabled` | Capability- und Beitragsgates können geöffnet sein |
| `disabled` | Drain beendet. Für dauerhafte Deaktivierung bereit |
| `uninstall_pending` | Entfernen ist geplant, Nutzung und Konfigurationsänderung sind gesperrt |
| `removed` | Neues Image enthält das Paket nicht mehr. Daten und Tombstone bleiben |

## Paketänderung und Aufbewahrung

`POST /api/v1/plugin-install-plans` erstellt eine Installations- oder Entfernungscheckliste. Der Plan führt keine Composer-, Shell- oder Containeraktion aus. Installation benötigt ein geprüftes neues Image und Neustart.

Eine Entfernung ist nur nach Drain, ohne aktive oder ungeklärte Arbeit und ohne aktive abhängige Plugins möglich. Vor dem Imagewechsel kann der Eigentümer den vorbereiteten Plan zurücknehmen. Sobald Maintenance in einem neuen Image das Manifest nicht mehr findet, markiert es Plugin und Plan atomar als `removed` und `completed`. Konfiguration, Notizen und historische Daten werden nicht automatisch gelöscht.

Die Plugin-Manifeste bestimmen außerdem `on_disable` und `on_uninstall`. Ein deaktiviertes Paket bleibt im Image und seine Daten bleiben erhalten. Die Anwendung ist kein Paketmanager und kann ein bereits entferntes PHP-/Frontend-Paket nicht aus einem Plan wiederherstellen.

## Dauerhafte Events

Ein Paket-Subscriber muss Plugin-ID, Consumer-ID und Eventtyp benennen. Dieselbe Subscription muss im Manifest mit Schema-Version deklariert sein. Maintenance ruft die Event-Dispatcher-Schleife ungefähr alle zwei Sekunden auf und verarbeitet nur Subscriber aktivierter Plugins.

Der Dispatcher speichert Cursor und Subscriber-Wirkung in Datenbanktransaktionen, prüft Eventtyp und Schema-Version und verarbeitet höchstens 250 Journalzeilen je Batch. Beim erstmaligen Cursor werden standardmäßig nur die letzten 1.000 Ereignisse als Catch-up angeboten. Das Manifest kann den Grenzwert setzen. Subscriber bleiben für wiederholte Ereignisse zuständig und müssen ihre Wirkung idempotent machen.

Die Link-Notes-Projektion verarbeitet `work.link_registered`, speichert eine Inbox-ID und baut die lokale Linkprojektion neu auf. Sie hat keine externen Seiteneffekte. Details: [Event-Dispatcher](../src/Extensions/Infrastructure/RegisteredPluginEventDispatcher.php), [LinkRegisteredSubscriber](../packages/link-notes/src/Subscribers/LinkRegisteredSubscriber.php) und [Persistenz](../packages/link-notes/src/Infrastructure/DbalLinkNoteRepository.php).

## Geprüfte Grenzen und Quellen

- Der Browser lädt nur vorinstallierte, zur Manifest-ID passende UI-Komponenten. Ein Manifest allein führt keinen beliebigen Frontend-Code aus.
- Ein Plugin-MCP-Werkzeug benötigt zugleich die erklärte Plugin-Capability und seine fachlichen Falkenwarte-Capabilities.
- Plugin-Deaktivierung löscht keine Daten und beendet externe Arbeit nicht ohne beobachtete Bestätigung.
- [OpenAPI-Vertrag](../contracts/openapi.yaml): Pluginstatus, Konfiguration, Drain und Paketänderungspläne.
- [Symfony Service Container](https://symfony.com/doc/current/service_container.html) und [Symfony Dependency Injection Tags](https://symfony.com/doc/current/service_container/tags.html).
