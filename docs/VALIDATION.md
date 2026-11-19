# Tatsächliche Prüfergebnisse

Stand dieser Aufzeichnung: 19. November 2026. Die lokalen und gehosteten Nachweise sind jeweils an den ausgewiesenen Commit und, wo verfügbar, das konkrete Image gebunden; erfolgreich abgeschlossene Einzeljobs ersetzen keine vollständige Workflow- oder Meilensteinabnahme.

## Statische Prüfungen

| Befehl | Ergebnis | Aussage |
|---|---|---|
| `php scripts/check-contracts.php`, `php scripts/check-architecture.php` und `php bin/console lint:container` | Bestanden im hosted `static-quality`-Job für Commit `86392687ed1f828075c1039ad2e8f20d8abe02b8` ([Lauf](https://github.com/DZunke/Falkenwarte/actions/runs/44588112948), [Job](https://github.com/DZunke/Falkenwarte/actions/runs/44588112948/job/135786468996)) | OpenAPI-/MCP-Verweise, Context-Grenzen und Servicecontainer waren in diesem Commit konsistent; der Gesamtworkflow scheiterte später im E2E-Job. |
| `vendor/bin/phpstan analyse --no-progress --memory-limit=1G` | Bestanden im selben hosted `static-quality`-Job ([Job](https://github.com/DZunke/Falkenwarte/actions/runs/44588112948/job/135786468996)) | Der vollständige Repositorylauf erreichte PHPStan Level 5 auf dem genannten Commit. |
| `vendor/bin/php-cs-fixer check --diff` und Frontend-Codegenerierung, Lint und Build | Bestanden im selben hosted `static-quality`-Job ([Job](https://github.com/DZunke/Falkenwarte/actions/runs/44588112948/job/135786468996)) | Die generierte API-Datei entsprach in diesem Commit dem OpenAPI-Vertrag und das Frontend ließ sich typprüfen und bauen. |
| `php scripts/check-docs.php`, `php scripts/build-docs.php` und `test -s public/docs/index.html` | Bestanden im hosted `docs-quality`-Job ([Job](https://github.com/DZunke/Falkenwarte/actions/runs/44588112948/job/135786468387)) | Der statische Dokumentationsbuild erzeugte das Handbuch unabhängig vom React-Build. |
| Linux-Release-Image bauen | Bestanden im hosted `build`-Job ([Job](https://github.com/DZunke/Falkenwarte/actions/runs/44588112948/job/135786468763)) | Das Image wurde erzeugt; der Gesamtworkflow scheiterte später bei sechs E2E-Fällen. |

## Lokale Browserläufe

Der Dokumentationsbereich wurde in Chromium gegen eine lokal gestartete App geprüft. Der Test `npx playwright test tests/handbook.spec.mjs` lief aus `tests/e2e`; A23 und A32 bestanden. Das Protokoll liegt unter `var/dev-qa/handbook4.log`. Der Lauf belegt lokale Navigation und Darstellung, nicht einen gehosteten Build.

Der direkte M2-Lauf gegen die lokalen App-, T3-Mock- und Decisions-Mock-Prozesse lief am 19. November 2026 um 17:51 UTC mit Chromium und Fixturekatalog `falkenwarte.qa.scenario-catalog.v1`:

```bash
cd tests/e2e
FALKENWARTE_BASE_URL=http://127.0.0.1:18770 FALKENWARTE_SETUP_TOKEN=test-setup-token-ONLY-for-isolated-qa npm test -- --grep 'A02|A13|A22|A24|A25|A26|A27|A28|A33'
```

Playwright meldete 7/7 Tests bestanden. Die beobachteten Abnahme-IDs waren A02, A13, A22, A24, A25, A26, A27, A28 und A33; Der damalige Test deckte für A27 den einzelnen Routinggrund ab. Das Reportobjekt nennt `commit: null` und `image: null`; der Lauf ist lokale Entwicklerevidenz, keine hosted Abnahme.

Ein späterer isolierter Compose-Checkpoint prüfte A12 am 19. November 2026 mit Chromium: 1/1 Fall bestanden, falscher Attempt mit `isError:true` abgewiesen, wiederholter Report mit neuer Idempotency-ID ohne zweiten Report oder Evidence-Eintrag. Die lokale Datei `qa/results/a12-checkpoint5/acceptance-evidence.json` nennt Commit `f2fface8839e27685c448c59da3434f363b0e44f` und Image `sha256:64c0088dab99c79261f1e326d208ec06498bdc7c98ca2d11168f7f821a980f5f`; `qa/results/` ist ignoriert, daher ist dieser einzelne Lauf keine gehostete oder vollständige Suiteabnahme.

Ein weiterer isolierter Compose-Checkpoint prüfte A16 am 19. November 2026 mit Chromium: 1/1 Fall bestanden. API und UI zeigten zwei abgeschlossene Episoden mit 84 Stunden medianer Lead-Time, 60 Stunden medianer Cycle-Time und 24 Stunden Blockadezeit; Anbieterabrechnung blieb mit `null`-Werten ausdrücklich unbekannt. Der öffentliche Rebuild endete mit einer erfolgreichen Action ohne Run- oder Ticketnebenwirkung und ohne T3-Launch. `qa/results/a16-checkpoint7-final2/acceptance-evidence.json` nennt Commit `86392687ed1f828075c1039ad2e8f20d8abe02b8` und Image `sha256:51111d10c794e5d1105490b6bb1915d3831a7e15b3c0def989bbcc0e5e42dc50`; dies ist lokaler Einzelfallnachweis, keine gehostete oder vollständige Suiteabnahme.

Der gespeicherte Chromium-Test `tests/e2e/tests/plugin-install-plans.spec.mjs` lief am 19. November 2026 in einer isolierten Compose-QA-App mit Produktions-Frontend-Image: 1/1 Playwright-Test bestanden. Der Browser erstellte Installations- und Entfernungspläne, exportierte beide über „JSON exportieren“ und verglich den Download mit der jeweiligen GET-Ressource; ein alter Installationsaufruf ohne `operation` blieb Installation. Ein aktives Linknotizen-Plugin erhielt HTTP 409 (`plugin_state_conflict`), und ein zurückgenommener Entfernungsplan stellte `installed_disabled` wieder her. Der redigierte A17-Bericht liegt unter `var/ci-evidence/plugin-image-upgrade-local-plugin-upgrade-1751480/plugin-upgrade-plans.json` und nennt Quellrevision `9565bec82f9501876e030bdc4befffaea8e0cd26` sowie das QA-Image `sha256:eee87ab33defe474eed7063cf0e06c08469505cff6d68cd61f0a459df8fc86b1`.

Der isolierte Imagewechsel-Lauf `bash scripts/ci-plugin-image-upgrade.sh` bestand mit fünf Chromium-Berichten. Eine QA-Variante aus dem Produktionsimage enthielt nur das QA-Pluginfixture; nach dem Entfernungsplan startete der exakt geprüfte Produktionsimage-Digest ohne Testmanifest. Die Maintenance persistierte `removed`, den abgeschlossenen Plan samt Zeitstempel, die Pluginrevision und den öffentlichen Event-Catch-up-Eintrag. Ein Neustart der QA-Variante las den zuvor gespeicherten Konfigurationswert über die öffentliche Konfigurations-API zurück; ein anschließender Wechsel zurück auf denselben Produktionsimage-Digest zeigte weiterhin den abgeschlossenen Plan und die vollständige Historie. Der Lauf nutzte keine aktive T3- oder OpenAI-Verbindung und belegt nur lokales Verhalten im dirty worktree, keine hosted oder Release-Abnahme.

Die fünf redigierten Berichte liegen in `var/ci-evidence/plugin-image-upgrade-local-plugin-upgrade-1751480/`; alle nennen Quellrevision `9565bec82f9501876e030bdc4befffaea8e0cd26` und einen bestandenen A17-Fall mit Beobachtung. Das QA-Image ist `sha256:eee87ab33defe474eed7063cf0e06c08469505cff6d68cd61f0a459df8fc86b1`; beide Produktionsphasen verwenden exakt `sha256:48de525166ef3b02e78de1240a74e435a0a246b0cb987d15790c75f3846558a3`. Die Berichte `plugin-upgrade-verify.json` und `plugin-upgrade-verify-after-readback.json` wurden gegen denselben unveränderten Produktimage-Digest ausgeführt.

`qa/results.json` ist ein ignorierter Debugreport und wird bei jedem gezielten Lauf überschrieben. Er ist kein kumulatives Abnahmeverzeichnis. Die Traceability übernimmt nur einen abgeschlossenen, erfolgreichen und redigierten Hauptlauf, dessen SHA und Image mit dem abgeschlossenen GitHub-Workflow übereinstimmen; A03 und A05 benötigen zusätzlich die erfolgreichen Jobs `static-quality` und `background-functional`, A19 beide erfolgreichen Produktionsberichte für Start und Neustart.

[`scripts/prepare-traceability-evidence.php`](../scripts/prepare-traceability-evidence.php) prüft Workflowjobs, Hauptartefakt und Produktionsberichte und schreibt `var/ci-evidence/verification.json`. Erst danach aktualisieren `scripts/build-traceability.php` und `scripts/build-docs.php` den Bericht und das statische Handbuch. Der Bericht enthält anklickbare GitHub-Quellen; lokale oder partielle Fälle bleiben offen.

## Hosted-Prüfung

[Workflow 44583451885](https://github.com/DZunke/Falkenwarte/actions/runs/44583451885) für Commit `f2fface8839e27685c448c59da3434f363b0e44f` endete fehlgeschlagen: `static-quality` scheiterte bei PHPStan und der Imagebuild scheiterte; `docs-quality`, `background-functional` und `commit-policy` bestanden, der E2E-Job wurde übersprungen.

[Workflow 44586596073](https://github.com/DZunke/Falkenwarte/actions/runs/44586596073) für Commit `b06bfc3aa060039582baf60414618105565c424a` bestand PHPStan, Vertrags-/Architektur-/Containerprüfungen, Dokumentation und Imagebuild, scheiterte aber an der Frontend-Codegenerierungsprüfung und am E2E-Test des bereitgestellten Images; der Gesamtworkflow endete fehlgeschlagen.

Der neuere [Workflow 44588112948](https://github.com/DZunke/Falkenwarte/actions/runs/44588112948) für Commit `86392687ed1f828075c1039ad2e8f20d8abe02b8` ist abgeschlossen und fehlgeschlagen. `commit-policy`, `static-quality`, `background-functional`, `docs-quality` und `build` bestanden; sechs E2E-Fälle scheiterten im bereitgestellten Image, darunter A17, A18 und A20. Das redigierte Acceptance-Artefakt wurde hochgeladen, zählt wegen des fehlgeschlagenen Gesamtworkflows aber nicht als hosted Abnahme.

## Meilensteine und offene Integrationen

Kein Meilenstein ist vollständig abgenommen. M0 bleibt offen, bis A03 und A23 an einem festen, erfolgreichen QA-Artefakt belegt sind; die lokale Architekturprüfung sowie die lokalen Browserfälle ersetzen diesen Beleg nicht. M1 bis M5 bleiben offen, bis alle jeweils verpflichtenden Akzeptanzfälle in der vollständigen Suite durchlaufen sind. Ein isolierter Chromium-Lauf für A27 hat inzwischen beide gleichzeitig offenen Gründe, die unabhängigen Auflösungen, eine ungültig gewordene Freigabe und die neue Entscheidung am aktuellen Lauf geprüft. Der Dashboardzähler verlief dabei von eins über null und eins wieder auf null.

Die M6-Forkprüfung ist auf ausdrückliche Nutzerentscheidung vertagt und bleibt als Ausnahme sichtbar; sie wird nicht als bestanden ausgegeben und blockiert die übrigen M6-Abnahmen nicht. Weiter erforderlich sind ein regulärer PR-Lauf mit wirksamer Branchregel, der exakte SHA-Dispatch des Release-PRs, die deliberate-fail- und deliberate-skip-Proben sowie der Releasepfad bis zum geprüften Image-Tag; siehe [GitHub-Auslieferung](GITHUB_DELIVERY.md).

Die automatisierte Abnahme verwendet T3- und Decisions-Mocks an den tatsächlichen Netzwerkgrenzen. Es gibt keinen Nachweis mit aktiver privater T3-Instanz oder echtem OpenAI-Zugang; erfolgreiche Mockläufe belegen diese Verbindungen nicht.

Der offizielle Symfony-AI-PR #2956 war am 19. November 2026 offen und nicht gemergt. Das veröffentlichte Paket `symfony/ai-open-ai-platform v1.0.0-BETA1` enthält keinen nativen Decisions-Client. Falkenwarte verwendet deshalb eine schmale Implementierung über Symfony AIs `PlatformInterface`; dieser Paket-/PR-Befund ist kein echter OpenAI-Aufrufnachweis.
