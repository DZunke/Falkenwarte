---
name: falkenwarte-handbook
description: Aktualisiere das Falkenwarte-Handbuch zusammen mit einer Änderung an Bedienung, Fachmodell, API oder Betrieb. Nutze diesen Skill auch für Abschnittslinks und die Vorschau im statischen und eingebetteten Leser.
---

# Das Falkenwarte-Handbuch pflegen

Beschreibe das heute beobachtbare Verhalten. Prüfe dafür die Bedienhandlung, die zuständige Fachregel oder den veröffentlichten Vertrag. Ändere die Anleitung im selben Branch wie die Implementierung. So kann jemand den neuen Ablauf schon beim Review ausprobieren. [Dokumentationsleitfaden](../../../docs/DOCUMENTATION.md)

| Was möchte jemand wissen? | Wohin gehört die Antwort? |
| --- | --- |
| Wie bediene ich die Funktion? | In die passende Anleitung unter [Benutzerhandbuch](../../../docs/USER_GUIDE.md), mit den Bezeichnungen aus der Oberfläche. |
| Was bedeutet ein Begriff, wer entscheidet, wann wechselt der Zustand? | Ins [Glossar](../../../docs/domain/GLOSSARY.md), in die [Context Map](../../../docs/domain/CONTEXT_MAP.md) oder zum [Lebenszyklus](../../../docs/domain/LIFECYCLES.md). |
| Wie integriere oder betreibe ich das System? | Zu [API und MCP](../../../docs/API.md) oder in das [Betriebshandbuch](../../../docs/OPERATIONS.md). |
| Warum wurde eine langfristige Architekturentscheidung getroffen? | In ein [ADR mit Indexeintrag](../../../docs/DECISIONS.md). |

Verlinke eine neue Seite am Einstieg ihrer Leser. Schreibe jeden Prosaabsatz auf eine Quellzeile. Speichere persönliche Entwürfe unter `.notes/` und einmalige lokale Prüfergebnisse unter `var/ci-evidence/`. Reproduzierbare Fälle gehören nach `qa/acceptance/`, ausgewählte historische Release-Belege nach `qa/evidence/`. [QA-Übersicht](../../../qa/README.md)

Für die ursprüngliche M0–M6-Abnahme ist `.notes/falkenwarte-concept/` die vereinbarte Grundlage. Prüfe dabei jeden Meilenstein gegen das betreffende Ziel und seine Abnahmekriterien. Dieser lokale Snapshot kann in einem frischen Checkout fehlen. Das aktuelle Handbuch lässt sich vollständig aus Code, Verträgen und Tests pflegen. [Archiv der historischen Grundlagen](../../../qa/evidence/README.md)

## Eine Änderung gleich lesen

`make docs` prüft lokale Linkziele und Absatzformatierung und erzeugt `public/docs/`. Mit `make docs-serve` öffnest du die Vorschau unter `http://127.0.0.1:8081/docs/`. Dafür genügen die lokalen Composer-Abhängigkeiten. Handbuchänderungen können unabhängig von Release, T3 und OpenAI geprüft werden.

Bei Änderungen an Navigation oder Ankern prüfe denselben Link auch im eingebetteten Leser unter `/#/docs/README.md`. Beide Ansichten nutzen denselben Build, scrollen aber in unterschiedlichen Layouts. Der vorhandene Chromium-Fall folgt einem Link zu einem anderen Kapitel und prüft bei 390 Pixeln die sichtbare Zielüberschrift und seitlich bedienbare Tabellen. [Handbuch-Browsertest](../../../tests/e2e/tests/handbook.spec.mjs)
