## Anlass und Ergebnis

Welches konkrete Problem besteht, und welches Verhalten entsteht durch diese Änderung?

## Fachlicher Umfang

Betroffene Bounded Contexts, öffentliche Commands/Events und Abnahme-IDs nennen. Bei reinen Text-/Darstellungsänderungen genügt eine kurze Einordnung.

## Nachweis

Ausgeführte E2E-Szenarien mit tatsächlichen Ergebnissen verlinken. Statische QA getrennt nennen. Falls Background-Funktionstests betroffen sind, den geprüften Job-/Workerablauf angeben. Nicht ausgeführte Nachweise ausdrücklich als offen markieren.

## Dokumentationsabgleich

Aktualisierte Context Map, Objektlebenszyklen, Event-/API-/MCP-Verträge und ADRs verlinken, soweit fachlich betroffen. Falls keine Änderung nötig ist, kurz begründen. Ersetzte ADRs behalten ihre Geschichte und verweisen auf den Nachfolger.

## Auslieferung

Relevante Migrationen, Konfiguration, Kompatibilität und Wiederanlauf nach einem Fehler beschreiben. Bei fehlenden Auswirkungen genügt ein Satz. Der Conventional-Commit-PR-Titel muss zum späteren Squash-Commit passen.
