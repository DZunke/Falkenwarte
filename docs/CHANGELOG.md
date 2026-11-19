# Konzeptänderungen 2.0

Stand: 19. November 2026. Diese Liste beschreibt Konzeptänderungen, keine bereits ausgelieferte Anwendungsversion. Die Release-Please-Versionsführung beginnt erst im Implementierungsrepository.

| Bereich | Verbindliche Änderung |
|---|---|
| Name | Falkenwarte in Produkt, Dateien, Verträgen und Mockups |
| Betrieb | Linux; Windows-/WSL-Betriebsvarianten entfernt |
| Tests | Produktabdeckung ausschließlich E2E; Ausnahme nur Background-Funktionstests |
| Testverkehr | Zustandsbehafteter T3-MCP-Mock, echter eingehender Agent-MCP-Verkehr und Decisions-HTTP-Mock |
| Fixtures | Deterministische Fach-/Protokoll-/Fehlerszenarien mit getrennten Zuständen |
| Intake | Nicht manuelle Eingänge benötigen OpenAI-Decisions-Klassifikation |
| Labels | Name, Farbe, Beschreibung, stabile Identität und topic/workflow/attention-Semantik |
| Aufmerksamkeit | Persistente menschliche Gründe mit abgeleiteten Labels; Agent-Rückfragen separat |
| Links | Benannte Collections für Quellen, PR/MR und Referenzen; keine externen Connectoren |
| T3-Ziele | T3 besitzt Provider/Modelle; Falkenwarte referenziert vorhandene Ziele |
| Scope | Kein Code-, Repository-, Merge-, Remote-CI- oder unabhängiger Testprüfzugriff |
| Entwicklung | GitHub-QA, Conventional Commits, Release Please und kontrollierter Release-Commit |
| Dokumentation | Lesbarer Bereich mit ADRs, Context Map, Bounded Contexts, Invarianten und Lebenszyklen |
| UI | Unbelegte Budget-, Modell-, Code-, Worktree- und Testnachweisanzeigen entfernt |

Das Hauptkonzept, GOAL, Verträge, Abnahme und Mockups werden gemeinsam auf diesen Stand gebracht. Die vorherige Fassung bleibt außerhalb dieses Pakets als Gesprächsartefakt erhalten.
