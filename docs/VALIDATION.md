# Tatsächliche Prüfergebnisse

Stand dieser Aufzeichnung: 19. November 2026. Die folgenden Ergebnisse stammen aus dem lokalen Linux-Arbeitsverzeichnis; Änderungen liegen noch nicht in einem Commit.

## Statische Prüfungen

| Befehl | Ergebnis | Aussage |
|---|---|---|
| `php scripts/check-contracts.php` | Bestanden: OpenAPI 3.1 mit 149 Operationen, 35 MCP-Zuordnungen, 7 Vertragsbeispielen und 36 Anforderungen | Die geprüften Verträge, Referenzen und Beispielpayloads sind statisch konsistent. |
| `php scripts/build-traceability.php` | Bestanden: 36 Anforderungen erzeugt, 0 Abnahmen mit Commit-, Image- und Fixturebeleg | Die vier lokalen Browserbeobachtungen unten haben noch keinen unveränderlichen Commit- und Imagebezug und werden deshalb nicht als release-feste Abnahme gezählt. |
| `php scripts/build-docs.php` | Bestanden: 36 Markdown-Dokumente indexiert und `/docs`-Assets gebaut | Der lokale Dokumentationsbuild wurde ausgeführt; Browsernavigation und Darstellung sind damit noch nicht abgenommen. |
| `php scripts/check-architecture.php` | Offen: Domain-Verzeichnisse fehlen in Classification, AgentCatalog, Orchestration, Automation und Extensions | A03 ist wegen unvollständiger Bounded-Context-Struktur nicht bestanden. Die Prüfung meldet derzeit keine direkten DBAL-, ORM- oder Application-zu-Infrastructure-Verstöße. |
| `php scripts/check-docs.php` | Offen: `docs/README.md` verlinkt auf das noch fehlende `docs/OPERATIONS.md` | Die Dokumentations-Linkprüfung ist erst nach Übergabe des Betriebsdokuments vollständig. |

## Lokaler Browserlauf

Der direkte Befehl `FALKENWARTE_BASE_URL=http://127.0.0.1:18770 npm --prefix tests/e2e test -- --grep 'A22 A24 A25 A28'` lief am 19. November 2026 gegen lokal gestartete Falkenwarte-, Decisions- und T3-Prozesse. Der Test nutzte Chromium und den Fixturekatalog `falkenwarte.qa.scenario-catalog.v1`; er lief nicht über `compose.test.yaml`.

| Abnahme | Ergebnis | Beobachtetes Verhalten |
|---|---|---|
| A22 | Bestanden, lokaler Lauf | MCP legte ein Ticket und Intake an; zwei Requests erreichten den Decisions-Mock mit dem konfigurierten Modell und nativen Fragen; die Pflichtangabe wurde angefragt und beantwortet; dasselbe Ticket blieb erhalten. |
| A24 | Bestanden, lokaler Lauf | Ein `javascript:`-Link wurde am MCP-Schema abgelehnt; ein HTTPS-Link mit eingebetteten Zugangsdaten wurde fachlich verworfen, ohne gespeicherte Links zu ändern. |
| A25 | Bestanden, lokaler Lauf | Der Melder beantwortete die fehlende Pflichtangabe über MCP und setzte dasselbe Ticket fort. |
| A28 | Bestanden, lokaler Lauf | Link-Collections wurden über MCP gelesen; unzulässige Links veränderten den gespeicherten Bestand nicht. |

Alle vier Fälle stammen aus demselben zusammenhängenden Playwright-Test. Der Reporter vermerkt für diesen Lauf `commit: null`, `image: null` und einen nicht sauberen Arbeitsbaum; die Beobachtungen belegen deshalb nur den lokalen Ablauf, nicht eine Abnahme eines fixierten Builds. Der vollständige Reporterbericht liegt in `qa/results.json`.

## Meilensteine und Grenzen des Nachweises

Kein Meilenstein ist vollständig abgenommen. M0 bleibt offen, weil A03 nicht bestanden ist und A23 keinen Laufbeleg hat. Die vier lokalen erfolgreichen Fälle decken Teile von M1 und M2 ab, erfüllen aber die Gates nicht; alle übrigen geplanten Fälle bleiben ungeprüft. Der vollständige Sollumfang und die verbleibenden Fall-IDs stehen in [ACCEPTANCE.md](ACCEPTANCE.md) und [TRACEABILITY.md](TRACEABILITY.md).

Der isolierte Compose-Lauf aus `scripts/ci-e2e.sh` und die produktive T3-/OpenAI-Verbindung wurden noch nicht ausgeführt. Die Decisions-Mockverbindung ist kein Nachweis für einen echten API-Schlüssel oder Providerzugang; ein lokaler T3-Mock ist kein Nachweis für einen Handshake mit einer aktiven T3-Instanz.

Der offizielle Symfony-AI-PR #2956 war am 19. November 2026 offen und nicht gemergt. Das veröffentlichte Paket `symfony/ai-open-ai-platform v1.0.0-BETA1` enthält keinen nativen Decisions-Client. Falkenwarte verwendet deshalb eine schmale Implementierung über Symfony AIs `PlatformInterface`; der Paket-/PR-Befund belegt keinen echten OpenAI-Aufruf.
