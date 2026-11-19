# Tatsächliche Prüfergebnisse

GitHub hat den Implementierungsstand `4f622bdd0ca02a95f38b62c81f363dc7fb4ebd92` vollständig geprüft. Die folgenden Ergebnisse beziehen sich auf diesen Commit und das dort gebaute Linux-Image. [Implementierungs-PR](https://github.com/DZunke/Falkenwarte/pull/1) · [GitHub-QA](https://github.com/DZunke/Falkenwarte/actions/runs/44601589479)

Der Hauptbericht enthält **49 protokollierte Abnahmebeobachtungen**. Hinzu kommen zwei Produktionsprüfungen für A19 und fünf getrennte A17-Berichte über den Plugin-Imagewechsel. Er nennt die Image-ID `sha256:7f566305ac7c4fcaacaeeae45525716f79b8a8cc5e31bd034ae909def14c8d72` und die Fixtureversion `falkenwarte.qa.scenario-catalog.v1`. Die Abnahme griff auf die gestartete Anwendung, SQLite, Worker und Mercure zu. Die Produktionsprüfung startete dasselbe Image zweimal und las das zuvor angelegte Ticket nach dem Neustart erneut.

## Abnahme des Implementierungs-PRs

Der Implementierungs-PR bestand auf Commit `b33b13ff4f974c3ce171283da0eff5f03544b5b9` alle sieben GitHub-Jobs, darunter die Browserabnahme des gebauten Linux-Images. Der geschützte Hauptzweig hat diesen Stand als Squash-Merge übernommen. [Implementierungs-PR](https://github.com/DZunke/Falkenwarte/pull/1) · [GitHub-QA](https://github.com/DZunke/Falkenwarte/actions/runs/44603788249)

## Meilensteine

| Meilenstein | Abnahmefälle | Ergebnis | Geprüfter Ablauf |
|---|---|---|---|
| M0 · Grundlage | A03, A23 | Bestanden | DBAL-Architektur, öffentliche Verträge und statisches Handbuch. |
| M1 · Menschlicher Ticketablauf | A01, A04, A06, A07, A08, A14, A21, A24, A28 | Bestanden | Projekt und Board, Ticketabschluss ohne Agent, Konfliktauflösung und Wiederherstellung mit historischen Zusatzfeldern. |
| M2 · Intake und MCP | A02, A13, A22, A25, A26, A27, A33 | Bestanden | Technische Eingänge, Rückfragen, ungültige oder überholte Decisions-Antworten und gleichzeitige Entscheidungsgründe. |
| M3 · T3 und Übergaben | A05, A09, A10, A11, A12, A29, A30 | Bestanden | Echter MCP-Client am T3-Testdienst, verlorene Startantwort, frühe Ergebnismeldung und neue OAuth-Sitzung. |
| M4 · Workflows und Kennzahlen | A12, A16, A27, A33 | Bestanden | E23–E25 prüfen bedingte Übergänge, getrennte Rollen, eingefrorene Berichte, das Reparaturlimit und den anschließenden menschlichen Ticketabschluss. |
| M5 · Plugins und Wissen | A17, A18, A23, A32 | Bestanden | Die Linknotizen durchliefen Aktivierung und Stilllegung. Das Handbuch war im Browser erreichbar. |
| M6 · Betrieb und Veröffentlichung | A15, A19, A20, A21, A31 | A31 wartet auf Veröffentlichung | Produktionsstart und Neustart ohne externe Zugänge, private Live-Updates und externe Inventur nach Restore. |

## M5 · Plugin-Abnahme über zwei Images
Die fünf A17-Chromium-Berichte stammen aus dem `acceptance`-Artefakt desselben [GitHub-QA-Laufs](https://github.com/DZunke/Falkenwarte/actions/runs/44601589479). Die QA-Phasen `plans`, `prepare` und `readback` verwenden gemeinsam das QA-Image `sha256:9c6229863d8b91cec7fb81cb913c26693c7050c454e4a6e902db9a05bf582114`; beide Produktionsphasen verwenden das Hauptimage `sha256:7f566305ac7c4fcaacaeeae45525716f79b8a8cc5e31bd034ae909def14c8d72`. Alle fünf Berichte belegen Commit `4f622bdd0ca02a95f38b62c81f363dc7fb4ebd92` und Fixtureversion `falkenwarte.qa.scenario-catalog.v1`.

| Phase | Bericht | Image | Beobachteter Browserablauf |
|---|---|---|---|
| QA · Plan und JSON-Export | `plugin-upgrade-plans.json` | `sha256:9c6229863d8b91cec7fb81cb913c26693c7050c454e4a6e902db9a05bf582114` | Der Browser erstellte Installations- und Entfernungspläne und lud beide als JSON herunter. Der Export entsprach jeweils GET /plugin-install-plans/{plan_id}; ein Legacy-Installationsaufruf ohne operation blieb Installation. Ein aktives Linknotizen-Plugin erhielt HTTP 409 (plugin_state_conflict); nach Deaktivierung wechselte der QA-Pluginstatus zu uninstall_pending und nach Zurücknahme zu installed_disabled. |
| QA · Entfernungsplan vorbereiten | `plugin-upgrade-prepare.json` | `sha256:9c6229863d8b91cec7fb81cb913c26693c7050c454e4a6e902db9a05bf582114` | Der Browser erstellte den Entfernungsplan 01a1f561-fd45-7f0c-bf24-cf99fceb47f6. Der Pluginstatus ist uninstall_pending; die nicht leere Einstellung retention_marker wurde über die öffentliche Konfigurations-API gespeichert. |
| Produktion · erster Imagewechsel | `plugin-upgrade-verify.json` | `sha256:7f566305ac7c4fcaacaeeae45525716f79b8a8cc5e31bd034ae909def14c8d72` | Nach dem Wechsel zeigte GET /plugins/falkenwarte.qa-bridge-dependent den Zustand removed und configuration_retained=true. Der Plan 01a1f561-fd45-7f0c-bf24-cf99fceb47f6 ist completed; die Pluginrevision enthält den Übergang uninstall_pending → removed und GET /events lieferte den korrelierten Änderungshinweis. Die Oberfläche zeigte die erhaltene Konfiguration und den abgeschlossenen Plan. |
| QA · Daten und Historie erneut lesen | `plugin-upgrade-readback.json` | `sha256:9c6229863d8b91cec7fb81cb913c26693c7050c454e4a6e902db9a05bf582114` | Das QA-Image las retention_marker über GET /plugins/falkenwarte.qa-bridge-dependent/config mit dem ursprünglichen Wert. Der Pluginstatus blieb removed und der Plan blieb completed. |
| Produktion · zweiter Imagewechsel | `plugin-upgrade-verify-after-readback.json` | `sha256:7f566305ac7c4fcaacaeeae45525716f79b8a8cc5e31bd034ae909def14c8d72` | Nach dem Wechsel zeigte GET /plugins/falkenwarte.qa-bridge-dependent den Zustand removed und configuration_retained=true. Der Plan 01a1f561-fd45-7f0c-bf24-cf99fceb47f6 ist completed; die Pluginrevision enthält den Übergang uninstall_pending → removed und GET /events lieferte den korrelierten Änderungshinweis. Die Oberfläche zeigte die erhaltene Konfiguration und den abgeschlossenen Plan. |

Die [Anforderungszuordnung](TRACEABILITY.md) nennt für alle 36 Anforderungen die betroffenen Dateien, die Dokumentation und die Abnahmefälle. Die [Abnahmekriterien](ACCEPTANCE.md) beschreiben die erwarteten Ergebnisse.

## Ausgeführte Prüfungen

| Prüfung | Befehl und Ergebnis |
|---|---|
| Statische QA | `php scripts/check-contracts.php`, `php scripts/check-architecture.php`, `php bin/console lint:container`, PHPStan, PHP CS Fixer sowie API-Codegenerierung, Frontend-Lint und Build bestanden. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44601589479/job/135834134751) |
| Hintergrundarbeit | `vendor/bin/phpunit -c phpunit.dist.xml` prüfte mit einem unterbrochenen Messenger-Worker die erneute Zustellung. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44601589479/job/135834134727) |
| Handbuch | `php scripts/check-docs.php` und `php scripts/build-docs.php` bestanden. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44601589479/job/135834134278) |
| Image | Der Linux-Build lieferte das Image, sein CycloneDX-Inventar und die Lizenzhinweise. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44601589479/job/135834135063) |
| Chromium | `bash scripts/ci-e2e.sh` prüfte Produktionsstart und Neustart sowie die öffentliche Browser-, JSON- und MCP-Oberfläche. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44601589479/job/135835526054) |
| Branchregel | Der erforderliche GitHub-Check `quality-gate` bestätigte alle sechs vorgelagerten Jobs. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44601589479/job/135841475533) |

## Externe Dienste und Fork-Prüfung

Die T3-Abnahme verwendete einen zustandsbehafteten HTTP-MCP-Testdienst. Der Decisions-Testdienst beantwortete HTTP-Anfragen am Adapterrand. Für eine private T3-Instanz und ein echtes OpenAI-Konto liegt kein Live-Nachweis vor. Die Einrichtung und die getrennten Verbindungstests stehen im [Betriebshandbuch](LIVE_SERVICES.md).

Die Prüfung eines Pull Requests aus einem fremden Fork wurde auf Wunsch des Eigentümers vertagt.

Den aktuellen Tag, das Image-Manifest und die Browserbeobachtungen zum veröffentlichten Commit führt [GitHub Releases](https://github.com/DZunke/Falkenwarte/releases).
