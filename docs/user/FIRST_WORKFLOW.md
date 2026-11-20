# Von der Ersteinrichtung zum ersten Workflow mit mehreren Agentrollen

Diese Anleitung baut auf [Von der Einrichtung zur ersten Aufgabe](AGENTS_AND_WORKFLOWS.md) auf und zeigt, wie du mehrere Agentrollen in einem Ablauf verbindest. Das Beispiel führt von einer DDD Discovery über die Programmierung bis zum Review und passt zu jedem Projekt.

Lege zuerst in **Agentrollen** für dein Projekt die benötigten Rollen an oder prüfe vorhandene Rollen auf aktive Projektfreigabe, T3-Verbindung und **Konfiguration bereit**. Jede verwendete Providerinstanz braucht außerdem einen MCP-Zugang zu Falkenwarte, damit ihr Agent Aufgaben lesen und Ergebnisse melden kann. Richte zusätzliche Provider nach deren eigenem MCP-Konfigurationsformat ein und prüfe jeden Zugang mit dem Lesetest aus der Erstanleitung, bevor du die Rolle im Workflow einplanst.

Lade unter **Agents & T3 → Skill herunterladen** den aktuellen Falkenwarte-Skill und installiere ihn im gebundenen Projekt für die verwendeten Provider. Falls dort schon eine ältere Kopie liegt, ersetze deren `SKILL.md`. Die Anleitung erklärt dem Agenten, wie er den Auftrag der eigenen Phase liest, eine Rückfrage an die passende Rolle richtet und den nächsten Agenten über seine Ergebnisse informiert. [Skill im Zielprojekt installieren](AGENT_SKILL.md#im-zielprojekt-installieren)

## 1. Eine Workflowvorlage anlegen

Öffne in der Hauptnavigation **Workflows** und wähle das Projekt, für das du den Ablauf bauen willst. Gib im Abschnitt **Workflowvorlage anlegen** unter **Workflowname** zum Beispiel `DDD Discovery, Programmierung und Review` ein. Eine neue Vorlage enthält bereits eine **Arbeitsphase**, die du direkt ausfüllen kannst.

## 2. Drei Phasen mit je einer Rolle einrichten

Für dieses Beispiel klicke zweimal auf **Phase hinzufügen**, sodass drei Phasen in der gewünschten Reihenfolge stehen. Die erste Phase in der Liste beginnt den Ablauf. Jede neu hinzugefügte Phase startet als **Arbeitsphase**. Wähle für die letzte Phase **Reviewphase**.

Fülle in jeder Phase **Name der Phase N**, **Art der Phase**, **Agentrolle für Phase N** und **Auftrag für diese Phase** aus. Eine Rolle muss für das gewählte Projekt und dieselbe aktive T3-Verbindung freigegeben sein. Die Formulierungen in der Tabelle sind Beispiele, die du an deine Arbeitsweise anpasst.

Du kannst eine Vorlage auch mit noch nicht belegten Rollen speichern und später vervollständigen. Einen Ticketlauf kannst du erst starten, wenn jede Phase eine startbereite Agentrolle hat. Wenn du vor dem Weitergehen selbst entscheiden sollst, aktiviere zusätzlich **Menschliche Freigabe** für diese Phase.

| Reihenfolge | Art der Phase | Name der Phase N | Agentrolle für Phase N | Auftrag für diese Phase |
| --- | --- | --- | --- | --- |
| 1 | Arbeitsphase | DDD Discovery | Domain Analyst | Lies das Projekt, ändere keine Dateien und beschreibe die fachlichen Begriffe, Verantwortungsgrenzen, Regeln und offenen Fragen für diese Aufgabe. |
| 2 | Arbeitsphase | Programmierung | Developer | Setze die freigegebene Discovery für dieses Ticket um, führe passende Prüfungen aus und melde Änderungen sowie Ergebnisse. |
| 3 | Reviewphase | Review | Reviewer | Prüfe die gemeldeten Änderungen und Prüfungen unabhängig. Melde konkrete Findings als Änderungen nötig oder bestätige, dass kein weiterer Änderungsbedarf auffällt. |

Wähle pro Phase unter **Boardspalte bei Phasenstart für Phase N** eine Spalte des aktiven Projektboards oder **Spalte beibehalten**. Für dieses Beispiel kannst du Discovery und Programmierung nach **In Arbeit** und Review nach **Review** verschieben lassen. Die Spaltenwahl ändert den Ticketstatus beim Phasenstart und schließt das Ticket nicht ab.

Wenn du die Reihenfolge ändern willst, verwende **Phase N nach oben verschieben** oder **Phase N nach unten verschieben**. Prüfe danach, dass die gewünschte Startphase an erster Stelle steht und jede Rolle zur Phase passt.

## 3. Übergänge zwischen den Phasen festlegen

Die Reihenfolge entscheidet, welche Phase zuerst startet. Prüfe im Bereich der Übergänge, dass **DDD Discovery** mit dem Ergebnis **Angenommen** über eine **Standardroute** zu **Programmierung** führt und **Programmierung** mit **Angenommen** zu **Review**.

Ergänze für **Review** einen Übergang mit **Ergebnis** **Änderungen nötig** zurück zu **Programmierung**. Ein solcher Rücklauf zählt zur konfigurierten Reparaturgrenze des Workflows.

Ein Übergang pro Phase und Ergebnis ist die **Standardroute**. Optional kannst du über **Gelabelte Alternative hinzufügen** eine weitere Route für dasselbe Ergebnis einrichten und unter **Label für diesen Übergang** ein aktives Themenlabel auswählen. Zum Beispiel kannst du für **Programmierung** das Ergebnis **Blockiert** über das Label `Rückfrage zur Discovery` zu **DDD Discovery** leiten. Der Agent kann diese angebotene Route bei einer Rückfrage im Phasenbericht nennen.

Beim Hinzufügen einer Phase ergänzt Falkenwarte einen Übergang **Angenommen** von der bisherigen letzten Phase, wenn es dort noch keine solche Route gibt. Vorhandene Übergänge werden nicht still umgebogen. Wenn eine Phase nicht erreichbar ist oder ein Ergebnis keine passende Standardroute hat, klicke auf **Übergang hinzufügen**, fülle **Von Phase**, **Ergebnis** und **Zu Phase** aus und prüfe die Route in der Übersicht.

Verwende für einen Themenabzweig ausschließlich ein aktives Themenlabel, das zu deinem Projekt gehört. Eine im Phasenbericht ausdrücklich gewählte Route hat Vorrang vor Ticketlabels, auch wenn der Agent die **Standardroute** ausdrücklich wählt. Wenn der Bericht keine Route nennt, wählt Falkenwarte einen eindeutigen passenden Themenabzweig aus den aktiven Ticketlabels. Gibt es keinen passenden Labelabzweig, greift die **Standardroute**, sofern sie für das Ergebnis vorhanden ist.

Ein Themenabzweig wählt das nächste Ziel und fordert für sich allein keine menschliche Freigabe an. Führt er in eine bereits besuchte frühere Phase, zählt dieser Rücksprung zur Reparaturgrenze, unabhängig davon, ob der Übergang gelabelt oder eine Standardroute ist.

Hat ein Ticket mehrere passende Themenlabels mit verschiedenen Zielen, pausiert der Ablauf zur Klärung. Das gilt auch, wenn es für ein Ergebnis nur gelabelte Alternativen gibt und weder Bericht noch Ticketlabel eine davon bestimmen. Öffne dann **Ablauf**, lies den Pausegrund und prüfe die angebotenen Routen im letzten Phasenbericht.

## 4. Optionale Phasenfreigaben und Überarbeitungsrunden festlegen

Aktiviere **Menschliche Freigabe** für eine Phase, wenn du ihren Bericht prüfen möchtest, bevor der Ablauf weitergeht. Für das Beispiel kannst du die Freigabe bei **DDD Discovery** einschalten, damit du die fachliche Einordnung vor der Programmierung abnimmst. Ohne diesen Haken kann die nächste Phase nach erfolgreichem Abschluss automatisch starten.

Bei einer Phase mit Freigabepflicht fordert der Phasenlauf weiterhin eine Entscheidung an. Öffne dafür im Ticket **Ausführung**, wähle den Phasenlauf, lies den Bericht und klicke auf **Freigabe anfordern**. Entscheide die offene Freigabe anschließend unter **Entscheidungen**. Bereits gespeicherte Eingangsbedingungen bleiben sichtbar und erhalten, lassen sich im Editor aber nicht als freie Ausdrücke neu formulieren.

Lege unter **Automatische Überarbeitungsrunden** einen Wert von `0` bis `20` fest. Jedes Ergebnis **Änderungen nötig** und jeder Rücksprung in eine bereits besuchte frühere Phase zählt, auch über eine Standardroute. Bis zum Limit kann Falkenwarte solche Runden automatisch fortsetzen. Bei `0` wartet die erste Runde auf deine Entscheidung. Am Limit prüfst du den letzten Bericht und kannst eine einzelne zusätzliche Runde mit Hinweis freigeben oder den Workflow abbrechen.

## 5. Vorlage speichern und Version prüfen

Klicke auf **Workflow anlegen**. In **Workflows und laufende Instanzen** siehst du den Namen, die aktive Version und die Phasen. Die Vorlage startet damit keinen Agenten.

Wenn du später Änderungen vornehmen willst, öffne **Workflow bearbeiten** und speichere sie mit **Workflowversion speichern**. Das erzeugt eine neue Version. Bereits gestartete Abläufe behalten ihre gespeicherte Version auch beim Pausieren und Fortsetzen. Neue Starts verwenden die aktuelle Version.

## 6. Eine Vorlage als Boardstandard auswählen

Öffne im Projekt die Boardansicht, für die die Vorlage gelten soll, und klicke auf **Workflowstandard**. Wähle im Dialog **Boardworkflow festlegen** unter **Standardworkflow** deine Vorlage und klicke auf **Einstellungen speichern**.

Optional kannst du unter **Label für manuelle Tickets** ein aktives Themenlabel wie `Manuell` auswählen. Tickets mit diesem Label starten als manuelle Boardarbeit ohne den Boardworkflow. Entferne das Label oder ändere den Boardstandard, wenn du den Boardworkflow für das Ticket nutzen willst.

Die Boardvorgabe wählt einen Workflow für den späteren Start vor. Speichern oder Zuordnen startet keinen Lauf. Jede Aufgabe bleibt manuell, bis du in ihrem Ticket auf **Workflow starten** klickst. Die Auswahl wird pro Board gespeichert.

## 7. Ein Ticket für den ersten Ablauf vorbereiten

Öffne das Projektboard und wähle **Neues Ticket** oder ein vorhandenes Ticket mit einer klaren Aufgabe und prüfbaren Erfolgskriterien. Setze das Ticket auf **Bereit**, wenn es noch im **Backlog** steht.

Wenn das Board eine Standardvorlage hat, siehst du sie im Ticket als Vorauswahl, sofern kein konfiguriertes Ausschlusslabel gesetzt ist. Prüfe die gewählte Vorlage, bevor du startest.

## 8. Den Workflow starten

Öffne das Ticket und danach **Ausführung**. Prüfe im Abschnitt **Workflow starten** das Feld **Workflow** und wähle deine Vorlage, falls sie nicht bereits vorausgewählt ist. Kontrolliere die angezeigte Phasenzahl und Version und klicke einmal auf **Workflow starten**.

Unter **Ausführungen** siehst du den neuen Ablauf. **Start wird übertragen** zeigt den Versand an T3, danach sollte **Läuft in T3** oder ein bereits weiter fortgeschrittener Status erscheinen. Eine Providerberechtigungsanfrage bestätigst du im zugehörigen T3-Thread.

## 9. Fortschritt und Übergaben lesen

Öffne im Ticket **Ablauf**. Unter **Workflows und Agentenläufe** siehst du die gespeicherten Phasen, ihre Rollen und Zustände. Öffne **Phasenauftrag ansehen**, um die für diese Version gespeicherte Arbeitsanweisung zu lesen. Unter **Tatsächliche Übergänge** erkennst du, welche Route Falkenwarte für ein gemeldetes Ergebnis gewählt hat.

Öffne den Lauf der empfangenden Phase und klicke auf **Übergabeprotokoll ansehen**. Dort liest du den Bericht, offene Fragen und Links, die diese Rolle zu Beginn erhalten hat. Falkenwarte speichert die Übergabe mit dem Quellbericht und dem beim Übergang gültigen Stand.

Wenn eine Phase pausiert oder blockiert ist, lies den Grund unter **Ablauf**. Eine menschliche Freigabe findest du unter **Entscheidungen**. Bei **Änderungen nötig** geht der Ablauf über die konfigurierte Route zurück und zählt als Überarbeitungsrunde.

Wenn das Überarbeitungslimit erreicht ist, prüfe den letzten Bericht und die angebotene Rückroute im Ticket. Für eine zusätzliche Runde trägst du unter **Hinweis für die nächste Überarbeitung** ein, was der Agent berücksichtigen soll, und klickst auf **Eine Überarbeitung freigeben**. Dein Hinweis erscheint in der Übergabe der nächsten Phase. Wenn du nicht fortfahren willst, kannst du den Workflow mit einer Begründung **Workflow abbrechen**.

## 10. Workflow und Ticket abschließen

Nach dem letzten Review prüfst du den Ergebnisbericht und seine gemeldeten Nachweise. Bestätige unter **Details → Erfolgskriterien** die Kriterien, die du fachlich geprüft hast. Ein erfolgreich abgeschlossener Workflow erledigt das Ticket nicht automatisch.

Wenn alle erforderlichen Kriterien bestätigt sind, setze den Ticketstatus selbst auf **Erledigt**. Die Karte erscheint danach in der entsprechenden Boardspalte. [Erfolgskriterien bestätigen und Ticket abschließen](AGENTS_AND_WORKFLOWS.md#13-die-erfolgskriterien-bestätigen)
