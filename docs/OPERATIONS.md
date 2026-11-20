# Falkenwarte auf Linux betreiben

Falkenwarte läuft im Produktions-Compose als einzelner App-Container. Darin werden FrankenPHP, Messenger-Worker und Maintenance-Loop überwacht. Die SQLite-Datenbank und Betriebsdateien liegen im lokalen persistenten Docker-Volume.

Für einen Start aus dem Quellcheckout verwende `make app-up`. Das Ziel baut das aktuelle Image und wartet auf den Healthcheck. Für ein veröffentlichtes Image findest du den Digest-Startweg unter [Image und Konfiguration](operations/DEPLOYMENT_AND_CONFIGURATION.md).

```bash
make app-up
docker compose ps
docker compose logs --tail=100 app
```

Die App ist standardmäßig nur unter `https://localhost:8443` erreichbar. Der Container prüft die Zertifikatskette mit seiner lokalen Caddy-Root-CA. Importiere `/certs/root.crt` nur in den Browser, wenn du dieser Installation vertraust.

## Laufzeit und Daten

Der Entrypoint prüft vor dem Start die Datenbank und führt ausstehende Migrationen aus. Er schließt einen angeforderten Restore ab, bevor HTTP, Worker und Maintenance laufen. Maintenance verwendet eine exklusive Sperre. Starte deshalb keinen zweiten `app:maintenance`-Prozess.

Das Produktionsvolume enthält unter anderem `/data/falkenwarte.sqlite`, `/data/backups`, `/data/.secrets`, Caddy-Zertifikate und Restore-Nachweise. SQLite braucht ein lokales Volume. Hänge es nicht auf ein Netzwerkdateisystem.

`make app-down` stoppt Compose und lässt das Volume bestehen. `make clean` entfernt nur erzeugte Frontend- und Dokumentationsdateien im Checkout. `docker compose down --volumes` löscht die Compose-Volumes und damit die produktiven App-Daten.

## Status prüfen

```bash
docker compose ps
docker compose exec -T app php /usr/local/bin/falkenwarte-healthcheck
docker compose logs --tail=100 app
```

Der Healthcheck ruft `/healthz` über HTTPS mit Zertifikatsprüfung auf. Bei einem Fehler siehst du zuerst die Compose-Zustände und App-Logs. Teile dabei keine Secretdateien, Sitzungstokens oder vollständigen Restoremarker.

Maintenance hält neue und automatische Starts an. Laufende Aufträge bleiben sichtbar.

Weitere Anleitungen:

- [Image und Konfiguration](operations/DEPLOYMENT_AND_CONFIGURATION.md): Start, Updates und Geheimnisse.
- [Backup und Restore](operations/BACKUP_AND_RESTORE.md): Datenkopien, Wiederherstellung und anschließender T3-Abgleich.
- [Zugangs- und Sicherheitshinweise](operations/ACCESS.md): Anmeldung und Zugriffsschutz.
