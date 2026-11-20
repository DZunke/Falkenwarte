# Image und Konfiguration

Der Container startet HTTP, Queue-Worker und Maintenance unter gemeinsamer Prozessaufsicht. Verwende für lokale Entwicklung die Make-Ziele. Für ein veröffentlichtes Image nimmst du den Digest aus dem Release-Manifest.

## Aus dem Checkout starten

1. Installiere Docker Engine mit Compose-Plugin und wechsle in den Repository-Checkout.
2. Prüfe die nicht geheimen Defaults in `.env`. Lege persönliche Overrides in `.env.local` ab.
3. Starte mit `make app-up` und prüfe danach `docker compose ps` sowie `docker compose logs --tail=100 app`.
4. Beim ersten Aufruf zeigt Falkenwarte die Eigentümereinrichtung. Lies das einmalige Token mit `docker compose exec -T app cat /data/setup-token` in einem vertrauenswürdigen Terminal aus. Das Token muss mindestens 32 Zeichen lang sein.
5. Richte einmalig den Eigentümernamen und ein mindestens 12 Zeichen langes Passwort ein.

`make app-up` lädt `.env` und bei vorhandener Datei auch `.env.local` für Compose-Variablen. Compose lädt `.env` bei direkten Standardaufrufen automatisch, aber nicht `.env.local`.

Wenn du `.env.local` direkt einlesen willst, gib beide Dateien an: `docker compose --env-file .env --env-file .env.local up --build -d --wait`. Ohne `.env.local` reicht `docker compose --env-file .env up --build -d --wait`.

Beim Checkout setzt Symfony `var/` als Standard für Datenbank und Backups. Das Produktions-Compose setzt `APP_ENV=prod` und verwendet fest `/data/falkenwarte.sqlite` sowie `/data/backups`. Die Produktionsdaten bleiben im Docker-Volume.

Nützliche Make-Ziele sind `make help`, `make app-up`, `make app-logs` und `make app-down`. `make app-down` erhält die Daten. Lösche das Compose-Volume nicht, wenn du die Installation weiterverwenden willst.

## Ein veröffentlichtes Image starten

Lade `image-manifest.json` aus dem GitHub-Release und verwende unverändert den darin angegebenen Image-Digest:

```bash
curl -fsSLO https://github.com/DZunke/Falkenwarte/releases/latest/download/image-manifest.json
export FALKENWARTE_IMAGE="$(jq -er .image image-manifest.json)"
docker compose up --no-build -d --wait
docker compose ps
docker compose logs --tail=100 app
```

Der Produktionsstart verwendet keine Entwicklungs- oder Testdienste. Wenn du ein lokales Image baust, nimm stattdessen `make app-up`.

## Geheimnisse und `.env.local`

`.env` enthält nicht geheime Standardwerte für Symfony Runtime. `.env.local` überschreibt Compose-Variablen auf diesem Host und gehört nicht ins Git. Gesetzte Prozessvariablen haben Vorrang. Der Produktionscontainer setzt `APP_ENV=prod` unabhängig vom Symfony-Checkout-Standard.

Lege Secretdateien in `secrets/` ab und setze die zugehörige `*_FILE`-Variable auf den Containerpfad unter `/run/secrets`. Compose bindet `secrets/` dort schreibgeschützt ein. Die [Anleitung zu Secretdateien](../../secrets/README.md) erklärt das Format.

Der Entrypoint erzeugt fehlende Werte für `APP_SECRET`, `MERCURE_PUBLISHER_SECRET` und `MERCURE_SUBSCRIBER_SECRET` im geschützten Verzeichnis `/data/.secrets`. Das automatisch erzeugte Eigentümer-Setup-Token liegt separat unter `/data/setup-token`.

`DECISIONS_API_KEY` wird nicht automatisch erzeugt. Richte den Zugang für OpenAI Decisions unter **Einstellungen** ein oder stelle den Schlüssel über eine Secretdatei beziehungsweise geschützte Laufzeitkonfiguration bereit. Ohne diesen Schlüssel sind OpenAI-gestützte Einordnungen nicht verfügbar.

Bei einem Wechsel der Secretdateien müssen der bisherige Verschlüsselungsschlüssel und die für die Wiederanmeldung benötigten Zugänge erhalten bleiben. Ein Datenbankbackup enthält keine Secretwerte. Bewahre benötigte Schlüssel getrennt und geschützt auf.

## HTTPS und Updates

Der Compose-Port ist an `127.0.0.1:8443` gebunden. Lokal verwendest du `https://localhost:8443`. Die öffentliche Caddy-Root-CA liegt im App-Container unter `/certs/root.crt`. Der private Caddy-Schlüssel bleibt im Datenvolume und wird nicht exportiert.

Für ein Update setzt du `FALKENWARTE_IMAGE` auf den neuen Release-Digest und startest mit `docker compose up --no-build -d --wait`. Prüfe danach den Healthcheck, `docker compose ps` und die App-Logs.

Beim Start führt der Entrypoint Datenbankmigrationen aus, bevor HTTP, Worker und Maintenance starten. Ein älteres Image ist nur dann ein sicherer Rollback, wenn es das bereits migrierte Schema unterstützt. Automatische Down-Migrationen sind kein Rollback-Verfahren.

Bei SIGTERM beendet der Entrypoint seine Kindprozesse geordnet. Einen kurzzeitigen lokalen Prozessausfall versucht er erneut zu starten. Wiederholte Prozessabbrüche lassen den Container für die Compose-Restartpolicy fehlschlagen. Ein T3- oder OpenAI-Ausfall allein löst keine Neustartschleife aus.
