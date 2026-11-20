# Falkenwarte

Falkenwarte ist ein privater Arbeitsbereich für eine Person. Du organisierst Projekte auf Boards, hältst Kriterien und Entscheidungen an Tickets fest und siehst, welche Rückfragen auf dich warten. Projekte und Tickets kannst du ohne externe Dienste bearbeiten. Wenn du Agents einbindest, übernimmt OpenAI Decisions die Einordnung technischer Eingänge. Über T3 Code vergibst du Aufträge und erhältst Ergebnisse am Ticket.

## Lokal starten

Du brauchst Linux, Git, Docker mit Compose und Make. Starte die Anwendung im ausgecheckten Repository und kopiere ihr lokales Stammzertifikat.

```sh
make app-up
docker compose exec -T app cat /certs/root.crt > ~/falkenwarte-root.crt
```

Importiere das Zertifikat in den Vertrauensspeicher deines Browsers. Öffne anschließend [Falkenwarte auf localhost](https://localhost:8443). Beim ersten Start fragt die Anwendung nach dem einmaligen Einrichtungstoken. Lies es im lokalen Terminal aus.

```sh
docker compose exec -T app cat /data/setup-token
```

Nach der Einrichtung kannst du dein erstes Projekt und Ticket anlegen. Die Konfiguration beginnt mit den eingecheckten Standardwerten in `.env`. Persönliche Einstellungen gehören in `.env.local`. [Erste Schritte und Bedienung](docs/USER_GUIDE.md) · [Betrieb und Konfiguration](docs/OPERATIONS.md)

## Im Projekt arbeiten

| Ich möchte … | Einstieg |
| --- | --- |
| Meinen T3-Agents beibringen, Falkenwarte zu verwenden | [Agent-Skill im eigenen Projekt installieren](docs/user/AGENT_SKILL.md) |
| Mit einem Agenten an Falkenwarte selbst entwickeln | [Projektskills für die Arbeit im Falkenwarte-Checkout](AGENTS.md) |
| Einen Arbeitsablauf im Handbuch nachschlagen | [Handbuch](docs/README.md) |
| Eine Fachregel ändern und das zuständige Modul finden | [Architektur](docs/ARCHITECTURE.md) und [Fachmodell](docs/domain/BOUNDED_CONTEXTS.md) |
| Einen Client oder ein MCP-Werkzeug anbinden | [Öffentliche Verträge](contracts/README.md) |
| Eine Änderung lokal prüfen | [Tests und QA](docs/TESTING.md) |
| Eine Anleitung ändern und im Browser lesen | [Dokumentationspflege](docs/DOCUMENTATION.md) |

`make install` installiert die Entwicklungsabhängigkeiten. `make check` prüft unter anderem die PHP-Formatierung, den Symfony-Container, das Frontend und das Handbuch. `make qa` führt zusätzlich die Docker- und Browserprüfungen aus. Alle Ziele zeigt `make help`.
