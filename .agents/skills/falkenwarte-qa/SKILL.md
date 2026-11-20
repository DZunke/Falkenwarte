---
name: falkenwarte-qa
description: Wähle bei einer Änderung an Falkenwarte die passende Prüfung oder diagnostiziere einen fehlgeschlagenen Browserfall. Nutze den Skill für Playwright, QA-Fixtures und die lokale Abnahme ohne T3- oder OpenAI-Konto.
---

# Falkenwarte prüfen

## Den passenden Lauf wählen

Suche den fachlichen Fall in der Szenariokarte und den vorhandenen Playwright-Specs. Für Produktverhalten zählt, was über die gestartete Anwendung im Browser, per JSON-HTTP oder per MCP beobachtbar ist. Für Messenger, Wiederzustellung und andere Hintergrundverarbeitung gibt es eine gezielte funktionale Suite mit echtem Kernel und DBAL. [Szenariokarte](../../../qa/scenarios.json) · [Playwright-Fälle](../../../tests/e2e/tests/) · [Testvertrag](../../../docs/TESTING.md)

| Änderung | Lokale Prüfung |
| --- | --- |
| PHP-Code, Container, Verträge, Frontend oder Handbuch | `make check` schließt PHP-CS-Fixer und Background-Tests ein. Ein einzelnes Ziel wie `make contracts`, `make background` oder `make docs` verkürzt die Iteration. |
| Bedienhandlung oder Verhalten am HTTP-/MCP-Rand | `make e2e` baut das App-Image und prüft es mit Chromium, echten Workern und Mercure. T3 und Decisions laufen als zustandsbehaftete HTTP-Mocks. |
| Installieren, Entfernen oder Migrieren eines ausgelieferten Plugins | `make plugin-upgrade` prüft dieselben Daten über Imagewechsel und Neustarts hinweg. |

## Daten und Diagnose

Lege Geschäftsdaten mit `ownerApi` über die öffentliche Schnittstelle an. Mit `qaMocks` steuerst du externe Antworten und liest die tatsächlich eingegangenen Anfragen. Warte auf den beobachteten Zustand. Für fachliche Fristen gibt es eine steuerbare Geschäftsuhr. [Fixtures](../../../tests/e2e/support/fixtures.mjs) · [Geschäftsuhr](../../../tests/e2e/support/test-clock.mjs)

Die Suite verwendet dieselben Container für mehrere Fälle. Der Host-Harness erneuert pro Fall Datenbank, Prozesse, Owner und Mockjournale. Tests für Beständigkeit und Hub-Reconnect fordern gezielt einen Neustart an. Für eine einzelne Spec auf einem eigenen, vorbereiteten QA-Stack kannst du etwa `npm --prefix tests/e2e test -- tests/handbook.spec.mjs` verwenden. Ein direkter Playwright-Aufruf startet den Stack nicht und erhält den automatischen App-Reset nur mit angebundenem `FALKENWARTE_STACK_CONTROL`. [Fixture-Lebenszyklus](../../../docs/QA_FIXTURES.md)

Bei einem Fehler sichere Assertion, API-Antwort und gegebenenfalls den passenden Mockjournal-Eintrag. Bereinigte Nachweise des vollständigen Laufs liegen unter `var/ci-evidence/`. Vermerke im Ergebnis, welche Provider simuliert wurden. [QA-Nachweise](../../../qa/README.md)

Für eine manuelle Browserabnahme öffne eine eigene Sitzung, beispielsweise mit `agent-browser --session "$qa_session" open "$qa_url"` und einem eigenen Sitzungsnamen. Beende genau diese mit `agent-browser --session "$qa_session" close`. Der Schalter `--all` würde auch Sitzungen anderer Threads schließen.
