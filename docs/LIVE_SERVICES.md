# Live-Services: Mercure, sichere Topics und Wiederaufnahme

Mercure verteilt private Änderungs-Hinweise an angemeldete Browser. Die autoritativen Daten bleiben in der Falkenwarte-Datenbank und werden nach einem Hinweis über die JSON-API neu geladen.

## Konfiguration

| Variable oder Parameter | Verhalten |
|---|---|
| `FALKENWARTE_PUBLIC_ORIGIN` | Öffentliche HTTPS-Origin. Standard ist lokal `https://localhost:8443` |
| `FALKENWARTE_PUBLIC_URL` | Rückwärtskompatibler Callback-Origin. Fällt auf `FALKENWARTE_PUBLIC_ORIGIN` zurück |
| `MERCURE_PUBLIC_URL` | Browser-Hub-URL. Standard `<public-origin>/.well-known/mercure` |
| `MERCURE_INTERNAL_URL` | Server-zu-Hub-URL. In Compose `http://127.0.0.1:8080/.well-known/mercure` |
| `MERCURE_ISSUER` | JWT-Aussteller. Standard ist die öffentliche App-Origin |
| `MERCURE_RESOURCE_IDENTIFIER` | JWT-Audience. Standard ist die öffentliche Hub-URL |
| `MERCURE_PUBLISHER_SECRET` und `MERCURE_SUBSCRIBER_SECRET` | Separate Schlüssel für Publish- und Subscribe-Tokens |
| `MERCURE_SUBSCRIBER_TTL` | Produktion 600 s. Nur Test-Environment kann 60 bis 600 s setzen |

Die nicht geheimen Defaultwerte stehen in der [Symfony-Umgebungsdatei](../.env). `.env.local` überschreibt sie bei der lokalen Entwicklung. Die [Mercure-Paketkonfiguration](../config/packages/mercure.yaml) verbindet den Hub mit `mercure.client`, einem Scoped Client mit 2 s Timeout und 3 s Maximaldauer. Im Container terminiert Caddy TLS und stellt den internen Hub auf Loopback bereit: [Compose](../compose.yaml) und [Caddyfile](../docker/Caddyfile).

## Autorisierung und Browserfluss

1. Der Client liest `GET /api/v1/live/config` mit erlaubten Topics, öffentlicher Hub-URL, TTL und Catch-up-Cursor.
2. `POST /api/v1/live/authorize` erfordert die Browser-Session und CSRF-Schutz. Der Server setzt ein zeitlich begrenztes Subscribe-Cookie.
3. Das Cookie heißt `__Secure-mercure_access_token` und ist Secure, HttpOnly, SameSite=Strict sowie auf `/.well-known/mercure` begrenzt.
4. Die React-Anwendung öffnet `EventSource` mit Credentials und lädt bei Verbindungsaufbau und Ereignissen aktuelle JSON-Snapshots nach.

Subscriber-Tokens enthalten ausschließlich Subscribe-Rechte für serverseitig berechnete private Topics. Ein Topic ist `urn:falkenwarte:project:<project-id>` oder `urn:falkenwarte:owner`. Der Browser erhält weder JWT-Werte im JSON noch Publisher-Rechte. Die Frontend-Anwendung lehnt eine Hub-Adresse mit anderer Origin als die App ab.

Ein Ereignis ist ein Hinweis, kein Geschäftsdokument. Der Client dedupliziert Event-IDs, bündelt Query-Invalidierungen innerhalb von 80 ms und lädt den aktuellen Zustand erneut. Nach einem 401 wird die Session-Query ungültig gemacht. Der Subscribe-Cookie wird 30 Sekunden vor Ablauf erneuert. Verbindungsfehler lösen exponentiellen Reconnect-Backoff von 1 bis 30 s aus.

## Veröffentlichung und Fachverantwortung

Ein Domain-Schreibvorgang speichert sein Ereignis und die Live-Ansicht dauerhaft. `Live::publish()` liest bis zu 100 unveröffentlichte Einträge und erstellt einen kurzlebigen Publisher-JWT für Projekt- und Owner-Topic. Es sendet die private Mercure-Nachricht und markiert den Eintrag erst nach erfolgreicher HTTP-Antwort als veröffentlicht.

Bricht der Prozess nach erfolgreichem Hub-POST, aber vor dem Datenbank-Update ab, kann derselbe Hinweis erneut gesendet werden. Der Browser dedupliziert Event-IDs.

Der Hub erhält in Compose einen persistenten Bolt-Puffer mit 20.000 Ereignissen. Seine Bereinigung ist begrenzt. Dieses Hub-Pufferlimit ändert weder Domain-Historie noch Aufgabenrevisionen. Der Anwendungscursor ist deshalb unabhängig vom EventSource-Transport und ermöglicht Wiederherstellung aus der Datenbank.

## Ausfall und Wiederaufnahme

| Ausfall | Verhalten |
|---|---|
| Publisher-/Subscriber-Schlüssel fehlen oder sind ungültig | Live-Autorisierung bzw. Veröffentlichung antwortet mit `503`. Fachliche Änderungen bleiben gespeichert |
| Mercure ist nicht erreichbar | Der noch unveröffentlichte Eintrag bleibt auf `published=0`. Maintenance versucht die Veröffentlichung nach 5 s erneut |
| Browser offline oder EventSource-Fehler | Reconnect mit exponentiellem Backoff von 1 bis 30 s. Beim Wiederverbinden werden Snapshots geladen |
| Hub-Puffer wurde bereinigt oder ein API-Client war lange getrennt | `GET /api/v1/events` liest ab dem Base64-kodierten Sequenzcursor nach |
| Catch-up-Cursor liegt vor der Retentionsgrenze | Die Events-API antwortet mit `410 resync_required` und `/api/v1/dashboard` als Snapshot-URL |

Der Catch-up-Endpunkt ist für Clients vorhanden, die den Sequenzcursor nachführen. Der aktuelle Browser-Hook ruft ihn nicht auf: Nach jedem EventSource-Verbindungsaufbau invalidiert er die fachlichen Abfragen und lädt deren aktuelle Snapshots.

Die Einstellung `ui_event_retention_hours` hat standardmäßig 24 Stunden. Maintenance entfernt nach Ablauf nur `change_json` aus der Replay-Ansicht und aktualisiert den `event_floor`. Domain-Ereignisse und Revisionshistorie bleiben erhalten.

## Relevante Quellen

- [Mercure-Autorisierung](https://mercure.rocks/docs/concepts/authorization) und [Mercure-Hub-Konfiguration](https://mercure.rocks/docs/hub/config).
- [Symfony Mercure Bundle](https://symfony.com/doc/current/mercure.html) und [Symfony HTTP Client](https://symfony.com/doc/7.4/http_client.html).
- [Live-Handler](../src/Live/Infrastructure/Live.php), [Browser-Verbindung](../frontend/src/lib/use-live.ts) und [Maintenance-Schleife](../src/Shared/Infrastructure/MaintenanceCommand.php).
- [OpenAPI-Vertrag](../contracts/openapi.yaml): Live-Konfiguration, Cookie-Autorisierung und Events-Catch-up.
