---
name: falkenwarte-frontend
description: Ändere einen Bedienablauf im React-Frontend von Falkenwarte. Nutze den Skill für Board, Ticket-Sheet, Ablauf-Tab, Live-Aktualisierung und mobile Bedienung.
---

# Am Falkenwarte-Frontend arbeiten

## Von der sichtbaren Ansicht zum Code

Öffne ein Ticket auf dem Board und verfolge seine Hashroute. `#/project/{projectId}/board?task={taskId}` führt über die App zum Projektboard. Das Board öffnet das Ticket-Sheet. Dort sind die Tabs und ihre Datenabfragen angebunden. Der Tab **Ablauf** übergibt die Darstellung von Phasen, Berichten und Übergaben an `TaskFlow`. [App](../../../frontend/src/App.tsx) · [Projektboard](../../../frontend/src/components/ProjectBoard.tsx) · [Ticket-Sheet](../../../frontend/src/components/TaskSheet.tsx) · [Ablaufansicht](../../../frontend/src/components/TaskFlow.tsx)

## Daten lesen und aktualisieren

Verwende den typisierten API-Client und die vorhandenen Query-Schlüssel. Invalidiere nach einer Mutation die betroffenen Ticket- oder Boardabfragen. Mercure sendet Hinweise auf Änderungen. Der Live-Hook lädt den maßgeblichen Stand auch nach dem Wiederverbinden erneut. Für einen geänderten öffentlichen Vertrag führt der [Feature-Skill](../falkenwarte-feature/SKILL.md) durch die Typgenerierung. [Abfragen](../../../frontend/src/lib/queries.ts) · [Live-Hinweise](../../../frontend/src/lib/use-live.ts)

Zeige die leere Phase oder Vorgangsliste erst nach einer erfolgreichen Abfrage. Gib beim Laden und im Fehlerfall den jeweiligen Zustand aus. Für den angezeigten Fortschritt zählen bestätigte Kriterien und gespeicherte Übergänge. Mögliche Folgephasen sind im Readmodel gesondert ausgewiesen.

## Im Browser prüfen

Teste den betroffenen Tab auch bei schmalem Viewport. Kann man ihn per Tastatur erreichen, einen langen Bericht aufklappen und die Aktion noch bedienen? Das Ticket-Sheet lässt die Tableiste auf schmalen Bildschirmen horizontal scrollen. A01/A21 prüft mobile Breite und 200 Prozent Grundschrift. Für Übergaben und wiederholte Phasenbesuche gibt es einen eigenen Browserfall. [Mobiler Ticketablauf](../../../tests/e2e/tests/browser-workflow.spec.mjs) · [Übergaben im Review](../../../tests/e2e/tests/workflow-handoff.spec.mjs) · [QA-Skill](../falkenwarte-qa/SKILL.md)

Öffne den Workfloweditor mit drei benannten Phasen und einem Rückweg. Prüfe ihn mit sichtbarer Hauptnavigation auch bei 1588 und 1024 Pixeln Fensterbreite. Wähle eine Phase und danach den Rückweg aus. Kontrolliere die Beschriftungen, den sichtbaren Fokus und die anklickbare Fläche jedes Auswahlfelds im Eigenschaftenbereich. Zwei Felder können einander überdecken, obwohl die Seite selbst keinen horizontalen Scrollbalken hat. Wiederhole die Auswahl bei 390 Pixeln Breite. Prüfe bei einem verzweigten Ablauf auch, ob beide Wege zur erwarteten Phase führen. [Browsertest für Diagramm und Eigenschaften](../../../tests/e2e/tests/workflow-graph-layout.spec.mjs)
