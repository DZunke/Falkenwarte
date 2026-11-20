# Falkenwarte auf Linux betreiben

## Produktionsstart

Das Produktions-Compose enthält genau den App-Service; FrankenPHP, der Messenger-Consumer und Maintenance laufen als überwachte Prozesse in diesem Container.

Maintenance hält für seine gesamte Laufzeit eine dateibasierte Sperre im `locks`-Verzeichnis des Datenpfads; ein zweiter `app:maintenance`-Aufruf – auch mit `--once` – meldet den bereits laufenden Prozess und endet mit Fehlercode 1.

Der Container verwendet PHP 8.5 und eine aus Quellcode gebaute SQLite-Bibliothek ab Version 3.51.3, damit der WAL-Korruptionsfix aus diesem Releasebereich verfügbar ist.

SQLite liegt im lokalen persistenten Docker-Volume `falkenwarte-data`; dieses Volume gehört nicht auf ein Netzwerkdateisystem.

Vor dem ersten Start werden die Secretdateien aus `secrets/README.md` in `secrets/` abgelegt oder die entsprechenden Compose-Variablen im geschützten Runtime-Environment gesetzt.

```bash
docker compose up --build -d --wait
docker compose ps
docker compose logs --tail=100 app
```

Dieser Startpfad baut das Appimage aus dem aktuellen Checkout und verwendet den Compose-Standardtag `falkenwarte:local`.

