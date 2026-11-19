# Tatsächliche Prüfergebnisse

Stand dieser Aufzeichnung: 19. November 2026. Die lokalen Änderungen liegen im gemeinsamen Linux-Arbeitsverzeichnis und sind noch nicht in einem Commit; lokale Beobachtungen sind deshalb nicht als Abnahme eines festen Images gewertet.

## Statische Prüfungen

| Befehl | Ergebnis | Aussage |
|---|---|---|
| `php scripts/check-contracts.php` | Bestanden: OpenAPI 3.1 mit 151 Operationen, 35 MCP-Zuordnungen, 7 Vertragsbeispielen und 36 Anforderungen | Referenzen, MCP-Zuordnungen und Vertragsbeispiele sind im aktuellen Arbeitsstand konsistent. |
| `php scripts/check-architecture.php` | Bestanden | Die Bounded-Contexts besitzen Domain-Layer; direkte DBAL-, ORM- und Application-zu-Infrastructure-Verstöße wurden nicht gemeldet. |
| `php bin/console lint:container --env=prod` und `php bin/console lint:container --env=test` | Beide bestanden | Produktiver und Testcontainer lösen die Services mit kompatiblen Typen auf. |
| `php scripts/check-docs.php` | Bestanden | Dokumentationsverweise lösen auf und Prosaabsätze stehen jeweils auf einer Quellzeile. |
| `php scripts/build-docs.php` | Bestanden: 39 Markdown-Dokumente indexiert | Der lokale Dokumentationsindex, die Inhalte, Verträge und HTML-Seiten wurden erzeugt. Die Browserprüfung ist separat dokumentiert. |
| PHPStan Level 5 für AgentCatalog, RunHandler und die T3-Adapter | Bestanden: keine Fehler in den analysierten Pfaden; ein vollständiger Repository-Lauf steht noch aus | Die neue Context-Grenze und ihre DI-Adapter sind lokal typgeprüft. |

## Lokale Browserläufe

Der Dokumentationsbereich wurde in Chromium gegen eine lokal gestartete App geprüft. Der Test `npx playwright test tests/handbook.spec.mjs` lief aus `tests/e2e`; A23 und A32 bestanden. Das Protokoll liegt unter `var/dev-qa/handbook4.log`. Der Lauf belegt lokale Navigation und Darstellung, nicht einen gehosteten Build.

Der direkte M2-Lauf gegen die lokalen App-, T3-Mock- und Decisions-Mock-Prozesse lief am 19. November 2026 um 17:51 UTC mit Chromium und Fixturekatalog `falkenwarte.qa.scenario-catalog.v1`:

```bash
cd tests/e2e
FALKENWARTE_BASE_URL=http://127.0.0.1:18770 FALKENWARTE_SETUP_TOKEN=test-setup-token-ONLY-for-isolated-qa npm test -- --grep 'A02|A13|A22|A24|A25|A26|A27|A28|A33'
```

Playwright meldete 7/7 Tests bestanden. Die beobachteten Abnahme-IDs waren A02, A13, A22, A24, A25, A26, A27, A28 und A33; A27 ist ausdrücklich `partial` und bleibt offen, weil der gleichzeitige Handlungsbedarf aus `approval_pending` und `routing_ambiguous` noch nicht gemeinsam nachgewiesen ist. Das Reportobjekt nennt `commit: null` und `image: null`; der Lauf ist lokale Entwicklerevidenz, keine hosted Abnahme.

`qa/results.json` ist ein ignorierter Debugreport und wird bei jedem gezielten Lauf überschrieben. Er ist kein kumulatives Abnahmeverzeichnis. Nur ein abgeschlossenes, erfolgreiches und redigiertes CI-Artefakt unter `var/ci-evidence/acceptance.json` kann release-feste Ergebnisse in die Traceability übernehmen.

## Hosted-Prüfung

Der letzte verfügbare Lauf für [WIP-PR #1](https://github.com/DZunke/Falkenwarte/pull/1), Head `c4cfa7d1abe9d1908f7caf910748911d9f5936d6`, ist [Workflow 44575682493](https://github.com/DZunke/Falkenwarte/actions/runs/44575682493) und endete fehlgeschlagen. `static-quality` stoppte bei `check-architecture`, weil diesem damaligen PR-Head noch Domain-Verzeichnisse in Classification, AgentCatalog, Orchestration, Automation und Extensions fehlten; diese Struktur ist im aktuellen lokalen Arbeitsstand inzwischen vorhanden.

Der hosted E2E-Job startete keinen Playwright-Fall: Der Appcontainer wurde im Compose-Testnetz als `unhealthy` gemeldet, bevor der Runner startete. Das nachfolgende Artefakt-Upload fand keine Datei unter `var/ci-evidence/`; der Lauf liefert daher keine Akzeptanzfälle. `docs-quality`, `background-functional`, `commit-policy` und der Image-Build bestanden, `quality-gate` scheiterte wegen der fehlgeschlagenen Pflichtjobs.

## Meilensteine und offene Integrationen

Kein Meilenstein ist vollständig abgenommen. M0 bleibt offen, bis A03 und A23 an einem festen, erfolgreichen QA-Artefakt belegt sind; die lokale Architekturprüfung sowie die lokalen Browserfälle ersetzen diesen Beleg nicht. M1 bis M5 bleiben offen, bis alle jeweils verpflichtenden Akzeptanzfälle in der vollständigen Suite durchlaufen sind. A27 bleibt trotz erfolgreichem Playwright-Teststatus fachlich `partial`.

Die M6-Forkprüfung ist auf ausdrückliche Nutzerentscheidung vertagt und bleibt unverifiziert. Weiter erforderlich sind ein regulärer PR-Lauf mit wirksamer Branchregel, der exakte SHA-Dispatch des Release-PRs, die deliberate-fail- und deliberate-skip-Proben sowie der Releasepfad bis zum geprüften Image-Tag; siehe [GitHub-Auslieferung](GITHUB_DELIVERY.md).

Die automatisierte Abnahme verwendet T3- und Decisions-Mocks an den tatsächlichen Netzwerkgrenzen. Es gibt keinen Nachweis mit aktiver privater T3-Instanz oder echtem OpenAI-Zugang; erfolgreiche Mockläufe belegen diese Verbindungen nicht.

Der offizielle Symfony-AI-PR #2956 war am 19. November 2026 offen und nicht gemergt. Das veröffentlichte Paket `symfony/ai-open-ai-platform v1.0.0-BETA1` enthält keinen nativen Decisions-Client. Falkenwarte verwendet deshalb eine schmale Implementierung über Symfony AIs `PlatformInterface`; dieser Paket-/PR-Befund ist kein echter OpenAI-Aufrufnachweis.
