# Quellen, Versionsbasis und Kompatibilitätsgrenzen

**Recherchestand: 19. November 2026.** Dieses Verzeichnis dokumentiert Primärquellen und die recherchierte Versionsbasis. Die tatsächlich aufgelösten Versionen stehen in `composer.lock`; Laufzeit- und Integrationsprüfungen werden mit ihren Ergebnissen in [VALIDATION.md](VALIDATION.md) dokumentiert.

Quellen mit einem Git-Tag wurden zusätzlich anhand der betreffenden Datei geprüft. Die Dokumentation unter `current` bzw. `main` kann einer veröffentlichten Version voraus sein. Besonders bei Symfony AI und MCP muss der ausgewählte Tag maßgeblich sein.

## Technische Zielbasis und geprüfte Kompatibilitätsgrenzen

| Bereich | Auswahl für Falkenwarte | Nachgewiesener Stand / Begründung |
|---|---|---|
| PHP | Aktuelle gepatchte **8.5.x** im Image; Composer `~8.5.0` | PHP 8.5 ist stabil, aktive Unterstützung bis 31.12.2027, Sicherheitsunterstützung bis 31.12.2029. [S2] |
| Symfony | **7.4 LTS**, reguläre Komponenten `7.4.*` | Zum Recherchestand 7.4.23; Fehlerkorrekturen bis November 2028, Sicherheit bis November 2029. [S1] |
| Doctrine DBAL | `doctrine/dbal:^4.6` | Aktuell 4.6.0; DBAL 3 befindet sich nur noch im Life-Support. [S3] |
| DoctrineBundle | `doctrine/doctrine-bundle:^3.4` | Aktuell 3.4.2, verlangt PHP ^8.4 und DBAL ^4.0; PHP 8.5 ist eingeschlossen. [S3] |
| MigrationsBundle | `doctrine/doctrine-migrations-bundle:^4.0` | Aktuell 4.0.1, DBAL-only verwendbar. [S3] |
| Doctrine Migrations | `doctrine/migrations:^3.9`, wenn explizit deklariert | Aktuell 3.9.8; kommt bereits über MigrationsBundle. [S3] |
| DB-Queue | `symfony/doctrine-messenger:7.4.*` | DBAL-Transport ohne obligatorisches ORM. [S11] |
| MCP Bundle | **`symfony/mcp-bundle:1.0.0-BETA1`** | Bewusst gewählter, exakt fixierter Beta-Release. [S4] |
| MCP SDK | **`mcp/sdk:0.9.0`** | Passt zur Bundle-Anforderung `^0.9`. 0.10 ist damit ausdrücklich ausgeschlossen. [S4–S5] |
| Symfony AI | Gesperrte Basis: **`symfony/ai-bundle:1.0.0-BETA1`**, **`symfony/ai-platform:1.0.0-BETA1`** und **`symfony/ai-open-ai-platform:1.0.0-BETA1`** | Das veröffentlichte Paket enthält keinen nativen OpenAI-Decisions-Client; Falkenwarte führt den Decisions-Aufruf über eine eigene Infrastrukturimplementierung hinter Symfony AIs `PlatformInterface`. [S6–S8] |
| OpenAI-Decisions-Anbindung | Umsetzung: `DecisionGateway → SymfonyAiDecisionAdapter → PlatformInterface → OpenAiDecisionsPlatform` | PR #2956 war am 19. November 2026 offen/unmerged. Der lokale Mocklauf belegt den Adapterpfad, nicht den Zugriff auf einen echten OpenAI-Account. [S7–S8] |
| PSR-HTTP-Implementierung | `nyholm/psr7:^1.8`, sofern für den MCP-HTTP-Pfad benötigt | Explizite PSR-7/17-Implementierung; Bestandteil der MCP-Bundle-Testintegration. [S4] |
| HTTP-Laufzeit | Debian-basiertes FrankenPHP-Image mit PHP 8.5, konkreter Digest | Classic-Modus als Ausgangspunkt; mehrere überwachte Prozesse in einem App-Container. [S12–S14] |
| Mercure-PHP-Integration | **`symfony/mercure-bundle:0.7.0`**, **`symfony/mercure:0.10.0`** | Unterstützen modernes Mercure-Protokoll 1.0, getrennte Publisher-/Subscriber-Konfiguration und Symfony 7.4 / PHP 8.5. Beide initial exakt sperren. [S26] |
| Mercure-Hub | Eingebettetes Caddy-Modul; recherchierte Zielbasis **v1.1.6** | Offizielle FrankenPHP-Builds enthalten Mercure; Aktivierung in Caddyfile nötig. Die tatsächlich enthaltene Modulversion muss zu Protokoll und PHP-Paketen passen und in M0 nachgewiesen werden. [S27–S28] |
| SQLite | Tatsächlich geladene Bibliothek mit WAL-Reset-Fix | >=3.51.3 oder dokumentierter Distributions-Backport; ein PHP-Versionstag allein beweist den Fix nicht. [S15] |

Die aufgelösten Paketstände stehen in `composer.lock`; die AI-/MCP-Beta-Pakete sind einzeln exakt gepinnt. Die Beta1-Basis enthält keine native Decisions-Leitung, daher implementiert Falkenwarte den Adapter über die veröffentlichte `PlatformInterface`. Dieser Architekturpfad wurde lokal gegen den Decisions-Mock ausgeführt; ein echter Provideraufruf und ein Upgrade auf eine spätere native Releasefähigkeit bleiben separate Nachweise. [S4–S8]

Falkenwarte führt Entwicklungsaufträge ausschließlich über T3 aus. Nicht manuell eingehende Tickets durchlaufen verpflichtend OpenAI Decisions über Symfony AI; ein nicht verfügbarer Klassifikator führt zu einem sichtbaren Wartezustand, nicht zu einer ungeprüften Freigabe. Diese Pflicht und die Grenze zur T3-Ausführung sind Projektentscheidungen; ihre konkreten Verträge stehen in [AI_DECISIONS.md](AI_DECISIONS.md).