Für ein veröffentlichtes Release wird zuerst die Datei `image-manifest.json` aus [GitHub Releases](https://github.com/DZunke/Falkenwarte/releases/latest) geladen und der dort verzeichnete GHCR-Digest verwendet:

```bash
curl -fsSLO https://github.com/DZunke/Falkenwarte/releases/latest/download/image-manifest.json
export FALKENWARTE_IMAGE="$(jq -er .image image-manifest.json)"
docker compose up --no-build -d --wait
```

Das Release-Manifest nennt Tag, Commit, Image-ID und Registry-Digest; der Digest wird unverändert in `FALKENWARTE_IMAGE` übernommen.

Der Service bindet HTTPS nur an `127.0.0.1:8443`; `https://localhost:8443` ist die lokale Adresse für Oberfläche, JSON-API, MCP und Mercure.

Der Healthcheck verwendet `/healthz` und prüft das öffentliche Zertifikat mit Caddys Root-CA, ohne die Zertifikatsprüfung abzuschalten.

Nach dem ersten Start wird das einmalige Einrichtungstoken aus dem Datenvolume gelesen und im Browser beim Eigentümer-Bootstrap verwendet:

```bash
docker compose exec -T app cat /data/setup-token
```

Die öffentliche Caddy-Root-CA liegt als `/certs/root.crt` im Zertifikatsvolume; Clients außerhalb des Containers vertrauen ihr erst nach einem bewussten Import in den tatsächlich verwendeten System- und Browserzertifikatsspeicher.

Der private Caddy-CA-Schlüssel liegt ausschließlich im Datenvolume unter `/data/caddy/pki`; er wird nicht exportiert.

## Secrets und lokale Konfiguration

Symfony Runtime lädt für HTTP, Console und Worker die versionierte `.env` mit gemeinsamen Standardwerten. Im Quellcheckout verwendet Symfony das Verzeichnis `var/` für Datenbank und Backups. Für persönliche Einstellungen verwende `.env.local`. Bereits gesetzte Prozessvariablen haben Vorrang. Der Produktionscontainer setzt `APP_ENV=prod` und speichert seine Daten unter `/data`. [Symfony-Konfiguration](https://symfony.com/doc/7.4/configuration.html)

Docker Compose liest die Standarddatei `.env` beim Auflösen von `compose.yaml`. Für lokale Compose-Overrides aus einer zusätzlichen Datei starte beispielsweise `docker compose --env-file .env --env-file .env.local up --build -d --wait`. Das Image enthält nur die versionierten Standardwerte.

`APP_SECRET`, die Mercure-Publisher- und Subscriber-Schlüssel sowie der Bootstrap-Token werden als Secretdateien oder über das geschützte Runtime-Environment eingespielt.

Wenn ein Schlüssel beim ersten Start automatisch erzeugt wurde, bleibt er im geschützten Verzeichnis `/data/.secrets`; ein Austausch kann gespeicherte verschlüsselte Werte, Sitzungen oder JWTs unbrauchbar machen.

Die Dateien `secrets/` und das Docker-Volume sind vertraulich und gehören nicht in Git, ein Image oder einen Diagnoseexport.

Die produktive Decisions-Verbindung und T3-URL sind getrennte Einstellungen; fehlende externe Zugänge verhindern nicht den lokalen Ticketbetrieb.

## Update und Wiederanlauf

Vor einem Update mit Migrationen wird ein geprüftes Backup erstellt und sein Restoreweg wird anhand des aktuellen Image-Digests bestimmt.

Ein Quellcheckout wird mit `docker compose up --build -d --wait` gebaut; der veröffentlichte Betrieb übernimmt stattdessen den Digest aus `image-manifest.json` und setzt ihn in `FALKENWARTE_IMAGE`.

Das neue Image wird vor dem Start auf Commit und Digest geprüft; Migrationen laufen unter einer Volume-weiten Dateisperre, bevor HTTP, Consumer und Maintenance gestartet werden.

```bash
curl -fsSLO https://github.com/DZunke/Falkenwarte/releases/latest/download/image-manifest.json
export FALKENWARTE_IMAGE="$(jq -er .image image-manifest.json)"
docker compose up --no-build -d --wait
docker compose ps
docker compose logs --tail=100 app
```

Ein Rollback auf ein vorheriges Image ist nur dann sicher, wenn dessen Code das bereits migrierte Schema lesen kann.

Bei einer inkompatiblen Migration wird das dokumentierte Backupverfahren verwendet; automatische destruktive Down-Migrationen gehören nicht zum Updateweg.

Die PID-1-Aufsicht beendet die App-Prozesse bei SIGTERM geordnet, startet kurzzeitig ausgefallene lokale Prozesse erneut und beendet den Container nach wiederholten lokalen Prozessabbrüchen für die Compose-Restartpolicy.

Ausfälle von T3 oder OpenAI lösen keine lokale Neustartschleife aus; ihr Status bleibt eine externe Verbindungsdiagnose.

## Backup

Ein Backup wird über die owner-only Betriebsoberfläche oder den API-Vertrag `POST /api/v1/backups` angelegt; der Auftrag läuft im Messenger und erzeugt eine konsistente SQLite-Kopie über die SQLite Backup API.

Das Ergebnis ist erst nach `status: ready` herunterladbar und enthält `database.sqlite` sowie ein Manifest mit Appversion, Schema-Version, Pluginversionen und SHA-256-Prüfsumme.

`schema_version` nennt die letzte ausgeführte Appmigration aus `DoctrineMigrations`; jede ausgeführte Migration wird zusätzlich gegen die Klassen im Image geprüft, während Pluginversionen getrennt über die installierten Manifeste validiert werden.

Backupdateien werden mit eingeschränkten Dateirechten in `/data/backups` gespeichert; sie enthalten keine Secretwerte und die Aufbewahrung beziehungsweise zusätzliche Offlinekopie bleibt eine Betreiberentscheidung.

Das ausgelieferte Format führt derzeit `artifact_count: 0`; vor einer Erweiterung um Dateianhänge muss der Backup- und Restoreumfang dafür gemeinsam ergänzt werden.

Ein erfolgreiches Backup ist kein Restorebeleg; der Wiederherstellungspfad muss vor einer produktiven Nutzung mit Fixture-Daten durchlaufen werden.

## Restore und externe Aufträge

Ein Restore wird für einen fertigen Backupdatensatz mit dessen Datenbank-Prüfsumme und einer Begründung angefordert; die API stellt zunächst nur einen dauerhaften Auftrag unter `/data/restore-request.json` bereit.

Die Prozessaufsicht beendet daraufhin HTTP, Worker und Maintenance, während die Datenbankdatei aus dem geprüften Archiv ersetzt wird.

Vor dem Austausch werden Datenbankintegrität, Datei- und Manifestsumme, Appversion, Schema-Migrationen und unterstützter Dateiumfang geprüft; das vorherige Datenbankfile wird im geschützten Verzeichnis `/data/restore-previous/` aufbewahrt.

Die Prüfung vergleicht den App-Migrationsstand separat vom Plugin-Migrationsstand und lehnt unbekannte Migrationen, nicht vorhandene Pluginpakete sowie einen neueren inkompatiblen Pluginstand vor dem Datenbanktausch ab.

Scheitert diese Prüfung vor dem Austausch, bleibt die bisherige Datenbank aktiv, der geprüfte Backupauftrag erhält den sichtbaren Status `failed` mit dem Grund und der Wartungsmodus bleibt eingeschaltet; nach Behebung der Inkompatibilität kann derselbe geprüfte Backupstand erneut ausgewählt werden.

Vor der ersten Dateiverschiebung schreibt PID 1 `/data/restore-swap-in-progress.json`; liegt dieser Marker beim nächsten Start ohne `/data/restore-result.json` vor, bleiben HTTP, Worker und Maintenance gestoppt, bis die Datenbankdatei und die Kopie unter `/data/restore-previous/<request-id>/` geprüft und der Austausch ausdrücklich abgeschlossen wurde.

Bei einem unterbrochenen Austausch darf der Marker nicht blind gelöscht werden: zuerst den App-Container gestoppt lassen, die gesicherten und aktuellen Datenbankdateien auf SQLite-Integrität und den erwarteten SHA-256 prüfen und erst danach die gewünschte Datei unter `/data/falkenwarte.sqlite` einsetzen; WAL-, SHM- und Journaldateien müssen zum gewählten Stand passen.

Beim folgenden Start liest `app:restore:finalize` den Restoremarker ein und ruft den Wiederherstellungsabgleich auf, bevor die überwachten Prozesse wieder laufen.

Der Abgleich hält offene T3-Runs und betroffene automatische Starts gesperrt, bis der Eigentümer ihre externe Wirkung geprüft und ausdrücklich geklärt hat.

Ein lokales Restore kann bereits von T3 angenommene Arbeit nicht rückgängig machen; Thread-IDs, Run-IDs und Korrelationskennungen dienen dazu, offene externe Ausführung zu inventarisieren.

Die für Entschlüsselung und Wiederanmeldung benötigten Secretdateien werden außerhalb des Backuparchivs geschützt aufbewahrt und bei einer Neuinstallation separat wieder eingespielt.

## Isolierte E2E-Abnahme

Das Testprofil startet dieselbe App-Image-ID wie der Releasejob zusammen mit Decisions- und T3-Mocks sowie dem Playwright-Runner in einem internen Netzwerk.

Ein lokaler Imagebuild ist ein eigener Schritt; `scripts/ci-e2e.sh` baut nicht stillschweigend ein Ersatz-Appimage und führt seine Abnahme gegen die bereits bereitgestellte Image-ID aus.

```bash
docker compose -f compose.yaml -f compose.test.yaml --profile test build app decisions-mock t3-mock e2e
FALKENWARTE_IMAGE=falkenwarte:local scripts/ci-e2e.sh
```

Der Testlauf schreibt Abnahmebelege nach `qa/results/`; Browserberichte und kurzlebige Owner-Sitzungsdaten bleiben vom Produktionsvolume getrennt.

MCP- und Decisions-Mocks sowie ihre Steuerpfade gehören ausschließlich zum Testprofil und sind im Produktions-Compose nicht erreichbar.
