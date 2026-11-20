# Tatsächliche Prüfergebnisse

## Release v0.2.2 · Symfony, Formatierung und lokale QA

Der abgenommene Release-Commit ist `2260bc7801790ba12fa45dbc6c82be357a91cfe6`. Das Release enthält Browserberichte, Softwareinventar und das Manifest des geprüften Linux-Images. Die Anforderungstabelle ordnet alle 36 Anforderungen den Meilensteinen M0 bis M6 und den 33 belegten Abnahmefällen zu. [Release v0.2.2](https://github.com/DZunke/Falkenwarte/releases/tag/v0.2.2) · [Anforderungs- und Abnahmenachweis](TRACEABILITY.md)

| Prüfung | Ergebnis | Beleg |
|---|---|---|
| PHP, Frontend und Dokumentation | `make check` lokal bestanden. PHP-CS-Fixer meldete 0 Abweichungen in 136 Dateien. PHPStan, Symfony-Container, Architektur, Verträge, TypeScript, ESLint und Handbuchbau bestanden. | [QA des Umsetzungs-PR](https://github.com/DZunke/Falkenwarte/actions/runs/44713821178) |
| Unterbrochener Worker | Die Background-Suite bestätigte Wiederzustellung und Inbox-Deduplizierung mit 7 Assertions. | [Release-QA](https://github.com/DZunke/Falkenwarte/actions/runs/44720079940) |
| Browser, HTTP und MCP | 42 Playwright-Tests und 49 protokollierte Abnahmebeobachtungen bestanden. Hinzu kommen 2 Produktionsprüfungen für Start und Neustart sowie 5 Phasen des Plugin-Imagewechsels. | [Browserabnahme](https://github.com/DZunke/Falkenwarte/releases/download/v0.2.2/browser-acceptance.tar.gz) |
| Reproduzierbarkeit | Beide unabhängigen Builds lieferten dieselbe Image-ID, 44 identische Layer und dasselbe Softwareinventar mit 477 Komponenten. | [Erster Build](https://github.com/DZunke/Falkenwarte/actions/runs/44720079940) · [Zweiter Build](https://github.com/DZunke/Falkenwarte/actions/runs/44720082235) |

Zwei lokale Browserläufe deckten eine unnötige Erhöhung der Pluginrevision während eines Drains auf. Der Worker schreibt die Revision jetzt nur bei geänderten Zählern oder geändertem Zustand. A18 prüft die stabil gebliebene Revision. A20 wartet nach dem Restore auf die abgeschlossenen Drain-Actions, bevor der Test die nächste Änderung sendet. Im vollständigen Wiederholungslauf bestanden beide Fälle. [Umsetzungs-PR](https://github.com/DZunke/Falkenwarte/pull/10)

Nach der Veröffentlichung wurde das Image anonym über den Digest aus dem Release-Manifest geladen. Der Produktionsharness startete dieses Image mit einem leeren Volume. A19 bestand im Browser beim Erststart und erneut nach dem Neustart mit demselben Volume. Beide Prüfungen liefen ohne aktive T3- oder OpenAI-Konfiguration. [Release-Manifest](https://github.com/DZunke/Falkenwarte/releases/download/v0.2.2/image-manifest.json) · [Produktionsharness](../scripts/ci-production.sh)

Für private T3- und OpenAI-Verbindungen fehlen weiterhin aktive Zugangsdaten. Die externen Aufrufe der Browserabnahme gingen an die beiden Netzwerk-Mocks. Die Prüfung eines PR aus einem fremden Fork bleibt auf Wunsch des Eigentümers offen.

## Historischer Nachweis v0.2.0

Für v0.2.0 hat GitHub den Commit `00d260efdb361deaa14fb75c76fa44a71e5965ba` geprüft. Das veröffentlichte Linux-Image stammt aus diesem Lauf. [Release mit Browserberichten und Softwareinventar](https://github.com/DZunke/Falkenwarte/releases/tag/v0.2.0) · [GitHub-QA](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788)

Der Hauptbericht enthält **49 protokollierte Abnahmebeobachtungen**. Hinzu kommen zwei Produktionsprüfungen für A19 und fünf getrennte A17-Berichte über den Plugin-Imagewechsel. Er nennt die Image-ID `sha256:43bb9391eb18a4b6ea06aa3d4293d499eb0ce80915517e5826df6efdce7465d5` und die Fixtureversion `falkenwarte.qa.scenario-catalog.v1`. Die Abnahme griff auf die gestartete Anwendung, SQLite, Worker und Mercure zu. Die Produktionsprüfung startete dasselbe Image zweimal und las das zuvor angelegte Ticket nach dem Neustart erneut.

Der Implementierungs-PR bestand die fachliche Abnahme. Vor der Veröffentlichung folgten die Korrektur des Image-Exports, die Behandlung konkurrierender T3-Beobachtungen im Testagenten und die Synchronisierung des OAuth-Callbacks. [Implementierungs-PR](https://github.com/DZunke/Falkenwarte/pull/1) · [PR-QA](https://github.com/DZunke/Falkenwarte/actions/runs/44603788249) · [Image- und Reportprüfung](https://github.com/DZunke/Falkenwarte/pull/4) · [Plugin-Callback](https://github.com/DZunke/Falkenwarte/pull/5)

## Meilensteine

| Meilenstein | Abnahmefälle | Ergebnis | Geprüfter Ablauf |
|---|---|---|---|
| M0 · Grundlage | A03, A23 | Bestanden | DBAL-Architektur, öffentliche Verträge und statisches Handbuch. |
| M1 · Menschlicher Ticketablauf | A01, A04, A06, A07, A08, A14, A21, A24, A28 | Bestanden | Projekt und Board, Ticketabschluss ohne Agent, Konfliktauflösung und Wiederherstellung mit historischen Zusatzfeldern. |
| M2 · Intake und MCP | A02, A13, A22, A25, A26, A27, A33 | Bestanden | Technische Eingänge, Rückfragen, ungültige oder überholte Decisions-Antworten und gleichzeitige Entscheidungsgründe. |
| M3 · T3 und Übergaben | A05, A09, A10, A11, A12, A29, A30 | Bestanden | Echter MCP-Client am T3-Testdienst, verlorene Startantwort, frühe Ergebnismeldung und neue OAuth-Sitzung. |
| M4 · Workflows und Kennzahlen | A12, A16, A27, A33 | Bestanden | E23–E25 prüfen bedingte Übergänge, getrennte Rollen, eingefrorene Berichte, das Reparaturlimit und den anschließenden menschlichen Ticketabschluss. |
| M5 · Plugins und Wissen | A17, A18, A23, A32 | Bestanden | Die Linknotizen durchliefen Aktivierung und Stilllegung. Das Handbuch war im Browser erreichbar. |
| M6 · Betrieb und Veröffentlichung | A15, A19, A20, A21, A31 | Bestanden mit vertagter Fork-Prüfung | Produktionsstart und Neustart ohne externe Zugänge, private Live-Updates und externe Inventur nach Restore. |

## M5 · Plugin-Abnahme über zwei Images

Die fünf A17-Chromium-Berichte stammen aus dem `acceptance`-Artefakt desselben [GitHub-QA-Laufs](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788). Die QA-Phasen `plans`, `prepare` und `readback` verwenden gemeinsam das QA-Image `sha256:aca433680e750044d6dbe82b51a4a5e4084fe96e37bc44105156ac89bb62fab9`. Beide Produktionsphasen verwenden das Hauptimage `sha256:43bb9391eb18a4b6ea06aa3d4293d499eb0ce80915517e5826df6efdce7465d5`. Alle fünf Berichte belegen Commit `00d260efdb361deaa14fb75c76fa44a71e5965ba` und Fixtureversion `falkenwarte.qa.scenario-catalog.v1`.

| Phase | Bericht | Image | Beobachteter Browserablauf |
|---|---|---|---|
| QA · Plan und JSON-Export | `plugin-upgrade-plans.json` | `sha256:aca433680e750044d6dbe82b51a4a5e4084fe96e37bc44105156ac89bb62fab9` | Der Browser erstellte Installations- und Entfernungspläne und lud beide als JSON herunter. Der Export entsprach jeweils GET /plugin-install-plans/{plan_id}; ein Legacy-Installationsaufruf ohne operation blieb Installation. Ein aktives Linknotizen-Plugin erhielt HTTP 409 (plugin_state_conflict); nach Deaktivierung wechselte der QA-Pluginstatus zu uninstall_pending und nach Zurücknahme zu installed_disabled. |
| QA · Entfernungsplan vorbereiten | `plugin-upgrade-prepare.json` | `sha256:aca433680e750044d6dbe82b51a4a5e4084fe96e37bc44105156ac89bb62fab9` | Der Browser erstellte den Entfernungsplan 01a1f5f2-d3a1-7410-aa71-fdef2dd34967. Der Pluginstatus ist uninstall_pending; die nicht leere Einstellung retention_marker wurde über die öffentliche Konfigurations-API gespeichert. |
| Produktion · erster Imagewechsel | `plugin-upgrade-verify.json` | `sha256:43bb9391eb18a4b6ea06aa3d4293d499eb0ce80915517e5826df6efdce7465d5` | Nach dem Wechsel zeigte GET /plugins/falkenwarte.qa-bridge-dependent den Zustand removed und configuration_retained=true. Der Plan 01a1f5f2-d3a1-7410-aa71-fdef2dd34967 ist completed; die Pluginrevision enthält den Übergang uninstall_pending → removed und GET /events lieferte den korrelierten Änderungshinweis. Die Oberfläche zeigte die erhaltene Konfiguration und den abgeschlossenen Plan. |
| QA · Daten und Historie erneut lesen | `plugin-upgrade-readback.json` | `sha256:aca433680e750044d6dbe82b51a4a5e4084fe96e37bc44105156ac89bb62fab9` | Das QA-Image las retention_marker über GET /plugins/falkenwarte.qa-bridge-dependent/config mit dem ursprünglichen Wert. Der Pluginstatus blieb removed und der Plan blieb completed. |
| Produktion · zweiter Imagewechsel | `plugin-upgrade-verify-after-readback.json` | `sha256:43bb9391eb18a4b6ea06aa3d4293d499eb0ce80915517e5826df6efdce7465d5` | Nach dem Wechsel zeigte GET /plugins/falkenwarte.qa-bridge-dependent den Zustand removed und configuration_retained=true. Der Plan 01a1f5f2-d3a1-7410-aa71-fdef2dd34967 ist completed; die Pluginrevision enthält den Übergang uninstall_pending → removed und GET /events lieferte den korrelierten Änderungshinweis. Die Oberfläche zeigte die erhaltene Konfiguration und den abgeschlossenen Plan. |

Die [Anforderungszuordnung](TRACEABILITY.md) nennt für alle 36 Anforderungen die betroffenen Dateien, die Dokumentation und die Abnahmefälle. Die [Abnahmekriterien](ACCEPTANCE.md) beschreiben die erwarteten Ergebnisse.

## Reproduzierbarkeit des Release-Images

Zwei unabhängige GitHub-Runner bauten v0.2.0 aus Commit `00d260efdb361deaa14fb75c76fa44a71e5965ba` mit derselben Image-ID `sha256:43bb9391eb18a4b6ea06aa3d4293d499eb0ce80915517e5826df6efdce7465d5` und denselben 43 RootFS-Layern. Die SHA-256-Werte für SBOM, Laufzeitinventar und Lizenzhinweise stimmen überein. [Erster Build](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788/job/135927121539) · [Zweiter Build](https://github.com/DZunke/Falkenwarte/actions/runs/44628085255/job/135927134654)

Ein isolierter lokaler Build derselben Release-Revision ergab dieselbe kanonische Config-ID wie beide GitHub-Runner. Chromium bestand auf diesem Image 42 Haupttests mit 49 protokollierten Beobachtungen, die beiden Produktionsprüfungen und die fünf Plugin-Imagewechsel-Prüfungen. Die lokale Docker-Engine führte dieses Image unter `sha256:dc6d4809072cae5bb29aacc00eeab77631dbfe895f84099c06f2cede94cd2045`.

## Ausgeführte Prüfungen

| Prüfung | Befehl und Ergebnis |
|---|---|
| Statische QA | `php scripts/check-contracts.php`, `php scripts/check-architecture.php`, `php bin/console lint:container`, PHPStan, PHP CS Fixer sowie API-Codegenerierung, Frontend-Lint und Build bestanden. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788/job/135927121442) |
| Hintergrundarbeit | `vendor/bin/phpunit -c phpunit.dist.xml` prüfte mit einem unterbrochenen Messenger-Worker die erneute Zustellung. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788/job/135927121330) |
| Handbuch | `php scripts/check-docs.php` und `php scripts/build-docs.php` bestanden. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788/job/135927121568) |
| Image | Der Linux-Build lieferte das Image, sein CycloneDX-Inventar und die Lizenzhinweise. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788/job/135927121539) |
| Chromium | `bash scripts/ci-e2e.sh` prüfte Produktionsstart und Neustart sowie die öffentliche Browser-, JSON- und MCP-Oberfläche. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788/job/135928429905) |
| Branchregel | Der erforderliche GitHub-Check `quality-gate` bestätigte alle sechs vorgelagerten Jobs. [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44628082788/job/135934151101) |

## Externe Dienste und Fork-Prüfung

Die T3-Abnahme verwendete einen zustandsbehafteten HTTP-MCP-Testdienst. Der Decisions-Testdienst beantwortete HTTP-Anfragen am Adapterrand. Für eine private T3-Instanz und ein echtes OpenAI-Konto liegt kein Live-Nachweis vor. Die Einrichtung beschreiben das [Betriebshandbuch](OPERATIONS.md), die [T3-Anbindung](T3_INTEGRATION.md) und der [Decisions-Leitfaden](AI_DECISIONS.md).

Die Prüfung eines Pull Requests aus einem fremden Fork wurde auf Wunsch des Eigentümers vertagt.

Normaler PR, Dokumentations-PR, Release-PR, absichtlich fehlschlagender und übersprungener E2E-Job sowie die Veröffentlichung sind in [A31](TRACEABILITY.md) verknüpft. Das veröffentlichte Image kann per Digest bezogen werden. [Image-Manifest](https://github.com/DZunke/Falkenwarte/releases/download/v0.2.0/image-manifest.json)

`ghcr.io/dzunke/falkenwarte@sha256:7f6be8a339f26e0e948a318cdda9f3d983440df63a4f10669d608bf41a118cb0`

## Release v0.2.1 · Reparatur der abgeschnittenen Tabs

GitHub prüfte Commit `e9be3da563d598550b13e6ad576ea0417e40c79b` für v0.2.1. Die 36 Konzeptanforderungen und 33 Abnahmefälle bleiben vollständig zugeordnet. Das Release-Image ist `sha256:f881a2e9ee376cf5671f8d659e91161100d02f8292a6e3fb345320639bc8499f`. Der veröffentlichte GHCR-Digest lautet `ghcr.io/dzunke/falkenwarte@sha256:8738f47cca93cfd921ab6172e3e1880595a1242169be4ffcfafcc1be9fec2c6d`. [Release](https://github.com/DZunke/Falkenwarte/releases/tag/v0.2.1) · [Hauptlauf](https://github.com/DZunke/Falkenwarte/actions/runs/44646408471)

Der Browserlauf bestand 42 Playwright-Tests und protokollierte 49 Abnahmebeobachtungen. Zwei A19-Berichte belegen Produktionsstart und Neustart. Fünf A17-Berichte belegen den Plugin-Imagewechsel.

Der Zeigerfehler ist im bestehenden A17-Lifecycle-Test behoben. Dieser Test klickt den letzten `Linknotizen`-Tab mit der Maus bei 1440×960 und 390×844, prüft die Tab-Geometrie und bestätigt das sichtbare Panel. [Gehosteter A17-E2E-Job](https://github.com/DZunke/Falkenwarte/actions/runs/44646408471/job/135991084621) · [Test im geprüften Commit](https://github.com/DZunke/Falkenwarte/blob/e9be3da563d598550b13e6ad576ea0417e40c79b/tests/e2e/tests/plugins-lifecycle.spec.mjs)

| Browseransicht | Beleg | Beobachtung |
|---|---|---|
| Desktop · 1440×1000 | [A17-E2E-Job](https://github.com/DZunke/Falkenwarte/actions/runs/44646408471/job/135991084621) · [Browserabnahme-Archiv](https://github.com/DZunke/Falkenwarte/releases/download/v0.2.1/browser-acceptance.tar.gz) | geklickt und ausgewählt bei 1440×1000 px |
| Mobil · 390×844 | [A17-E2E-Job](https://github.com/DZunke/Falkenwarte/actions/runs/44646408471/job/135991084621) · [Browserabnahme-Archiv](https://github.com/DZunke/Falkenwarte/releases/download/v0.2.1/browser-acceptance.tar.gz) | Das horizontale Mausrad bewegte den Tab. Er wurde bei 390 px angeklickt und ausgewählt. |

Der Tag `v0.2.1` zeigt auf den getesteten Git-Commit `e9be3da563d598550b13e6ad576ea0417e40c79b`. Das OCI-Revision-Label enthält dieselbe SHA. Der Digest der Registry-Manifestbytes `sha256:8738f47cca93cfd921ab6172e3e1880595a1242169be4ffcfafcc1be9fec2c6d` stimmt mit dem Image-Digest im [Release-Manifest](https://github.com/DZunke/Falkenwarte/releases/download/v0.2.1/image-manifest.json) überein. Der Linux/amd64-Config-Digest ist `sha256:f881a2e9ee376cf5671f8d659e91161100d02f8292a6e3fb345320639bc8499f`. Der öffentliche GHCR-RepoDigest stimmt mit derselben Referenz `ghcr.io/dzunke/falkenwarte@sha256:8738f47cca93cfd921ab6172e3e1880595a1242169be4ffcfafcc1be9fec2c6d` überein. Die lokale Docker-Engine-ID `sha256:8738f47cca93cfd921ab6172e3e1880595a1242169be4ffcfafcc1be9fec2c6d` entspricht dem Manifest-Digest und unterscheidet sich vom Config-Digest.

### Meilensteine v0.2.1

| Meilenstein | A-Fälle | Ergebnis | Geprüfter Ablauf |
|---|---|---|---|
| M0 · Grundlage | A03, A23 | Bestanden | DBAL-Architektur, öffentliche Verträge und statisches Handbuch. |
| M1 · Menschlicher Ticketablauf | A01, A04, A06, A07, A08, A14, A21, A24, A28 | Bestanden | Projekt und Board, Ticketabschluss ohne Agent, Konfliktauflösung und Wiederherstellung mit historischen Zusatzfeldern. |
| M2 · Intake und MCP | A02, A13, A22, A25, A26, A27, A33 | Bestanden | Technische Eingänge, Rückfragen, ungültige oder überholte Decisions-Antworten und gleichzeitige Entscheidungsgründe. |
| M3 · T3 und Übergaben | A05, A09, A10, A11, A12, A29, A30 | Bestanden | Echter MCP-Client am T3-Testdienst, verlorene Startantwort, frühe Ergebnismeldung und neue OAuth-Sitzung. |
| M4 · Workflows und Kennzahlen | A12, A16, A27, A33 | Bestanden | E23–E25 prüfen bedingte Übergänge, getrennte Rollen, eingefrorene Berichte, das Reparaturlimit und den anschließenden menschlichen Ticketabschluss. |
| M5 · Plugins und Wissen | A17, A18, A23, A32 | Bestanden | Die Linknotizen durchliefen Aktivierung und Stilllegung. Das Handbuch war im Browser erreichbar. |
| M6 · Betrieb und Veröffentlichung | A15, A19, A20, A21, A31 | Bestanden mit vertagter Fork-Prüfung | Produktionsstart und Neustart ohne externe Zugänge, private Live-Updates und externe Inventur nach Restore. |

Die QA-Phasen des Plugin-Upgrades verwenden gemeinsam `sha256:02bacfd23b44ce0d01f0d81a5e430e0fc66bf947cbfad26f01e2d33d44fc2d2b`. Beide Produktionsphasen verwenden das Hauptimage `sha256:f881a2e9ee376cf5671f8d659e91161100d02f8292a6e3fb345320639bc8499f`. Die fünf Berichte stammen aus dem `acceptance`-Artefakt des [Hauptlaufs](https://github.com/DZunke/Falkenwarte/actions/runs/44646408471).

| Phase | Bericht | Image | Beobachteter Browserablauf |
|---|---|---|---|
| QA · Plan und JSON-Export | `plugin-upgrade-plans.json` | `sha256:02bacfd23b44ce0d01f0d81a5e430e0fc66bf947cbfad26f01e2d33d44fc2d2b` | Der Browser erstellte Installations- und Entfernungspläne und lud beide als JSON herunter. Der Export entsprach jeweils GET /plugin-install-plans/{plan_id}. Ein Legacy-Installationsaufruf ohne operation blieb Installation. Ein aktives Linknotizen-Plugin erhielt HTTP 409 (plugin_state_conflict). Nach Deaktivierung wechselte der QA-Pluginstatus zu uninstall_pending und nach Zurücknahme zu installed_disabled. |
| QA · Entfernungsplan vorbereiten | `plugin-upgrade-prepare.json` | `sha256:02bacfd23b44ce0d01f0d81a5e430e0fc66bf947cbfad26f01e2d33d44fc2d2b` | Der Browser erstellte den Entfernungsplan 01a1f667-d936-7456-810c-aa98867fa4a6. Der Pluginstatus ist uninstall_pending. Die nicht leere Einstellung retention_marker wurde über die öffentliche Konfigurations-API gespeichert. |
| Produktion · erster Imagewechsel | `plugin-upgrade-verify.json` | `sha256:f881a2e9ee376cf5671f8d659e91161100d02f8292a6e3fb345320639bc8499f` | Nach dem Wechsel zeigte GET /plugins/falkenwarte.qa-bridge-dependent den Zustand removed und configuration_retained=true. Der Plan 01a1f667-d936-7456-810c-aa98867fa4a6 ist completed. Die Pluginrevision enthält den Übergang uninstall_pending → removed und GET /events lieferte den korrelierten Änderungshinweis. Die Oberfläche zeigte die erhaltene Konfiguration und den abgeschlossenen Plan. |
| QA · Daten und Historie erneut lesen | `plugin-upgrade-readback.json` | `sha256:02bacfd23b44ce0d01f0d81a5e430e0fc66bf947cbfad26f01e2d33d44fc2d2b` | Das QA-Image las retention_marker über GET /plugins/falkenwarte.qa-bridge-dependent/config mit dem ursprünglichen Wert. Der Pluginstatus blieb removed und der Plan blieb completed. |
| Produktion · zweiter Imagewechsel | `plugin-upgrade-verify-after-readback.json` | `sha256:f881a2e9ee376cf5671f8d659e91161100d02f8292a6e3fb345320639bc8499f` | Nach dem Wechsel zeigte GET /plugins/falkenwarte.qa-bridge-dependent den Zustand removed und configuration_retained=true. Der Plan 01a1f667-d936-7456-810c-aa98867fa4a6 ist completed. Die Pluginrevision enthält den Übergang uninstall_pending → removed und GET /events lieferte den korrelierten Änderungshinweis. Die Oberfläche zeigte die erhaltene Konfiguration und den abgeschlossenen Plan. |

### Reproduzierbarkeit und Herkunft

Zwei unabhängige Runner bauten denselben Commit mit Image-ID `sha256:f881a2e9ee376cf5671f8d659e91161100d02f8292a6e3fb345320639bc8499f` und 43 RootFS-Layern. Die Inventarhashes stimmen überein: `THIRD-PARTY-NOTICES.txt` `368789036121759b9e8dad7f6922900dc6aad752ad27fbff6c741d31f178475c`, `runtime-evidence.json` `63f927a7ae503c9d2d2c1f9627a4f64feaacbc5ac8f2d435d249542aca764f58`, `sbom.cdx.json` `ae2f8fb341b3163b8fe16d4ec03e412f53e7236364f06e00f94611c9ba07bd2e`. [Runner 1](https://github.com/DZunke/Falkenwarte/actions/runs/44646408471/job/135990004299) · [Runner 2](https://github.com/DZunke/Falkenwarte/actions/runs/44646442059/job/135990120375)

Ein isolierter lokaler Build ergab dieselbe kanonische Config-ID. Sein Docker-Engine-Image war `sha256:a25254371dcd0aadb53de878112215c0a47165ebe480ef4ed4427af32283bc3e`. Der Tag `v0.2.1` zeigt auf den getesteten Git-Commit `e9be3da563d598550b13e6ad576ea0417e40c79b`. Das OCI-Revision-Label enthält dieselbe SHA. Der Digest der Registry-Manifestbytes `sha256:8738f47cca93cfd921ab6172e3e1880595a1242169be4ffcfafcc1be9fec2c6d` stimmt mit dem Image-Digest im [Release-Manifest](https://github.com/DZunke/Falkenwarte/releases/download/v0.2.1/image-manifest.json) überein. Der Linux/amd64-Config-Digest ist `sha256:f881a2e9ee376cf5671f8d659e91161100d02f8292a6e3fb345320639bc8499f`. Der öffentliche GHCR-RepoDigest stimmt mit derselben Referenz `ghcr.io/dzunke/falkenwarte@sha256:8738f47cca93cfd921ab6172e3e1880595a1242169be4ffcfafcc1be9fec2c6d` überein. Die lokale Docker-Engine-ID `sha256:8738f47cca93cfd921ab6172e3e1880595a1242169be4ffcfafcc1be9fec2c6d` entspricht dem Manifest-Digest und unterscheidet sich vom Config-Digest.

### A31 · Auslieferungsprüfungen

| Prüfung | Ergebnis | Quelle |
|---|---|---|
| Normaler PR | Bestanden · success | [normal_pr](https://github.com/DZunke/Falkenwarte/actions/runs/44640533860) |
| Dokumentations-PR | Bestanden · success | [docs_quality](https://github.com/DZunke/Falkenwarte/actions/runs/44606393813/job/135851115578) |
| Release-PR | Bestanden · success | [release_pr](https://github.com/DZunke/Falkenwarte/actions/runs/44644282593) |
| Native Release-PR-Prüfung | `success` | [quality-gate](https://github.com/DZunke/Falkenwarte/actions/runs/44644281468) |
| Absichtlich fehlschlagender E2E-Job | Erwarteter Fehler · workflow failure, quality-gate failure, E2E failure | [fail_probe](https://github.com/DZunke/Falkenwarte/actions/runs/44606342740) |
| Übersprungener E2E-Job | Erwarteter Fehler · workflow failure, quality-gate failure, E2E skipped | [skip_probe](https://github.com/DZunke/Falkenwarte/actions/runs/44606360382) |
| Veröffentlichung | Bestanden · success | [release](https://github.com/DZunke/Falkenwarte/releases/tag/v0.2.1) |
| Fork-Prüfung | Auf ausdrückliche Nutzerentscheidung vertagt | — |

Die Prüfung echter privater T3- und OpenAI-Verbindungen bleibt mangels aktiver Zugangsdaten offen. Mock- und Vertragsläufe gelten dafür nicht als Live-Nachweis. Die Prüfung eines Pull Requests aus einem fremden Fork bleibt auf ausdrückliche Nutzerentscheidung vertagt.