### Reguläre Symfony-Komponenten

Der tatsächlich benötigte Satz wird aus dem Symfony-Skeleton ergänzt. Für das Konzept sind insbesondere `symfony/framework-bundle`, `symfony/runtime`, `symfony/console`, `symfony/dotenv`, `symfony/yaml`, `symfony/messenger`, `symfony/workflow`, `symfony/event-dispatcher`, `symfony/serializer`, `symfony/validator`, `symfony/security-bundle`, `symfony/security-csrf`, `symfony/http-client`, `symfony/cache`, `symfony/lock`, `symfony/clock` und `symfony/uid` vorgesehen, jeweils im Releasezug `7.4.*`. Ein zusätzlicher `symfony/scheduler` ist nur nötig, wenn der gewählte Maintenance-Adapter den Scheduler tatsächlich verwendet. [S1, S11, S17–S18]

Benötigte PHP-Funktionen werden im Image und über Composer-Plattformanforderungen überprüft, insbesondere PDO/SQLite, Fileinfo und die für geordneten Worker-Shutdown verwendete PCNTL-Erweiterung. Die konkrete Erweiterungsliste folgt dem aufgelösten Lockfile; sie wird nicht aus dem Namen des Basisimages abgeleitet.

Im Checkout starten HTTP, Console und Worker über Symfony Runtime und Dotenv. Der Servicecontainer verbindet die Application-Ports mit ihren Infrastrukturadaptern und sammelt die Handler für HTTP und MCP. Die Paketkonfiguration liegt unter `config/packages/`. Mit `php bin/console debug:container --tag=app.operation_handler` lassen sich die registrierten Handler prüfen. Die Standardwerte und ihre Überschreibung beschreibt das [Betriebshandbuch](OPERATIONS.md).

Symfony Security authentifiziert technische Principals am MCP-Endpunkt. Die Owner-Anmeldung verwendet den Symfony PasswordHasher und speichert Sitzungen mit ihren CSRF-Tokens in SQLite. Serializer dekodiert JSON für die anschließende Prüfung gegen den OpenAPI-Vertrag. Symfony Cache hält das aufbereitete OpenAPI-Dokument vor. Symfony Workflow ermittelt die aus der aktuellen Stufe erreichbaren Übergänge anhand der gespeicherten Definitionsversion. Messenger stellt dauerhafte Aufträge zu, die T3- und Decisions-Adapter verwenden getrennte Symfony-HTTP-Clients.

### Composer-Regeln für diese Auswahl

- `minimum-stability` bleibt `stable`; notwendige Beta-Pakete werden einzeln durch ihre exakte Version zugelassen. Kein globales `dev` als Workaround.
- Die Freigabe eines Beta-Pakets gilt nicht automatisch für alle transitiven Beta-Abhängigkeiten. Der tatsächlich gewählte AI-Paketgraph muss ausdrücklich aufgelöst werden. Die recherchierte OpenAI-Beta1-Bridge hängt beispielsweise von `ai-open-responses-platform` ab; dieser Paketname bedeutet keinen Responses-Fallback im Produkt. [S6]
- `prefer-stable: true` kann zusätzlich verwendet werden, ersetzt aber keine bewusste Versionsauswahl.
- Das PHP-Basisimage wird auf Patchstand und Digest fixiert. Der Composer-Plattformwert muss der tatsächlich unterstützten Laufzeit entsprechen; Plattformprüfungen dürfen nicht mit `--ignore-platform-reqs` umgangen werden.
- `doctrine/orm` und `symfony/orm-pack` werden nicht installiert. Ein optionaler Root-`conflict` auf beide Pakete kann diese Projektgrenze automatisiert absichern.
- Die eigene `config.allow-plugins`-Liste ist explizit. Die Konfiguration fremder Pakete wird nicht als automatisch geerbte Zustimmung behandelt.
- Der Kompatibilitätsnachweis umfasst Composer-Auflösung, `composer validate`, Plattformprüfung, Start von HTTP und Worker sowie einen echten MCP-Handshake und mindestens einen Lese-/Schreib-Rundlauf mit Testdaten. Er ist noch kein bereits durchgeführtes Ergebnis dieses Konzeptpakets.

Grundlage für Versions-, Root- und Stabilitätssemantik: [S19].

## Quellenverzeichnis

### S1 — Symfony-Releases und Support

