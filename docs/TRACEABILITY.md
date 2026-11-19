# Anforderungs- und Abnahmenachweis

Dieser Bericht ordnet jede Konzeptanforderung dem Umsetzungspfad, der Dokumentation und den Abnahmefällen zu. Ein vorhandener Codepfad zeigt den Implementierungsort; erst ein passender Laufbeleg bestätigt beobachtetes Verhalten.

Die Traceability zählt Hosted-Abnahmen nur nach Prüfung des abgeschlossenen QA-Workflows, des unveränderlichen Commits und des gebauten Images. A03 und A05 stammen aus den erfolgreichen `static-quality`- und `background-functional`-Jobs desselben vollständigen QA-Laufs. A19 braucht beide Produktionsberichte für Start und Neustart mit exakt demselben Commit, Image und Fixturestand wie der Hauptlauf.

Die GitHub-Quellen werden als Markdown-Links in diese Tabelle geschrieben und beim statischen Handbuchbau in HTML-Links übernommen. Entwicklerreport `qa/results.json`, fehlgeschlagene oder partielle Fälle und lokale Laufbelege werden nicht als Hosted-Abnahme ausgegeben.

Ein reproduzierbarer Lauf liest den Workflowdatensatz direkt aus GitHub und die Berichte des dazugehörigen Artefakts:

```sh
gh run view "$RUN_ID" --repo DZunke/Falkenwarte --json databaseId,headSha,status,conclusion,url,jobs > var/ci-evidence/workflow.json
php scripts/prepare-traceability-evidence.php \
  --run=var/ci-evidence/workflow.json \
  --acceptance=var/ci-evidence/acceptance.json \
  --production-boot=var/ci-evidence/production-0.json \
  --production-restart=var/ci-evidence/production-1.json \
  --a31=var/ci-evidence/a31.json
php scripts/build-traceability.php
php scripts/build-docs.php
```

Der optionale A31-Eingang verwendet `falkenwarte.github-delivery-evidence.v1` und enthält die Quell-URLs sowie die getrennten Ergebnisse für normalen PR, Dokumentationsjob, Release-Please-PR, absichtlichen Fehler, absichtliches Überspringen und Release. Normaler PR und Release-Please-PR müssen `conclusion=success` und `quality_gate_conclusion=success` ausweisen; der Release-Please-PR muss zusätzlich `head_sha`, `dispatch_expected_sha` und `checked_out_sha` identisch ausweisen. Jede Fehler- und Skip-Probe enthält `head_sha`, `workflow_conclusion=failure`, `quality_gate_conclusion=failure` und das erwartete `e2e_conclusion` (`failure` beziehungsweise `skipped`). Probe-Hashes und PR-Hashes bleiben untereinander eigenständig. Beim veröffentlichten Release müssen Tag-Commit, getesteter Commit und Image-Revision übereinstimmen. Die Fork-Prüfung bleibt auf ausdrückliche Nutzerentscheidung zurückgestellt und wird getrennt ausgewiesen.

Die sichtbare Ausnahme für eine noch nicht getestete reale T3-/OpenAI-Verbindung bedeutet nicht, dass ein Konzept-Gate fehlschlägt, wenn dessen festgelegte Vertrags- und Netzwerk-Mock-Abnahmen erfolgreich sind. Es wird kein echter Anbieterzugriff aus Mockverkehr abgeleitet.

## Verifizierte Laufbelege

<!-- generated evidence start -->

| Beleg | Status | Commit | Image oder Digest | Fixture | Quelle |
|---|---|---|---|---|---|
| Hauptlauf | Nicht belegt | `—` | `—` | — | — |
| A03 · static-quality | Nicht belegt | `—` | `—` | — | — |
| A05 · background-functional | Nicht belegt | `—` | `—` | — | — |
| A19 · Produktionsstart und Neustart | Nicht belegt | `—` | `—` | — | — |
| A31 · Normaler PR | Nicht belegt | `—` | `—` | — | — |
| A31 · Dokumentationsjob | Nicht belegt | `—` | `—` | — | — |
| A31 · Release-Please-PR | Nicht belegt | `—` | `—` | — | — |
| A31 · Fehlerprobe | Nicht belegt | `—` | `—` | — | — |
| A31 · Skip-Probe | Nicht belegt | `—` | `—` | — | — |
| A31 · Veröffentlichung | Nicht belegt | `—` | `—` | — | — |
| M6 · Fork-Prüfung | Zurückgestellt | — | — | — | Ausdrückliche Nutzerentscheidung |

