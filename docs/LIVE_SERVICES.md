# Live-Dienste: FrankenPHP und Mercure

**Status:** Dieser Text beschreibt den Live-Dienst-Vertrag und die implementierte Grant-Auswahl. Browser- und Container-Nachweise stehen in [TRACEABILITY.md](TRACEABILITY.md) und [VALIDATION.md](VALIDATION.md). Die JSON-API und SQLite bleiben für Zustand, Berechtigungen und History maßgeblich. Mercure informiert die Oberfläche über Änderungen; es entscheidet keine fachlichen Übergänge und startet keine Agents.

## 1. Laufzeit in einem Container

Das App-Image enthält FrankenPHP im klassischen Modus, den Messenger-Consumer und Maintenance unter einer Prozessaufsicht. Der Mercure-Hub läuft als Caddy-Modul im FrankenPHP-Prozess. Offizielle FrankenPHP-Builds enthalten dieses Modul bereits; seine Aktivierung ist eine ausdrückliche Caddyfile-Konfiguration. Ein zusätzlicher Hub-Container, Redis oder ein Cloudvertrag sind für diesen Entwurf nicht erforderlich.

Der Browser verbindet sich direkt mit dem Hub-Endpunkt. Symfony stellt keine eigene lang laufende SSE-Proxyantwort bereit. Für Veröffentlichungen aus dem CLI-Worker wird authentifiziertes HTTP verwendet: Die FrankenPHP-Funktion `mercure_publish()` steht dort nicht zur Verfügung. [FrankenPHP-Dokumentation](https://frankenphp.dev/docs/mercure/)

## 2. Fixierte Versionsbasis

| Bestandteil | Auswahl |
|---|---|
| Anwendung | PHP 8.5.x, Symfony 7.4 LTS |
| Symfony-Integration | `symfony/mercure-bundle:0.7.0` und `symfony/mercure:0.10.0` |
| Hub-Vertrag | Mercure-Protokoll 1.0; recherchierte Modul-Zielbasis v1.1.6 |
| Image | Konkreter FrankenPHP-Digest mit nachgewiesenem kompatiblem Mercure-Modul |

Bundle und Component unterstützen die gewählte PHP-/Symfony-Basis. Die tatsächliche eingebettete Hub-Version muss M0 aus dem Image nachweisen; ein PHP-Image-Tag beweist sie nicht. Falls erforderlich, entsteht ein gesperrter eigener xcaddy-Build. Die Paketauflösung, Konfiguration und Protokollrundläufe sind anschließend zu prüfen. In der SBOM wird die AGPL-3.0-Lizenz des Hub-Tags erfasst; die Symfony-Pakete sind MIT-lizenziert. [Bundle](https://packagist.org/packages/symfony/mercure-bundle), [Component](https://packagist.org/packages/symfony/mercure), [Hub-Release](https://github.com/dunglas/mercure/releases/tag/v1.1.6), [Hub-Lizenz](https://github.com/dunglas/mercure/blob/v1.1.6/LICENSE)

Der Imagebuild pinnt das Dockerfile-Frontend per Digest, den PHP-Erweiterungs-Snapshot und die Versionen der eingebetteten Mercure- und SQLite-Laufzeiten. Beim Release erhält BuildKit den Zeitstempel des geprüften Commits als `SOURCE_DATE_EPOCH`; der Docker-Exporter schreibt diesen Zeitstempel auch in die Dateimetadaten. Der Build erstellt aus Composer-Metadaten, dem NPM-Produktionsgraphen, Debian-Paketdaten und den eingebetteten Caddy-Modulen ein CycloneDX-1.5-Inventar. Fehlende Lizenzdaten aus Composer oder NPM brechen den Build ab; Debian-Pakete ohne maschinenlesbares Lizenzfeld werden als `NOASSERTION` ausgewiesen. Das kompakte Laufzeitzeugnis prüft Mercure `v1.1.6` mit AGPL-3.0, beide Symfony-Mercure-Pakete mit MIT sowie SQLite `3.51.3` über SQLite3 und PDO.

`quality.yml` pinnt `docker/setup-buildx-action` auf Commit `f87e5991a6d7451dcb8d9637bfbc97413f497069`, Buildx auf `v0.39.0` und den `docker-container`-Builder auf `moby/buildkit:v0.35.0@sha256:aa632b921ef07411d2cb77292cd34213d4f7b384001d6fceef1e1f25bf9752bb`. Der lokale Buildx-Client muss ebenfalls `v0.39.0` melden; die offizielle Binärversion ist unter [Docker Buildx v0.39.0](https://github.com/docker/buildx/releases/tag/v0.39.0) verfügbar.

Für einen lokalen Vergleich verwende denselben Builder und einen Git-Archivkontext des geprüften Commits. Git setzt die Zeitstempel auf die Commitzeit und die Archivmaske auf `0022`; ein alter, zuvor bearbeiteter Checkout kann dagegen frühere `mtime`-Werte enthalten, die `rewrite-timestamp=true` nur nach oben begrenzt.

```sh
set -euo pipefail
builder="falkenwarte-release-local-$$"
image_archive="$(mktemp)"
trap 'docker buildx rm "$builder" >/dev/null 2>&1 || true; rm -f "$image_archive"' EXIT
docker buildx version | grep -F 'v0.39.0'
docker buildx create --name "$builder" --driver docker-container --driver-opt image=moby/buildkit:v0.35.0@sha256:aa632b921ef07411d2cb77292cd34213d4f7b384001d6fceef1e1f25bf9752bb --use
docker buildx inspect --bootstrap "$builder"
sha="$(git rev-parse HEAD)"
source_date_epoch="$(git show -s --format=%ct "$sha")"
app_version="$(git show "$sha:version.txt")"
git -c tar.umask=0022 archive --format=tar "$sha" | docker buildx build --builder "$builder" --file docker/Dockerfile --target app --provenance=false --build-arg VCS_REF="$sha" --build-arg SOURCE_DATE_EPOCH="$source_date_epoch" --build-arg APP_VERSION="$app_version" --output "type=docker,name=falkenwarte:local,dest=$image_archive,rewrite-timestamp=true" -
docker load --input "$image_archive"
docker run --rm --env SOURCE_DATE_EPOCH="$source_date_epoch" --entrypoint php falkenwarte:local -r '$expected = (int) getenv("SOURCE_DATE_EPOCH"); foreach (["/app/composer.lock", "/usr/share/falkenwarte/image-audit/runtime-evidence.json"] as $path) { if (filemtime($path) !== $expected) { exit(1); } }'
scripts/export-image-audit.sh falkenwarte:local var/image-audit
```

Der dokumentierte Prüfsnapshot (`VCS_REF=515f5f248566f54604f837ca06a5ccd8fdee09bf`, `APP_VERSION=0.1.0`, Commit-Epoch `1795113705`, Context-Tar SHA-256 `898df2dc06a93a2f8fcee2888b3b1d47e39a52efd7c1a2428a85516aca2421a9`) wurde zweimal unabhängig mit `--no-cache` gebaut; beide Images hatten dieselbe ID `sha256:7ac98fcaa532378bd4d233fd9a0610fbffd2a77d6a5a5e0c15847d13cf7a9276` und dieselben 43 RootFS-Layer. Das CycloneDX-SBOM hat in beiden Images den SHA-256 `82fe9ceebf583b318567bca0cecc22516a28ef68232c466d297288f57701b388`; diese Werte dokumentieren genau diesen Prüfsnapshot.

Im früheren [Hosted-Build 44601867336](https://github.com/DZunke/Falkenwarte/actions/runs/44601867336) wichen nur nicht normalisierte TAR-`mtime`-Metadaten ab; SBOM und Image-Payloads waren gleich. Dieser Vergleich erklärt eine Archivmetadaten-Differenz, belegt aber keinen bytegleichen TAR-Export. Die aktuelle Workflow-Konfiguration setzt den oben genannten Buildx-/BuildKit-Pin, `SOURCE_DATE_EPOCH`, deaktivierte Provenance, normalisierte Export-Zeitstempel und prüft die Quellzeiten zweier Image-Dateien.

Zwei unabhängige GitHub-Runner bauten Commit `83f0fb338a50dbd3dc6b4db0d87fb279759b80a2` mit identischer Image-ID `sha256:e333b4cf80ba65871b87ab8fad3c0b25c904215e0e801ccc552b4498529c868c`, 43 identischen RootFS-Layern und identischen Inventardateien. [PR-Build](https://github.com/DZunke/Falkenwarte/actions/runs/44611627080/job/135869460410) · [Dispatch-Build](https://github.com/DZunke/Falkenwarte/actions/runs/44611621718/job/135869445334)

Für Commit `d9158701a647d5a8a43c8b227d951fa9d40591f3` stimmte auch das lokal exportierte `manifest.json` mit beiden Runnern überein. Alle drei Archive enthielten dieselbe Config-ID `sha256:224cb1b65cf25feb13fe8ab4f2719118affacdd5d5ac194390050f48d06673f2` und dieselben 43 geordneten Layer. Für diesen Vergleich ist die in `manifest.json` referenzierte Konfigurationsdatei maßgeblich. Die lokale Docker-Engine zeigte nach dem Laden den Digest des Manifests als `.Id` an. [PR-Build](https://github.com/DZunke/Falkenwarte/actions/runs/44614092324/job/135878020924) · [Dispatch-Build](https://github.com/DZunke/Falkenwarte/actions/runs/44614080974/job/135877982014)

Zwei unabhängige GitHub-Runner bauten v0.2.0 aus Commit `00d260efdb361deaa14fb75c76fa44a71e5965ba` mit derselben Image-ID `sha256:43bb9391eb18a4b6ea06aa3d4293d499eb0ce80915517e5826df6efdce7465d5` und denselben 43 RootFS-Layern. Die SHA-256-Werte für SBOM, Laufzeitinventar und Lizenzhinweise stimmen überein. [Erster Build](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788/job/135927121539) · [Zweiter Build](https://github.com/DZunke/Falkenwarte/actions/runs/44628085255/job/135927134654)

Das Verzeichnis enthält `sbom.cdx.json`, `THIRD-PARTY-NOTICES.txt`, `runtime-evidence.json` und `image-evidence.json`; das letzte bindet deren Hash an Image-ID, Commitlabel und Produktversion.

## 3. Ein öffentlicher Ursprung

Konfigurierter lokaler Standard ist **`https://localhost:8443`** für Frontend, JSON-API und `/.well-known/mercure`. Der Container lauscht ebenfalls auf HTTPS-Port 8443; der Host bindet ihn ausschließlich an `127.0.0.1`. Ein zweiter lokaler HTTP-Port kann ausschließlich auf diese HTTPS-Adresse umleiten. Gleiche innere und äußere HTTPS-Ports vereinfachen den Publisher-Aufruf aus dem Container, ersetzen aber keine Verbindungsprüfung.

Die Hub-URL wird als kanonischer `resource_identifier` festgelegt. Beide JWT-Arten verwenden genau diese URL als `aud`. Als eigener, konfigurierter Issuer dient die Falkenwarte-Origin; `iss` muss exakt dem vertrauenswürdigen `issuer`-Block entsprechen. Auch bei einer später abweichenden internen Transportadresse bleiben diese Identitäten ausdrücklich konfiguriert. Ein externer OAuth-Server ist für die lokale Tokenausgabe nicht nötig. [Hub-Konfiguration](https://mercure.rocks/docs/deployment/configuration)

## 4. Getrennte Berechtigungen

Publisher und Subscriber erhalten getrennte Signierschlüssel und getrennte Prüfschlüsselkonfigurationen im Issuer-Block. Nur Backendprozesse besitzen Publish-Rechte. Der Eigentümer erhält in der Gesamtsicht ausschließlich einen Subscribe-Grant für `urn:falkenwarte:owner`; jede Änderung wird zusätzlich zu ihrem Projekttopic an dieses Owner-Topic veröffentlicht. Dadurch muss das Browser-Cookie nicht jedes Projekt einzeln aufzählen.

Ein ausdrücklicher Projektgrant enthält nur die in `project_ids` angeforderten Projekte und erhält keinen Owner-Grant. Der Server prüft jede Projekt-ID gegen das Eigentümerrecht und die Existenz des Projekts. Der API-Vertrag begrenzt sowohl die angeforderten Projekt-IDs als auch die ausgegebenen Topics auf höchstens 200; diese Obergrenze hält die Topicliste und das signierte Cookie begrenzt.

Alle fachlichen UI-Updates werden ausdrücklich als privat veröffentlicht; eine schwer erratbare Topic-URL ersetzt diese Einstellung nicht.

Der moderne Tokenvertrag verwendet `typ: at+jwt`, `iss`, `aud`, `exp`, `sub`, `client_id`, `iat`, `jti` und `authorization_details`. Alte `mercure.publish`-/`mercure.subscribe`-Claims und Legacy-Kompatibilitätsoptionen werden nicht übernommen. Die geprüfte Symfony-Konfiguration unterstützt getrennte `publisher`- und `subscriber`-Factories. [Konfiguration v0.7.0](https://github.com/symfony/mercure-bundle/blob/v0.7.0/src/DependencyInjection/Configuration.php), [Tokenvertrag](https://mercure.rocks/spec)

Der Subscriber-JWT wird ausschließlich als `__Secure-mercure_access_token` mit HttpOnly, Secure, SameSite=Strict und Hub-Pfad gesetzt. Für dieselbe Origin bleibt das Cookie hostgebunden. Der Produkt-TTL beträgt 600 Sekunden; nur das isolierte Testprofil kann ihn über `MERCURE_SUBSCRIBER_TTL` auf 60 bis 600 Sekunden überschreiben und setzt ihn im Compose-Testprofil auf 60 Sekunden. Der API-Vertrag begrenzt die Topics auf höchstens 200, damit die Cookie-Nutzlast nicht unbeschränkt mit der Projektzahl wächst. JWTs erscheinen weder in URLs noch in JavaScript-Speichern oder API-Antwortkörpern. T3-Tokens, OpenAI-Zugänge, MCP-Bearer und Publisher-Secrets gelangen nie an das Frontend. [Cookie-Implementierung v0.10.0](https://github.com/symfony/mercure/blob/v0.10.0/src/Authorization.php)

## 5. Implementierte JSON-Endpunkte

Die Operationen sind im [OpenAPI-Vertrag](../contracts/openapi.yaml) beschrieben und werden über den Laufzeit-Handler in [`Live.php`](../src/Live/Infrastructure/Live.php) ausgeführt; sie sind keine separaten Symfony-Controller.

| Route | Vertrag |
|---|---|
| `GET /api/v1/live/config` | Liefert Hub-URL, Owner-Topic oder aktuell erlaubte Projekt-Topics und Angaben zur Erneuerung; keine Zugangstokens. |
| `POST /api/v1/live/authorize` | Prüft die Eigentümersitzung und CSRF-Schutz, ermittelt das Owner-Topic oder die ausdrücklich angeforderten Projekt-Topics, setzt das HttpOnly-Cookie und liefert Ablauf-/Erneuerungsmetadaten. |

Beide Antworten sind privat und werden nicht gemeinsam gecacht. Für die Gesamtsicht wird keine Projektliste benötigt; der Eigentümer abonniert das einzelne Owner-Topic. Ein bewusst begrenzter Projektgrant wird aus den angeforderten Projekt-IDs gebildet; das Backend prüft deren Gültigkeit und fügt keine weiteren Projekte hinzu. Der Produkt-TTL beträgt zehn Minuten, das isolierte QA-Profil verwendet 60 Sekunden. Abmeldung beendet die Browserverbindung und löscht das Cookie; ein bereits ausgegebener JWT bleibt außerhalb dieser Browserinstanz höchstens bis zu seinem Ablauf gültig.

## 6. Veröffentlichen nach Commit

Ein fachlicher Command schreibt Domainzustand, History und Outbox atomar in derselben kurzen DBAL-Transaktion. Erst nach deren Commit verarbeitet ein separater Publisher die UI-Lieferung über Symfony `HubInterface` und HTTP-POST. Während des Netzaufrufs bleibt keine fachliche SQLite-Transaktion offen.

Der Hinweis enthält eine stabile Event-ID, Projekt-/Objektkennung, Objekttyp und Version. Vollständige Prompts, Logs, Secrets und veränderliche Geschäftsdaten werden nicht mitgesendet. Der Empfänger invalidiert passende Abfragen und lädt den aktuellen Zustand über JSON.

Für diese Außenwirkung gibt es einen eigenen persistenten Lieferstatus. Eine Hub-Bestätigung bedeutet nur, dass der Hub das Update angenommen hat; sie bestätigt keinen Empfang durch einen Browser und keine andere Außenwirkung derselben Outbox. Nach einem Timeout darf erneut veröffentlicht werden. Dieselbe Event-ID und versionsbewusste Clients machen Duplikate unschädlich. Bei Hub-Ausfall funktioniert die JSON-API weiter; die Oberfläche zeigt einen verzögerten Live-Status.

## 7. Browser-Vertrag und Wiederaufnahme

Pro Browseransicht wird eine native EventSource-Verbindung geöffnet. Exakte Topics werden mit wiederholten `match`-Parametern abonniert; für das Publizieren heißt der Parameter weiterhin `topic`. Native EventSource erlaubt keinen frei gesetzten Authorization-Header. Die Same-Origin-Verbindung verwendet das zuvor gesetzte Cookie; eine abweichende CORS-Architektur ist zunächst unnötig. [Migration zu V1](https://mercure.rocks/docs/UPGRADE)

Die Oberfläche registriert zuerst die Eventhandler und synchronisiert bei **jedem `open`**, einschließlich Reconnect, ihre sichtbaren JSON-Abfragen. Ein während des Ladens eintreffender Hinweis löst nötigenfalls eine weitere Invalidierung aus; ältere Antworten dürfen keinen neueren Zustand überschreiben. Nach längerer Hintergrundpause erfolgt ebenfalls eine Synchronisation.

EventSource sendet beim automatischen Reconnect den zuletzt empfangenen `Last-Event-ID`-Requestheader. Eine neue Instanz kann `last_event_id` verwenden. Diese Kennung ist ein opaker Hub-Cursor, keine Domain-History-Sequenz. Insbesondere wird kein noch unveröffentlichtes Outbox-Ereignis als bereits bekannter Hub-Cursor ausgegeben. Native EventSource kann den Responseheader `Mercure-Last-Event-ID` nicht lesen; die Anwendung verspricht daher keine darauf basierende automatische Lückenerkennung. [Reconnect und History](https://mercure.rocks/docs/concepts/reconnection-and-history)

Der Hub beendet Verbindungen spätestens bei Tokenablauf. Nach einem 401 kann natives EventSource seine Versuche einstellen. Der Client erneuert das Cookie rechtzeitig anhand der erhaltenen Metadaten und öffnet bei Bedarf eine neue Instanz. Fehler führen zu begrenztem Backoff, einer Prüfung der Sitzung und erneutem Snapshot; fehlende Anmeldung beendet den Ablauf. [Autorisierung und Ablauf](https://mercure.rocks/docs/concepts/authorization)

## 8. Persistenz und Abnahme

Bolt speichert einen begrenzten Replaypuffer auf dem persistenten Volume. Eine positive `size` mit positiver `cleanup_frequency` verhindert die unbegrenzte Standardeinstellung; Bereinigung ist probabilistisch. Domain-History, Action-Journal und Outbox bleiben in SQLite. Verlust oder Bereinigung des Hub-Puffers darf fachliche Daten nicht beschädigen und wird durch Neuladen ausgeglichen.

Caddys öffentliche lokale Root-CA wird aus dem Datenvolume exportiert; ihr privater Schlüssel bleibt geschützt. Linux-Systemvertrauen, ein gegebenenfalls eigener Browser-Zertifikatsspeicher und die tatsächlichen PHP-CLI-/T3-/Agent-Clients werden einzeln berücksichtigt. Node-Clients können `NODE_EXTRA_CA_CERTS` verwenden; die Variable wirkt ab Prozessstart. Der Symfony-HTTP-Client im PHP-CLI-Prozess benötigt Vertrauen in diese CA in seinem Zertifikatsspeicher. Zertifikatsprüfung bleibt aktiviert. [Caddy und Docker](https://caddyserver.com/docs/running#local-https-with-docker), [Node-CA-Konfiguration](https://nodejs.org/api/cli.html#node_extra_ca_certsfile), [Symfony-HTTPS-Client](https://symfony.com/doc/7.4/http_client.html#https-certificates)

Die Owner-Topic-Auswahl, der eingeschränkte Projektgrant, das HttpOnly-Cookie und die TTL-Regel sind in der Anwendung implementiert. Der Laufbeleg für private Aktualisierungen und den Produktionscontainer steht getrennt in [TRACEABILITY.md](TRACEABILITY.md); geplante Prüffälle ohne erfolgreichen Lauf bleiben offen. Die lokalen Browser- und Containergrenzen stehen in [VALIDATION.md](VALIDATION.md). `localhost` ist nicht automatisch zwischen Linux-Host, Container und einem zweiten Gerät identisch erreichbar.