- [Offizielle Releaseübersicht](https://symfony.com/releases)
- [Symfony 7.4 LTS](https://symfony.com/releases/7.4)
- [Symfony-Releaseprozess](https://symfony.com/doc/current/contributing/community/releases.html)

Belegt die Wahl von 7.4 LTS. Symfony 8.1.11 ist zum Recherchestand die aktuelle stabile Kurzzeitversion mit Supportende Januar 2027; 8.2 ist noch Beta. Die Wahl von 7.4 ist eine bewusste Wartungsentscheidung, kein fehlender Zugang zu Symfony 8.

### S2 — PHP-Unterstützung

- [PHP Supported Versions](https://www.php.net/supported-versions.php)
- [Offizielle PHP-Releases](https://www.php.net/releases/)

PHP 8.5 wurde am 20.11.2025 veröffentlicht. PHP 8.4 wäre ebenfalls kompatibel, erreicht aber bereits Ende 2028 sein Sicherheits-Supportende. Für das neue Projekt ist daher PHP 8.5 gewählt.

### S3 — DBAL, DoctrineBundle und Migrationen ohne ORM

- [Doctrine DBAL: gepflegte Versionen](https://www.doctrine-project.org/projects/dbal.html)
- [DoctrineBundle Paketmetadaten](https://packagist.org/packages/doctrine/doctrine-bundle)
- [MigrationsBundle Paketmetadaten](https://packagist.org/packages/doctrine/doctrine-migrations-bundle)
- [Doctrine Migrations Paketmetadaten](https://packagist.org/packages/doctrine/migrations)
- [MigrationsBundle 4.0.1: Connection-/EntityManager-Konfiguration](https://github.com/doctrine/DoctrineMigrationsBundle/blob/4.0.1/src/DependencyInjection/DoctrineMigrationsExtension.php)
- [Symfony 7.4: DBAL-Verwendung](https://symfony.com/doc/7.4/doctrine/dbal.html)

Die genannten Doctrine-Bundles benötigen ORM nicht zur Laufzeit. ORM erscheint in Teilen ihrer eigenen Entwicklungsabhängigkeiten. Für Falkenwarte wird ausschließlich eine DBAL-Connection konfiguriert; Migrationen erhalten eine `connection`, keinen Entity Manager. Installationsbeispiele mit `orm-pack` werden für dieses Projekt nicht übernommen.

### S4 — Symfony MCP Bundle, Server und Client

- [MCP-Bundle-Dokumentation](https://symfony.com/doc/current/ai/bundles/mcp-bundle.html)
- [Paketmetadaten](https://packagist.org/packages/symfony/mcp-bundle)
- [Beta1: tatsächliche Composer-Anforderungen](https://github.com/symfony/mcp-bundle/blob/v1.0.0-BETA1/composer.json)
- [Beta1: Konfigurationsschema](https://github.com/symfony/mcp-bundle/blob/v1.0.0-BETA1/config/options.php)
- [Beta1: Bundle-Integration und Kernel-Reset](https://github.com/symfony/mcp-bundle/blob/v1.0.0-BETA1/src/McpBundle.php)
- [Bereits in 0.15: Client-Vertrag](https://github.com/symfony/mcp-bundle/blob/v0.15.0/src/Client/ServerConnectionInterface.php)

Server und Client sind vorhanden. Das Bundle unterstützt stdio und Streamable HTTP, benannte externe Verbindungen und Authentisierungsheader. Die Serverrolle wird mit Symfony Security geschützt. Eine eigene vollständige OAuth-Tokenausgabe, Zustimmung und Clientregistrierung sind keine automatische Bundle-Funktion. Die reguläre Konfiguration und die Attributregistrierung sind in den Symfony-Servicecontainer eingebunden; dynamische Nutzereinstellungen benötigen eine explizite Runtime-Registry bzw. Factory.

### S5 — Offizielles MCP PHP SDK und die 0.9-/0.10-Grenze

- [Offizielles Repository](https://github.com/modelcontextprotocol/php-sdk)
- [Paketmetadaten](https://packagist.org/packages/mcp/sdk)
- [SDK 0.9.0: Changelog](https://github.com/modelcontextprotocol/php-sdk/blob/v0.9.0/CHANGELOG.md)
- [SDK 0.9.0: Client-Code und Verbindungs-Retries](https://github.com/modelcontextprotocol/php-sdk/blob/v0.9.0/src/Client.php)
- [SDK 0.10.0: dokumentierte API-Brüche und OAuth-Client](https://github.com/modelcontextprotocol/php-sdk/blob/v0.10.0/CHANGELOG.md)
- [Aktuelle OAuth-Client-Dokumentation](https://php.sdk.modelcontextprotocol.io/client/authorization/)
- [Experimenteller Status und Konformitätsgrenzen von 0.9](https://github.com/modelcontextprotocol/php-sdk/blob/v0.9.0/docs/sdk-tier.md)

SDK 0.10.0 ist veröffentlicht, passt aber nicht zu `mcp-bundle:1.0.0-BETA1`, das `^0.9` fordert. 0.10 führt Namespaceänderungen und einen wesentlich erweiterten OAuth-Client ein. Diese Fähigkeiten werden der ausgewählten 0.9-Basis nicht zugeschrieben. Für die T3-Verbindung ist zunächst der dokumentierte Bearer-Header-Weg vorgesehen. Falkenwarte ergänzt für T3 einen eigenen OAuth-PKCE-Adapter mit Symfony HttpClient, der den Bearer beschafft; die automatische OAuth-Funktion des neueren SDK wird dabei nicht vorausgesetzt. Ein späteres SDK-Upgrade benötigt einen gesonderten Kompatibilitätsnachweis.

SDK 0.9 bevorzugt die Protokollrevision 2026-07-28 und kann auf die Handshake-Ära zurückfallen. Der konkrete T3-Stand wird im Integrationstest geprüft; bei Bedarf wird die Protokollrevision explizit eingestellt. `max_retries` im 0.9-Client betrifft die Verbindungsaufnahme, nicht ein pauschales Wiederholen aller mutierenden Tools.

### S6 — Symfony AI: recherchierte Releasebasis

- [Symfony AI: Platform Component](https://symfony.com/doc/current/ai/components/platform.html)
- [AI Bundle Paketmetadaten](https://packagist.org/packages/symfony/ai-bundle)
- [Platform Paketmetadaten](https://packagist.org/packages/symfony/ai-platform)
- [Beta1: AI Bundle Composer-Datei](https://github.com/symfony/ai-bundle/blob/v1.0.0-BETA1/composer.json)
- [Beta1: OpenAI-Bridge Composer-Datei](https://github.com/symfony/ai-open-ai-platform/blob/v1.0.0-BETA1/composer.json)
- [Beta1: Open Responses Composer-Datei](https://github.com/symfony/ai-open-responses-platform/blob/v1.0.0-BETA1/composer.json)
- [Beta1: Upgradehinweise](https://github.com/symfony/ai/blob/v1.0.0-BETA1/UPGRADE.md)

Platform abstrahiert die Providerintegration; das Bundle bindet sie in Symfony ein. `1.0.0-BETA1` ist die recherchierte Releasebasis und nicht automatisch der endgültige Paketstand der Decisions-Anbindung. Die aktuelle Dokumentation, eine Paketinstallation und ein offener PR sind unterschiedliche Nachweise. Die langfristige Supportzusage des Symfony Frameworks gilt nicht automatisch für diese Vorab-APIs.

Die Pflichtklassifikation verwendet `DecisionGateway → SymfonyAiDecisionAdapter → PlatformInterface`. Eine native Decisions-Leitung muss anhand der gewählten Version nachgewiesen werden. Ein allgemeiner Agent-/Tool-Loop ist für diesen Anwendungsfall nicht vorgesehen. Die OpenAI-Bridge heißt `symfony/ai-open-ai-platform`; ihre recherchierte Beta1-Abhängigkeit auf `symfony/ai-open-responses-platform` wird im Composer-Graph berücksichtigt, ohne im fachlichen Ablauf die Decisions API zu ersetzen.

### S7 — Symfony-AI-PR #2956: native Decisions-Leitung und Grenzen

- [PR #2956](https://github.com/symfony/ai/pull/2956)
- [Geprüfter Head: Gpt ModelClient](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/src/platform/src/Bridge/OpenAi/Gpt/ModelClient.php)
- [Geprüfter Head: DecisionClient](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/src/platform/src/Bridge/OpenAi/Decision/DecisionClient.php)
- [Geprüfter Head: QuestionNormalizer](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/src/platform/src/Bridge/OpenAi/Decision/QuestionNormalizer.php)
- [Geprüfter Head: ResultConverter](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/src/platform/src/Bridge/OpenAi/Decision/ResultConverter.php)
- [Aufrufbeispiel des PR](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/examples/openai/decision.php)

Recherchestand: **offen, nicht gemergt**, Head **`581bfaae3fa9ab15b0d69f8308c6085f1c826ef6`**. Diese Momentaufnahme ist keine veröffentlichte Paketfähigkeit.

Im PR führt `PlatformInterface::invoke()` mit benannten `questions` über `Gpt\ModelClient` zum nativen `DecisionClient` und `POST /v1/decisions`. Die PHP-Klassen `NoulQuestion`, `ChoiceQuestion` und `ScoreQuestion` entsprechen auf HTTP-Ebene `predicate`, `choice` und `score`. Insbesondere ist `noul` kein zu sendender OpenAI-Fragetyp. Batching und Decisions werden dort nicht zusammen akzeptiert.

Die API erlaubt Rückweisungen einzelner Fragen. Der geprüfte `ResultConverter` wirft bei `refusal` jedoch eine allgemeine `RuntimeException`; feinere Teilantwortsemantik darf der nativen PR-Implementierung nicht zugeschrieben werden. Falkenwartes typisierter Fehlerpfad muss dies an der tatsächlich gewählten Integration lösen. [S8]

Die installierte Beta1-Basis hat die benötigte Decisions-Leitung noch nicht veröffentlicht. Falkenwarte verwendet die lokal implementierte `PlatformInterface`-Bridge und importiert keine Klassen oder Enum-Werte aus dem offenen PR-Head. Ein künftiger Wechsel auf eine native Releasefähigkeit benötigt weiterhin einen Versions- und Kompatibilitätsnachweis; ein bewegliches `dev-main` oder ein ungeprüfter PR-Diff sind keine Paketstrategie.

### S8 — OpenAI Decisions: maßgeblicher HTTP-Vertrag

- [Offizieller Decisions Guide](https://developers.openai.com/api/docs/guides/decisions)
- [API-Referenz: Create a decision](https://developers.openai.com/api/reference/resources/decisions/methods/create)

Der native Endpunkt ist `POST https://api.openai.com/v1/decisions`. Ein Request enthält Modell, Eingabe und benannte Fragen. Die dokumentierten Fragetypen sind `predicate`, `choice` und `score`; eine einzelne Antwort kann stattdessen `refusal` sein. Antworten stehen in Fragenreihenfolge. Der recherchierte Stand erlaubt 1–400 Fragen und nennt `gpt-6-luna` als unterstütztes Modell. Der lokale Mocklauf prüfte die Requests und Fehlerreaktionen; Modellverfügbarkeit und echter API-Zugang bleiben offen.

`predicate` liefert eine Wahrscheinlichkeit, `choice` eine Auswahl aus vorgegebenen Werten mit Verteilung und Confidence, `score` eine Bewertung anhand geordneter Stufen. Der Guide empfiehlt aussagekräftige Auswahlwerte und präzise Beschreibungen. Falkenwarte bildet diese auf seine versionierte Taxonomie ab. Die Entscheidungsschwellen, Pflichtangaben und menschlichen Eskalationsregeln sind Produktkonfiguration; die Anbieterwerte sind keine garantierte fachliche Korrektheit und keine Ausführungsberechtigung.

Rückfragetexte entstehen in Falkenwarte aus konfigurierten Vorlagen zu erkannten fehlenden Angaben. Ein frei generierter Antworttext oder eine generative Begründung wird nicht als zugesicherte Fähigkeit dieses Klassifikationsendpunkts vorausgesetzt. Der Produktpfad verwendet weder Jev noch einen stillen Responses-Fallback.

### S9 — DBAL-Transaktionen

- [DBAL 4.6: Transaktionen, Savepoints und Fehlerbehandlung](https://www.doctrine-project.org/projects/doctrine-dbal/en/4.6/reference/transactions.html)

Belegt `Connection::transactional()`, explizite Transaktionsgrenzen und Retry-fähige Datenbankfehler. Die atomare Kombination aus Domainzustand, History und Outbox ist eine Architekturentscheidung des Projekts, keine automatische DBAL-Funktion. Direkte PDO-Transaktionsaufrufe dürfen nicht die DBAL-Transaktionsverwaltung umgehen.

### S10 — Warum `doctrine_transaction` hier nicht verwendet wird

- [Symfony 7.4.23: DoctrineTransactionMiddleware](https://github.com/symfony/symfony/blob/v7.4.23/src/Symfony/Bridge/Doctrine/Messenger/DoctrineTransactionMiddleware.php)

Der geprüfte Code arbeitet mit `Doctrine\ORM\EntityManagerInterface` und `flush()`. Die Middleware ist daher keine DBAL-only-Transaktionslösung. Falkenwarte implementiert seine kurze DBAL-Transaktionsgrenze selbst.

### S11 — Messenger und DBAL-Transport

- [Symfony 7.4 Messenger: vollständige Dokumentation](https://symfony.com/doc/7.4/messenger.html)
- [Symfony 7.4.23: tatsächliche Abhängigkeiten des Doctrine-Transports](https://github.com/symfony/symfony/blob/v7.4.23/src/Symfony/Component/Messenger/Bridge/Doctrine/composer.json)
- [Symfony 7.4.23: Transportverbindung](https://github.com/symfony/symfony/blob/v7.4.23/src/Symfony/Component/Messenger/Bridge/Doctrine/Transport/Connection.php)

Relevant sind Doctrine-Transport, Failure-Transport, idempotente Handler, Supervisor, Graceful Shutdown, Service-Reset und Serialisierung. Standard ist PHP-Serialisierung; Falkenwarte wählt explizit versionierte JSON-Nachrichten. Die Transporttabelle wird in Produktion per Migration erstellt. Lange externe Agentläufe werden nicht als entsprechend lange blockierende Messenger-Nachricht modelliert.

### S12 — FrankenPHP-Image und Betrieb

- [Offizielle Docker-Images und Erweiterungen](https://frankenphp.dev/docs/docker/)
- [Produktionsbetrieb](https://frankenphp.dev/docs/production/)

FrankenPHP stellt PHP-8.5-Images bereit und empfiehlt Debian-Varianten. Image-Tags können sich bewegen; ein Digest fixiert den Build. Die Auswahl des klassischen Modus ist eine Projektentscheidung, die zunächst die Zahl dauerhaft gehaltener Request-Zustände reduziert.

### S13 — Mehrere überwachte Prozesse in einem Container

- [Docker: Run multiple processes in a container](https://docs.docker.com/engine/containers/multi-service_container/)

Docker dokumentiert diese Betriebsform und die Verantwortung des Hauptprozesses für seine Kinder. Der Falkenwarte-Container umfasst Webserver, einen Messenger-Consumer und Maintenance; SQLite benötigt keinen eigenen Serverprozess. Supervisor bzw. eine gleichwertige kleine Prozessaufsicht steuert Signale, Neustarts und geordnetes Beenden.

### S14 — Container-Restart ist nicht dasselbe wie Healthcheck

- [Docker: Start containers automatically](https://docs.docker.com/engine/containers/start-containers-automatically/)

Restart-Policies reagieren auf das Beenden eines Containers bzw. einen Daemon-Neustart. Ein unverändert laufender, nur als `unhealthy` markierter Container wird dadurch nicht automatisch neu gestartet. Das Betriebsdesign benötigt daher eine klare Reaktion des Hauptprozesses auf dauerhafte lokale Kernprozessausfälle. Ein externer T3-Ausfall ist dagegen ein Bridge-Zustand.

### S15 — SQLite WAL, Nebenläufigkeit und Fix vom März 2026

- [SQLite: Write-Ahead Logging](https://www.sqlite.org/wal.html)

WAL erlaubt parallele Leser, aber nur einen gleichzeitigen Schreiber. Es setzt lokalen gemeinsamen Speicher voraus und eignet sich nicht für ein Netzwerkdateisystem. Der dort dokumentierte WAL-Reset-Bug ist ab 3.51.3 behoben; dokumentierte Backports sind unter anderem 3.44.6 und 3.50.7. Das Laufzeitimage muss die tatsächliche Bibliothek oder den Distributions-Backport nachweisen.

### S16 — Konsistente SQLite-Backups

- [SQLite Online Backup API und weitere Verfahren](https://www.sqlite.org/backup.html)

Geeignete Verfahren sind die Backup API und `VACUUM INTO`. Das unkoordinierte Kopieren nur der Hauptdatei einer aktiven WAL-Datenbank ist kein definierter Backup-Mechanismus für Falkenwarte. Restore muss in einem Abnahmetest nachgewiesen werden.

### S17 — Symfony Scheduler und Wiederaufnahme

- [Symfony 7.4 Scheduler](https://symfony.com/doc/7.4/scheduler.html)

Der Scheduler erzeugt Nachrichten zur Laufzeit. Ohne dauerhaften `stateful`-Zustand werden verpasste Läufe nach einem Stillstand nicht automatisch rekonstruiert. Mit Zustand ist eine ausdrückliche Nachholpolitik nötig; `processOnlyLastMissedRun` kann bestimmte Routinen zusammenfassen. Für Falkenwartes Maintenance- und Wiederaufnahmeaufgaben bleibt die DB die Autorität über Fälligkeit und bereits erzeugte Ausführungsschlüssel.

### S18 — Symfony Workflow und kompilierter Servicecontainer

- [Symfony 7.4 Workflow](https://symfony.com/doc/7.4/workflow.html)
- [Symfony 7.4 Servicecontainer und Compiler-Passes](https://symfony.com/doc/7.4/service_container/compiler_passes.html)

Workflow unterstützt Zustände, Übergänge und Guards; persistente Orchestrierung, History und Außenwirkungen bleiben Anwendungsaufgaben. Der Symfony-Servicecontainer wird kompiliert und gecacht. Eine dynamische Plugin-Aktivierung wird deshalb über eine Runtime-Registry realisiert; beliebiger neuer PHP-Code wird nicht ohne Build-/Neustartgrenze als neue kompilierte Servicekonfiguration geladen.

### S19 — Composer-Versionen, Stabilität und Root-Konfiguration

- [Composer JSON-Schema](https://getcomposer.org/doc/04-schema.md)
- [Composer Versions and Constraints](https://getcomposer.org/doc/articles/versions.md)

Belegt die Unterscheidung zwischen Constraints und Tags, die Root-Semantik von Stabilität/Konfiguration und gezielte Stabilitätsflags. Unter Version 1 bedeutet `^0.9` die 0.9-Reihe und schließt 0.10 aus. Exakte Beta-Pins und ein überprüftes Lockfile halten Framework- und experimentelle Integrationspakete nachvollziehbar zusammen.

### S20 — shadcn/ui mit Vite

- [Offizielle Vite-Installation](https://ui.shadcn.com/docs/installation/vite)
- [shadcn/ui: Komponenten und Anpassung](https://ui.shadcn.com/docs)

Belegt die React-/TypeScript-/Vite-Integration mit Tailwind und anpassbaren, in das Projekt aufgenommenen Komponenten. Falkenwartes Design, Tokens und Feature-Struktur sind eigene Projektentscheidungen. Die Referenz-HTML-Datei ist eine visuelle Spezifikation; sie enthält noch keinen React-/shadcn-Build. Die tatsächlichen Frontend-Abhängigkeiten werden mit Lockdatei gesperrt.

### S21 - TanStack Query

- [React Query Overview](https://tanstack.com/query/latest/docs/framework/react/overview)

Belegt Abfragen, Cache, Synchronisierung und Aktualisierung von Serverzustand. Das vorgeschlagene Mercure-Invalidierungsmuster ist eine Anwendung dieser Fähigkeiten.

### S22 - Generierter OpenAPI-Client

- [openapi-fetch und openapi-typescript](https://openapi-ts.dev/openapi-fetch/)

Belegt den typisierten Client auf Basis generierter OpenAPI-Typen. TypeScript-Typen ersetzen keine serverseitige Eingabe- und Antwortvalidierung.

### S23 - OpenAPI 3.1

- [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)

Normative Grundlage für den beigelegten HTTP-Vertrag. Die Wahl von 3.1 ist eine bewusste Kompatibilitätsentscheidung für die Werkzeuge des Projekts.

### S24 - Fehlerdarstellung

- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)

Grundlage für application/problem+json. Projektspezifische Codes, Trace-IDs und Feldfehler werden als eigene Erweiterungsfelder dokumentiert.

### S25 - JSON-Schemas

- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)

Grundlage für die Event-, Plugin- und UI-Hinweisschemas. Schema-IDs unter falkenwarte.local sind logische Identifikatoren des Entwurfs und keine zu kontaktierenden Internetdienste.

### S26 — Symfony Mercure: Pakete, modernes Protokoll und Cookie-Ausgabe

- [Symfony: Mercure-Integration](https://symfony.com/doc/current/mercure.html)
- [MercureBundle 0.7.0: Paketmetadaten und Abhängigkeiten](https://packagist.org/packages/symfony/mercure-bundle)
- [Mercure Component 0.10.0: Paketmetadaten und Abhängigkeiten](https://packagist.org/packages/symfony/mercure)
- [Bundle 0.7.0: verbindliche Konfigurationsstruktur](https://github.com/symfony/mercure-bundle/blob/v0.7.0/src/DependencyInjection/Configuration.php)
- [Bundle 0.7.0: Publisher-/Subscriber-Factory und Pflichtclaims](https://github.com/symfony/mercure-bundle/blob/v0.7.0/src/DependencyInjection/MercureExtension.php)
- [Component 0.10.0: Authorization und Cookie-Erzeugung](https://github.com/symfony/mercure/blob/v0.10.0/src/Authorization.php)

Die am 3. November 2026 veröffentlichten Pakete 0.7.0 und 0.10.0 verlangen PHP >=8.2 und unterstützen Symfony ^6.4 / ^7.3 / ^8.0. Sie passen damit zur gewählten Basis. Die Symfony-Übersicht enthält teilweise ältere Beispiele; für diesen Entwurf sind die getaggten Quellen und der moderne Hub-Vertrag maßgeblich.

Bundle 0.7.0 verwendet standardmäßig Protokoll 1.0 und bietet getrennte `publisher`- und `subscriber`-Konfigurationen, Secrets bzw. Factories. Bei der Secret-Variante sind `iss`, `sub` und `client_id` erforderlich; die Audience kann explizit gesetzt werden. Kein Mix mit alten `jwt`-/`jwt_provider`-Beispielen. `cookie_name` wird im Debug-Modus anders voreingestellt: Falkenwarte konfiguriert deshalb für seinen HTTPS-Vertrag ausdrücklich `__Secure-mercure_access_token`, auch bei lokaler Entwicklung ohne Playground.

Die Authorization-Hilfe setzt das Subscriber-Cookie über die HTTP-Antwort. Sie verwendet den Hub-Pfad, HttpOnly, standardmäßig SameSite=Strict und bei HTTPS Secure. Für denselben Host ist kein Domain-Attribut nötig. Das Backend erteilt ausschließlich Subscribe-Grants für erlaubte Projekttopics; ein authentifizierter, gegen CSRF geschützter Erneuerungsendpunkt setzt das kurzlebige Cookie erneut. Der JWT-Inhalt wird nicht als JSON an den Browser ausgegeben. Publisher-Schlüssel, Bearer-Zugänge für API/MCP und Browser-Sitzung bleiben getrennt.

### S27 — Eingebetteter Mercure-Hub, lokale Laufzeit und Lizenz

- [FrankenPHP: integrierter Mercure-Hub und PHP-Funktionen](https://frankenphp.dev/docs/mercure/)
- [Mercure-Hub: Release v1.1.6 vom 4. November 2026](https://github.com/dunglas/mercure/releases/tag/v1.1.6)
- [Hub-Konfiguration: Issuer, Resource Identifier und Bolt-Transport](https://mercure.rocks/docs/deployment/configuration)
- [Mercure: Lizenzhinweise](https://mercure.rocks/docs/reference/license)
- [Verbindliche Lizenzdatei im Tag v1.1.6](https://github.com/dunglas/mercure/blob/v1.1.6/LICENSE)

Offizielle FrankenPHP-Builds enthalten das Mercure-Caddy-Modul; Docker-Image und eigener xcaddy-Build sind zusätzlich in S12 belegt. Es muss im Caddyfile aktiviert werden; ein zweiter Hub-Container ist nicht erforderlich. Die tatsächlich eingebettete Modulversion ergibt sich aus dem konkret gesperrten Image, nicht aus der PHP-Version. M0 prüft Buildinformationen und einen echten V1-Handshake. Fehlt der passende Modulstand, kann ein eigener, ebenfalls gesperrter xcaddy-Build `github.com/dunglas/mercure/caddy` integrieren.

`mercure_publish()` ist nur im FrankenPHP-Webserver verfügbar, nicht in CLI-Prozessen. Der Messenger-/Maintenance-Publisher verwendet daher `HubInterface` und authentifiziertes HTTP-POST zum eingebetteten Hub. Der Browser verbindet sich direkt mit dessen SSE-Endpunkt; Symfony hält keinen zusätzlichen Proxy-Stream offen.

Der lokale Bolt-Transport speichert Replay-History in einer separaten Datei auf dem persistenten Volume. Eine endliche `size` und eine positive `cleanup_frequency` begrenzen den Zielumfang; die Bereinigung erfolgt probabilistisch. `size 0` ist unbegrenzt, `transport local` bietet keine Replay-History. Die SQLite-Domain-History und Outbox sind davon unabhängig. Mercure Cloud oder Enterprise-Transporte werden für diesen Einzelcontainer nicht benötigt.

Die Hub-Lizenzdatei v1.1.6 enthält **AGPL-3.0**, die Symfony-Pakete sind MIT-lizenziert. Ein anderslautender Website-Footer ist kein geeigneter Nachweis für die Lizenz des ausgelieferten Hub-Codes. Private lokale Verwendung erfordert keinen Cloudvertrag; etwaige spätere Weitergabe eines eigenen Images ist anhand der tatsächlich enthaltenen Lizenzen zu behandeln.

### S28 — Mercure 1.x: Autorisierung, Reconnect und lokales HTTPS

- [Mercure: Migration von älteren Protokollverträgen](https://mercure.rocks/docs/UPGRADE)
- [Mercure: aktuelle Spezifikation](https://mercure.rocks/spec)
- [JWT- und Cookie-Autorisierung einschließlich Tokenablauf](https://mercure.rocks/docs/concepts/authorization)
- [Replay, Last-Event-ID und Grenzen von EventSource](https://mercure.rocks/docs/concepts/reconnection-and-history)
- [Caddy: lokale HTTPS-Zertifikate und Vertrauensspeicher](https://caddyserver.com/docs/automatic-https#local-https)
- [Caddy: lokales HTTPS mit Docker](https://caddyserver.com/docs/running#local-https-with-docker)
- [Node.js: NODE_EXTRA_CA_CERTS](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)
- [Symfony 7.4 HTTP-Client: HTTPS-Zertifikatsspeicher](https://symfony.com/doc/7.4/http_client.html#https-certificates)

**Einheitlicher Protokollvertrag:** Abonnements verwenden `match` für exakte Topics bzw. `match_urlpattern` für URLPattern-Ausdrücke. Veröffentlichungen verwenden weiterhin `topic`. V1-Access-Tokens tragen `typ: at+jwt`, `iss`, `aud`, `exp`, `sub`, `client_id`, `iat`, `jti` und `authorization_details` mit Publish- oder Subscribe-Grants. Alte `mercure.publish`-/`mercure.subscribe`-Claims, `mercureAuthorization` und alte Subscriber-`topic`-Parameter werden nicht übernommen; ein Legacy-Kompatibilitätsmodus ist nicht Teil des Konzepts.

**Schlüssel und Audience:** Der Hub konfiguriert einen expliziten `issuer` mit voneinander getrennten Publisher-/Subscriber-Prüfschlüsseln. `iss` stimmt exakt mit dieser Kennung überein. `resource_identifier` wird auf die kanonische öffentliche HTTPS-Hub-URL einschließlich eines etwaigen Ports gesetzt; beide Tokenarten erhalten dieses `aud`, auch wenn interne HTTP-Publish-Aufrufe eine andere Transportadresse nutzen. Symfony kann für die lokale Installation selbst die Tokens ausstellen; ein externer Identity-Provider ist nicht erforderlich. Jede fachliche UI-Veröffentlichung wird ausdrücklich als privat markiert. Mehrere Topics eines privaten Updates erweitern den möglichen Empfängerkreis; sie sind keine UND-Verknüpfung.

**Reconnect-Vertrag:** Native EventSource sendet beim Wiederverbinden automatisch den zuletzt empfangenen `Last-Event-ID`-Requestheader. Für eine neue Instanz existiert `last_event_id`; es ist ein opaker Hub-Cursor, kein SQLite-Sequenzwert. Der `Mercure-Last-Event-ID`-Responseheader kann Replay-Lücken anzeigen, ist aber für natives EventSource nicht lesbar. Falkenwarte verwendet deshalb unveränderliche Invalidierungshinweise und synchronisiert bei jedem `open`, auch nach Reconnect, die sichtbaren Daten über die autoritative JSON-API. Stabile Event-IDs erlauben Deduplizierung. Replay ist eine Optimierung, keine Voraussetzung für korrekten Domainzustand.

**Sitzung und Ablauf:** Die Subscription läuft unter derselben HTTPS-Origin wie Frontend und API mit einem HttpOnly-Cookie. Native EventSource kann keinen selbst gewählten Authorization-Header setzen. JWTs gehören weder in URL-Parameter noch in JavaScript-Speicher. Der Hub beendet Verbindungen spätestens bei Tokenablauf; nach einem 401 kann natives EventSource aufhören zu versuchen. Das Frontend erneuert deshalb rechtzeitig das Cookie über die bestehende Sitzung und erzeugt bei Bedarf eine neue EventSource-Instanz. Es muss den Token dafür nicht auslesen. Abmeldung schließt die Verbindung und löscht das Cookie.

**Lokales Vertrauen:** Caddy erzeugt für localhost eine eigene CA. Deren öffentlicher Root ist im Docker-Datenverzeichnis typischerweise `/data/caddy/pki/authorities/local/root.crt`; der private CA-Schlüssel bleibt im geschützten Volume. Der Linux-Host, Browser sowie T3-/Agent-Prozesse vertrauen dieser CA nicht automatisch. M0 dokumentiert den Import des öffentlichen Root-Zertifikats in die tatsächlich verwendeten Linux-/Browser-Vertrauensspeicher und die beteiligten Laufzeitumgebungen. Node-basierte Clients können `NODE_EXTRA_CA_CERTS` verwenden; die Variable wird beim Prozessstart gelesen. Bei explizit gesetztem TLS-`ca` gilt dessen eigene Konfiguration. Zertifikatsprüfung bleibt aktiviert.

Die kanonische Origin muss aus jedem beteiligten Laufzeitkontext erreichbar sein und zum Zertifikat passen; localhost bezeichnet je nach Container und Linux-Host einen anderen Kontext. Ein Aufruf durch einen Agent auf einem zweiten Gerät benötigt eine dafür geeignete Hostadresse und Vertrauen in deren Zertifikatskette. Dieselbe Vertrauensprüfung gilt für HTTPS-Aufrufe zum Falkenwarte-MCP- und API-Endpunkt; deren Bearer-Authentifizierung bleibt vom Mercure-Cookie getrennt. Alle genannten Rundläufe sind Abnahmekriterien, keine in diesem Konzeptpaket bereits durchgeführten Browsertests.
### S29 — Playwright: E2E, Fixtures und externe Mocks

- [Playwright Test Fixtures](https://playwright.dev/docs/test-fixtures)
- [Playwright API Testing](https://playwright.dev/docs/api-testing)
- [Playwright Mock APIs](https://playwright.dev/docs/mock)
- [Playwright: Continuous Integration](https://playwright.dev/docs/ci)

Die Dokumentation belegt Browser-E2E, isolierte Fixtures, HTTP-Aufrufe über `APIRequestContext` und die Ausführung mit Bericht in CI. `page.route` und HAR-Mocking betreffen Browserverkehr. Daraus folgt für Falkenwarte: serverseitiger MCP-/Decisions-Verkehr benötigt eigene kontrollierte Testendpunkte; ein im Browser abgefangener JSON-Aufruf prüft nicht den Symfony-Worker oder den T3-MCP-Client.

Die Produktentscheidung lautet E2E über reale Anwendungsgrenzen mit festen Daten und kontrollierten externen Antworten. Funktionstests sind ausschließlich für die ausdrücklich vereinbarten Background-Tasks zulässig. Die konkrete Umsetzung und Abnahmefälle stehen in [TESTING.md](TESTING.md); dieses Quellenverzeichnis behauptet keine bereits ausgeführte Produkttestabdeckung.

### S30 — GitHub Actions: QA, Berechtigungen und Auslöser

- [GitHub Actions: Workflows](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows)
- [GitHub: GITHUB_TOKEN und Berechtigungen](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
- [GitHub: Workflows aus Workflows auslösen](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

Workflows werden im Repository unter `.github/workflows` versioniert und durch konfigurierte Ereignisse gestartet. Tokenrechte werden je Job auf dessen Bedarf begrenzt. Das unterstützt Falkenwartes getrennte QA-, Release- und Veröffentlichungsjobs.

Der aktuelle GitHub-Vertrag enthält eine wichtige Ausnahme: Mit `GITHUB_TOKEN` erzeugte oder aktualisierte PRs können für `opened`, `synchronize` und `reopened` CI-Läufe im Zustand „approval required“ auslösen. Andere dadurch erzeugte Ereignisse starten grundsätzlich keine weiteren Läufe; `workflow_dispatch` und `repository_dispatch` sind weitere ausdrückliche Ausnahmen. Ein pauschales „GITHUB_TOKEN löst nie PR-CI aus“ wäre daher falsch. Ein GitHub-App-Token ermöglicht einen anderen Automationspfad; welcher gewählt wird, gehört in die Releasekonfiguration.

### S31 — Conventional Commits und Release Please

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [Release Please Action: offizielles Repository](https://github.com/googleapis/release-please-action)
- [Release Please: Aufgaben und Grenzen](https://github.com/googleapis/release-please)

Conventional Commits liefert die strukturierte Commitsemantik. Release Please wertet die Git-Historie aus und pflegt daraus Release-PR, Versionsänderungen und Changelog. Die eigentliche Veröffentlichung eines App-Images bleibt ein eigener Pipelineschritt.

Die Action stellt unter anderem `release_created` für nachfolgende Schritte bereit. Falkenwarte kann damit eine Veröffentlichung im selben kontrollierten Workflow ausführen und muss sich nicht auf einen durch `GITHUB_TOKEN` erzeugten Release-Event verlassen. PR-Titelprüfung, Mergeverfahren, Versionsdateien und Action-Pins müssen gemeinsam konfiguriert werden; das Werkzeug allein garantiert noch keine passende Releasehistorie. [S30]

## Noch offene technische Nachweise

1. Composer-Plattform- und Laufzeitprüfung im tatsächlich gebauten, per Digest festgelegten PHP-Image; die Paketversionen und Lockdatei sind bereits vorhanden.
2. Echter OpenAI-Aufruf mit aktivem Zugang, einschließlich produktiver Modellverfügbarkeit; lokale Decisions-Mocks belegen nur den Anwendungspfad.
3. MCP-/OAuth-Rundlauf mit der tatsächlich genutzten T3-Instanz und Agent-Rückweg; die SDK-0.9-Integration und Protokollauswahl sind implementiert, ein aktiver T3-Nachweis fehlt.
4. Geladene SQLite-Version, WAL-/Dauerhaftigkeitsverhalten, Migration und Wiederherstellung im gebauten Image.
5. Image-Start, tatsächlicher Mercure-Modulstand, HTTP-/Workerbetrieb, Signalverhalten, Prozessausfall und Wiederaufnahme.
6. Erreichbare kanonische Linux-/Container-Origin und TLS-Vertrauen für Browser, T3 und Agenten.
7. Vollständige isolierte E2E-Suite und GitHub-QA-/Release-Pipeline mit überprüften Token- und Triggerregeln.

T3-spezifische Toolnamen und Protokollverträge werden in den Integrationsdokumenten belegt. Architekturentscheidungen und geplante Nachweise bleiben von bereits verifizierten Produktfähigkeiten getrennt.