<!-- generated evidence end -->

<!-- generated requirements start -->

| ID | Anforderung | Umsetzung | Dokumentation | Abnahme und Laufquellen | Nachweisstatus |
|---|---|---|---|---|---|
| R01 | Projekttrennung mit Name, Icon und Farbe | `src/Portfolio` · `frontend/src` | [PRODUCT_CONCEPT.md](PRODUCT_CONCEPT.md) · [USER_GUIDE.md](USER_GUIDE.md) | [A01](ACCEPTANCE.md#a01---projektidentitat-und-archivierung), [A02](ACCEPTANCE.md#a02---projektgrenzen-uber-ui-json-und-mcp) | Abnahmen offen |
| R02 | Agentrollen und robustes T3-Ping-Pong ohne Modellverwaltung | `src/AgentCatalog` · `src/Orchestration` | [T3_INTEGRATION.md](T3_INTEGRATION.md) · [USER_GUIDE.md](USER_GUIDE.md) | [A09](ACCEPTANCE.md#a09---t3-adapter-mit-echtem-http-verkehr), [A10](ACCEPTANCE.md#a10---launch-angenommen-antwort-verloren), [A11](ACCEPTANCE.md#a11---neue-autorisierung-bei-ungeklartem-auftrag), [A12](ACCEPTANCE.md#a12---agentbericht-menschliche-annahme-und-phasenabschluss), [A29](ACCEPTANCE.md#a29---t3-verwaltet-provider-und-ausfuhrungsdetails) | Abnahmen offen |
| R03 | Lokale Single-User-Anwendung mit getrennten technischen Principals | `src/Access` · `src/Portfolio` · `config` | [PRODUCT_CONCEPT.md](PRODUCT_CONCEPT.md) · [OPERATIONS.md](OPERATIONS.md) | [A02](ACCEPTANCE.md#a02---projektgrenzen-uber-ui-json-und-mcp), [A19](ACCEPTANCE.md#a19---produktionsbetrieb-auf-linux) | Abnahmen offen |
| R04 | DDD und Clean Architecture | `src/Portfolio/Domain` · `src/WorkManagement/Domain` · `src/Access/Domain` · `src/Metrics/Domain` · `src/Classification/Domain` · `src/AgentCatalog/Domain` · `src/Orchestration/Domain` · `src/Automation/Domain` · `src/Extensions/Domain` · `scripts/check-architecture.php` · `composer.json` | [domain/BOUNDED_CONTEXTS.md](domain/BOUNDED_CONTEXTS.md) · [domain/CONTEXT_MAP.md](domain/CONTEXT_MAP.md) · [adr/0001.md](adr/0001.md) | [A03](ACCEPTANCE.md#a03---architektur-und-orm-abwesenheit), [A32](ACCEPTANCE.md#a32---dokumentation-folgt-einer-fachanderung) | Abnahmen offen |
| R05 | Domain und Action Event Driven | `src/Shared` · `migrations` | [domain/EVENTS.md](domain/EVENTS.md) · [domain/LIFECYCLES.md](domain/LIFECYCLES.md) | [A04](ACCEPTANCE.md#a04---eine-anderung-mit-vollstandiger-historie), [A05](ACCEPTANCE.md#a05---angenommene-hintergrundarbeit-uberlebt-unterbrechung), [A13](ACCEPTANCE.md#a13---gemeinsame-regeln-fur-json-und-mcp) | Abnahmen offen |
| R06 | Domain Object History Tracking | `src/Shared` · `migrations` | [domain/EVENTS.md](domain/EVENTS.md) | [A04](ACCEPTANCE.md#a04---eine-anderung-mit-vollstandiger-historie), [A06](ACCEPTANCE.md#a06---objektverlauf-und-wiederherstellung) | Abnahmen offen |
| R07 | Doctrine DBAL und Migrationen ohne Doctrine ORM | `composer.json` · `migrations` | [domain/BOUNDED_CONTEXTS.md](domain/BOUNDED_CONTEXTS.md) · [adr/0002.md](adr/0002.md) | [A03](ACCEPTANCE.md#a03---architektur-und-orm-abwesenheit), [A04](ACCEPTANCE.md#a04---eine-anderung-mit-vollstandiger-historie) | Abnahmen offen |
| R08 | Flexible Boards mit gemeinsamen Tickets und konsistentem WIP | `src/WorkManagement` | [domain/BOUNDED_CONTEXTS.md](domain/BOUNDED_CONTEXTS.md) · [domain/LIFECYCLES.md](domain/LIFECYCLES.md) | [A07](ACCEPTANCE.md#a07---mehrere-boards-mit-denselben-aufgaben), [A08](ACCEPTANCE.md#a08---gleichzeitige-anderungen-und-harte-grenzen), [A14](ACCEPTANCE.md#a14---veraltete-oberflache-und-konflikt) | Abnahmen offen |
| R09 | MCP-Server für Aufgabenarbeit | `src/Access` · `src/WorkManagement` · [contracts/mcp-tools.json](../contracts/mcp-tools.json) | [contracts/README.md](../contracts/README.md) · [AI_DECISIONS.md](AI_DECISIONS.md) | [A02](ACCEPTANCE.md#a02---projektgrenzen-uber-ui-json-und-mcp), [A13](ACCEPTANCE.md#a13---gemeinsame-regeln-fur-json-und-mcp), [A22](ACCEPTANCE.md#a22---pflichtklassifikation-nicht-manueller-eingange), [A25](ACCEPTANCE.md#a25---fehlende-informationen-uber-mcp-zuruckmelden), [A28](ACCEPTANCE.md#a28---link-collections-ohne-fremde-systemanbindung) | Abnahmen offen |
| R10 | MCP-Client zur vorhandenen T3-Instanz | `src/AgentCatalog` · `src/Orchestration` | [T3_INTEGRATION.md](T3_INTEGRATION.md) | [A09](ACCEPTANCE.md#a09---t3-adapter-mit-echtem-http-verkehr), [A10](ACCEPTANCE.md#a10---launch-angenommen-antwort-verloren), [A11](ACCEPTANCE.md#a11---neue-autorisierung-bei-ungeklartem-auftrag) | Abnahmen offen |
| R11 | Projektmetriken mit Definition und Datenherkunft | `src/Metrics` | [PRODUCT_CONCEPT.md](PRODUCT_CONCEPT.md) | [A16](ACCEPTANCE.md#a16---kennzahlen-mit-nachvollziehbarer-herkunft) | Abnahmen offen |
| R12 | Zentrales Dashboard über alle Projekte | `src/Metrics` · `frontend/src` | [USER_GUIDE.md](USER_GUIDE.md) · [PRODUCT_CONCEPT.md](PRODUCT_CONCEPT.md) | [A16](ACCEPTANCE.md#a16---kennzahlen-mit-nachvollziehbarer-herkunft), [A21](ACCEPTANCE.md#a21---menschlich-bedienbare-oberflache), [A27](ACCEPTANCE.md#a27---menschlicher-eingriff-ist-fachlich-erkennbar) | Abnahmen offen |
| R13 | Plugins mit Aktivierung, Drain, Datenbestand und Ablösung | `src/Extensions` | [PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md) | [A17](ACCEPTANCE.md#a17---installiertes-plugin-aktivieren-und-deaktivieren), [A18](ACCEPTANCE.md#a18---plugin-mit-laufender-arbeit-deaktivieren) | Abnahmen offen |
| R14 | Austauschbare externe Implementierungen durch Bridges | `src/Classification` · `src/Orchestration` · `src/Shared` | [domain/CONTEXT_MAP.md](domain/CONTEXT_MAP.md) · [PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md) | [A09](ACCEPTANCE.md#a09---t3-adapter-mit-echtem-http-verkehr), [A17](ACCEPTANCE.md#a17---installiertes-plugin-aktivieren-und-deaktivieren), [A30](ACCEPTANCE.md#a30---e2e-storungen-an-der-tatsachlichen-protokollgrenze) | Abnahmen offen |
| R15 | Vollständige JSON-API und typisierter Client | [contracts/openapi.yaml](../contracts/openapi.yaml) · `frontend/src/generated` | [contracts/README.md](../contracts/README.md) | [A13](ACCEPTANCE.md#a13---gemeinsame-regeln-fur-json-und-mcp), [A14](ACCEPTANCE.md#a14---veraltete-oberflache-und-konflikt), [A21](ACCEPTANCE.md#a21---menschlich-bedienbare-oberflache) | Abnahmen offen |
| R16 | Moderne shadcn-Oberfläche und konkrete scopekonforme Mockups | `frontend/src` · [MOCKUPS.md](MOCKUPS.md) · [media/mockups](media/mockups) | [USER_GUIDE.md](USER_GUIDE.md) · [MOCKUPS.md](MOCKUPS.md) | [A21](ACCEPTANCE.md#a21---menschlich-bedienbare-oberflache), [A23](ACCEPTANCE.md#a23---nachvollziehbare-projektubernahme), [A29](ACCEPTANCE.md#a29---t3-verwaltet-provider-und-ausfuhrungsdetails) | Abnahmen offen |
| R17 | Symfony Framework mit Symfony AI | `composer.json` · `src/Classification/Application/DecisionGateway.php` · `src/Classification/Infrastructure/SymfonyAiDecisionAdapter.php` · `src/Classification/Infrastructure/OpenAiDecisionsPlatform.php` | [AI_DECISIONS.md](AI_DECISIONS.md) · [SOURCES.md](SOURCES.md) | [A22](ACCEPTANCE.md#a22---pflichtklassifikation-nicht-manueller-eingange), [A26](ACCEPTANCE.md#a26---unklare-entscheidung-und-providerfehler), [A30](ACCEPTANCE.md#a30---e2e-storungen-an-der-tatsachlichen-protokollgrenze) | Abnahmen offen |
| R18 | Genau ein produktiver Docker-Appcontainer | `docker/Dockerfile` · `compose.yaml` · `docker/entrypoint.sh` | [OPERATIONS.md](OPERATIONS.md) | [A19](ACCEPTANCE.md#a19---produktionsbetrieb-auf-linux), [A20](ACCEPTANCE.md#a20---neustart-und-restore-mit-externer-arbeit) | Abnahmen offen |
| R19 | FrankenPHP und Mercure für private Live-Änderungshinweise | `src/Live/Infrastructure/Live.php` · `docker/Caddyfile` · `compose.yaml` · `docker/Dockerfile` | [LIVE_SERVICES.md](LIVE_SERVICES.md) | [A15](ACCEPTANCE.md#a15---private-live-aktualisierung-und-wiederverbindung), [A19](ACCEPTANCE.md#a19---produktionsbetrieb-auf-linux) | Abnahmen offen |
| R20 | Vollständiges Konzept und ausführbarer /goal-Umsetzungsauftrag | `README.md` · [PRODUCT_CONCEPT.md](PRODUCT_CONCEPT.md) | `README.md` · [PRODUCT_CONCEPT.md](PRODUCT_CONCEPT.md) | [A23](ACCEPTANCE.md#a23---nachvollziehbare-projektubernahme) | Abnahmen offen |
| R21 | Ausschließliche E2E-Produktabdeckung ohne kleinteilige Tests | `tests/e2e` · [TESTING.md](TESTING.md) | [TESTING.md](TESTING.md) · [ACCEPTANCE.md](ACCEPTANCE.md) | [A21](ACCEPTANCE.md#a21---menschlich-bedienbare-oberflache), [A30](ACCEPTANCE.md#a30---e2e-storungen-an-der-tatsachlichen-protokollgrenze), [A31](ACCEPTANCE.md#a31---github-qa-und-release-please) | Abnahmen offen |
| R22 | MCP-Trafficmocks am echten Netzwerk und Agent-Simulator | `tests/e2e` · `qa` | [TESTING.md](TESTING.md) | [A09](ACCEPTANCE.md#a09---t3-adapter-mit-echtem-http-verkehr), [A10](ACCEPTANCE.md#a10---launch-angenommen-antwort-verloren), [A11](ACCEPTANCE.md#a11---neue-autorisierung-bei-ungeklartem-auftrag), [A25](ACCEPTANCE.md#a25---fehlende-informationen-uber-mcp-zuruckmelden), [A30](ACCEPTANCE.md#a30---e2e-storungen-an-der-tatsachlichen-protokollgrenze) | Abnahmen offen |
| R23 | Deterministische Fixtures und isolierte Testzustände | `qa/fixtures/fixture-seed.json` · `qa/scenarios.json` · `qa/fixtures` · `qa/mocks` · `tests/e2e` · `compose.test.yaml` · `scripts/ci-e2e.sh` | [TESTING.md](TESTING.md) | [A16](ACCEPTANCE.md#a16---kennzahlen-mit-nachvollziehbarer-herkunft), [A22](ACCEPTANCE.md#a22---pflichtklassifikation-nicht-manueller-eingange), [A30](ACCEPTANCE.md#a30---e2e-storungen-an-der-tatsachlichen-protokollgrenze), [A33](ACCEPTANCE.md#a33---uberholte-klassifikationen-und-manuelle-entscheidungen) | Abnahmen offen |
| R24 | GitHub, QA-Pipelines, Conventional Commits und Release Please | `.github` · [GITHUB_DELIVERY.md](GITHUB_DELIVERY.md) | [GITHUB_DELIVERY.md](GITHUB_DELIVERY.md) | [A31](ACCEPTANCE.md#a31---github-qa-und-release-please) | Abnahmen offen |
| R25 | Pflichtklassifikation aller nicht manuellen Ticketeingänge | `src/Classification` | [AI_DECISIONS.md](AI_DECISIONS.md) · [domain/LIFECYCLES.md](domain/LIFECYCLES.md) | [A22](ACCEPTANCE.md#a22---pflichtklassifikation-nicht-manueller-eingange), [A26](ACCEPTANCE.md#a26---unklare-entscheidung-und-providerfehler), [A33](ACCEPTANCE.md#a33---uberholte-klassifikationen-und-manuelle-entscheidungen) | Abnahmen offen |
| R26 | Konfigurierbare Themen- und Workflowlabels mit Name/Farbe/Beschreibung | `src/Classification` · `src/WorkManagement` | [AI_DECISIONS.md](AI_DECISIONS.md) · [domain/GLOSSARY.md](domain/GLOSSARY.md) | [A24](ACCEPTANCE.md#a24---konfigurierbare-kategorien-und-labels), [A33](ACCEPTANCE.md#a33---uberholte-klassifikationen-und-manuelle-entscheidungen) | Abnahmen offen |
| R27 | Strukturierte MCP-Rückfragen ohne erneute Ticketanlage | `src/Classification` · `src/Access` | [AI_DECISIONS.md](AI_DECISIONS.md) · [domain/LIFECYCLES.md](domain/LIFECYCLES.md) | [A25](ACCEPTANCE.md#a25---fehlende-informationen-uber-mcp-zuruckmelden), [A26](ACCEPTANCE.md#a26---unklare-entscheidung-und-providerfehler) | Abnahmen offen |
| R28 | Menschlicher Eingriff an Labels und persistenten Gründen erkennbar | `src/Classification` · `src/WorkManagement` | [domain/LIFECYCLES.md](domain/LIFECYCLES.md) · [AI_DECISIONS.md](AI_DECISIONS.md) | [A27](ACCEPTANCE.md#a27---menschlicher-eingriff-ist-fachlich-erkennbar), [A33](ACCEPTANCE.md#a33---uberholte-klassifikationen-und-manuelle-entscheidungen) | Abnahmen offen |
| R29 | Link-Collections für Quell-Issues, Pull/Merge Requests und Referenzen | `src/WorkManagement` | [PRODUCT_CONCEPT.md](PRODUCT_CONCEPT.md) · [contracts/README.md](../contracts/README.md) | [A28](ACCEPTANCE.md#a28---link-collections-ohne-fremde-systemanbindung) | Abnahmen offen |
| R30 | Keine externen Issue-/Repository-/CI-Connectoren oder Codezugriffe | [PRODUCT_CONCEPT.md](PRODUCT_CONCEPT.md) · [contracts/openapi.yaml](../contracts/openapi.yaml) · `src/WorkManagement/Application/WorkHandler.php` · `scripts/check-architecture.php` | [PRODUCT_CONCEPT.md](PRODUCT_CONCEPT.md) · [USER_GUIDE.md](USER_GUIDE.md) | [A12](ACCEPTANCE.md#a12---agentbericht-menschliche-annahme-und-phasenabschluss), [A21](ACCEPTANCE.md#a21---menschlich-bedienbare-oberflache), [A28](ACCEPTANCE.md#a28---link-collections-ohne-fremde-systemanbindung), [A29](ACCEPTANCE.md#a29---t3-verwaltet-provider-und-ausfuhrungsdetails) | Abnahmen offen |
| R31 | Provider und Modelle werden ausschließlich in T3 verwaltet | `src/AgentCatalog` · `src/Orchestration` | [T3_INTEGRATION.md](T3_INTEGRATION.md) | [A29](ACCEPTANCE.md#a29---t3-verwaltet-provider-und-ausfuhrungsdetails) | Abnahmen offen |
| R32 | Linux als einzige Betriebssystem-Zielplattform | `docker/Dockerfile` · `docker/Caddyfile` · `docker/entrypoint.sh` · `compose.yaml` · [OPERATIONS.md](OPERATIONS.md) | [OPERATIONS.md](OPERATIONS.md) | [A19](ACCEPTANCE.md#a19---produktionsbetrieb-auf-linux), [A20](ACCEPTANCE.md#a20---neustart-und-restore-mit-externer-arbeit) | Abnahmen offen |
| R33 | Nachhaltige Fachdokumentation mit ADRs, Domain Map und Lebenszyklen | [domain](domain) · [adr](adr) · `scripts/build-docs.php` · `scripts/build-traceability.php` · `scripts/check-docs.php` | [DOCUMENTATION.md](DOCUMENTATION.md) · [DECISIONS.md](DECISIONS.md) | [A23](ACCEPTANCE.md#a23---nachvollziehbare-projektubernahme), [A32](ACCEPTANCE.md#a32---dokumentation-folgt-einer-fachanderung) | Abnahmen offen |
| R34 | OpenAI Decisions nativ über Symfony AI und erweiterbare PR-Anbindung | `src/Classification` · `composer.json` | [AI_DECISIONS.md](AI_DECISIONS.md) · [adr/0006.md](adr/0006.md) | [A22](ACCEPTANCE.md#a22---pflichtklassifikation-nicht-manueller-eingange), [A26](ACCEPTANCE.md#a26---unklare-entscheidung-und-providerfehler), [A30](ACCEPTANCE.md#a30---e2e-storungen-an-der-tatsachlichen-protokollgrenze) | Abnahmen offen |
| R35 | Background-Tasks dürfen ergänzende Backend-Funktionstests erhalten | `tests/BackgroundFunctional` · [TESTING.md](TESTING.md) | [TESTING.md](TESTING.md) | [A05](ACCEPTANCE.md#a05---angenommene-hintergrundarbeit-uberlebt-unterbrechung), [A30](ACCEPTANCE.md#a30---e2e-storungen-an-der-tatsachlichen-protokollgrenze) | Abnahmen offen |
| R36 | Private Umgebung und Business-Claude bleiben getrennt | `src/Access` · [OPERATIONS.md](OPERATIONS.md) | [OPERATIONS.md](OPERATIONS.md) | [A02](ACCEPTANCE.md#a02---projektgrenzen-uber-ui-json-und-mcp), [A19](ACCEPTANCE.md#a19---produktionsbetrieb-auf-linux), [A29](ACCEPTANCE.md#a29---t3-verwaltet-provider-und-ausfuhrungsdetails) | Abnahmen offen |

<!-- generated requirements end -->

## Gate-Status

<!-- generated gates start -->

| Meilenstein | Konzept-Gate | Abnahmen mit Laufbeleg | Sichtbare Ausnahme |
|---|---|---|---|
| M0 | A03, A23 | 0/2 Abnahmen mit Laufbeleg | — |
| M1 | A01, A04, A06, A07, A08, A14, A21, A24, A28 | 0/9 Abnahmen mit Laufbeleg | — |
| M2 | A02, A13, A22, A25, A26, A27, A33 | 0/7 Abnahmen mit Laufbeleg | — |
| M3 | A05, A09, A10, A11, A12, A29, A30 | 0/7 Abnahmen mit Laufbeleg | Echte T3-/OpenAI-Verbindung mangels aktiver Konfiguration nicht geprüft; Vertrags-E2E läuft gegen isolierte Netzwerk-Mocks. |
| M4 | A12, A16, A27, A33, Übergabekette und Reparaturlimit | 0/4 Abnahmen mit Laufbeleg, Browserbeleg der vollständigen Kette offen | — |
| M5 | A17, A18, A23, A32 | 0/4 Abnahmen mit Laufbeleg | — |
| M6 | A15, A19, A20, A21, A31 | 0/5 Abnahmen mit Laufbeleg | Fork-Prüfung bleibt auf ausdrückliche Nutzerentscheidung zurückgestellt. |

<!-- generated gates end -->

Der Bericht liest ausschließlich das redigierte `var/ci-evidence/acceptance.json` oder den per `FALKENWARTE_ACCEPTANCE_EVIDENCE` angegebenen Pfad. Die Datei entsteht aus dem abgeschlossenen QA-Workflow; sie muss einen erfolgreichen Gesamtlauf sowie Commit, Image, Fixtureversion und beobachtete Wirkungen enthalten. `qa/results.json` ist ein absichtlich ignorierter Entwicklerreport, wird bei gezielten Läufen überschrieben und zählt nie als hosted Abnahmenachweis. Eine ausstehende externe T3- oder OpenAI-Produktverbindung bleibt offen und wird nicht aus Mockverkehr abgeleitet.
