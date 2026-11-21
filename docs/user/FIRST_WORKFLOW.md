# Von der Ersteinrichtung zum ersten Workflow mit mehreren Agentrollen

Diese Anleitung baut auf [Von der Einrichtung zur ersten Aufgabe](AGENTS_AND_WORKFLOWS.md) auf und zeigt, wie du mehrere Agentrollen in einem Ablauf verbindest. Das Beispiel führt von einer DDD Discovery über die Programmierung bis zum Review und passt zu jedem Projekt.

Lege zuerst in **Agentrollen** für dein Projekt die benötigten Rollen an oder prüfe vorhandene Rollen auf aktive Projektfreigabe, T3-Verbindung und **Konfiguration bereit**. Jede verwendete Providerinstanz braucht außerdem einen MCP-Zugang zu Falkenwarte, damit ihr Agent Aufgaben lesen und Ergebnisse melden kann. Richte zusätzliche Provider nach deren eigenem MCP-Konfigurationsformat ein und prüfe jeden Zugang mit dem Lesetest aus der Erstanleitung, bevor du die Rolle im Workflow einplanst.

Lade unter **Agents & T3 → Skill herunterladen** den aktuellen Falkenwarte-Skill und installiere ihn im gebundenen Projekt für die verwendeten Provider. Falls dort schon eine ältere Kopie liegt, ersetze deren `SKILL.md`. Die Anleitung erklärt dem Agenten, wie er den Auftrag der eigenen Phase liest, eine Rückfrage an die passende Rolle richtet und den nächsten Agenten über seine Ergebnisse informiert. [Skill im Zielprojekt installieren](AGENT_SKILL.md#im-zielprojekt-installieren)

## 1. Eine Workflowvorlage anlegen

Öffne **Workflows** und bleibe in der Ansicht **Vorlagen**. Klicke auf **Neue Vorlage**, wähle oben im Editor unter **Projekt** das Projekt und trage bei **Workflowname** `Discovery, Umsetzung und Review` ein.

Eine neue Vorlage enthält bereits eine Arbeitsphase. Richte diese erste Phase vollständig ein, bevor du weitere hinzufügst.

Für eine Vorlage zur Prüfung von Integrationskandidaten und offenen Risiken kannst du denselben Graphen mit vier Phasen aufbauen. [Vierphasige Vorlage „Integrationsreife prüfen“ einrichten](INTEGRATION_READINESS_WORKFLOW.md)

## 2. Discovery-Phase einrichten und weitere Phasen ergänzen

Beim Anlegen ist die erste Phase bereits ausgewählt und **Phasendetails** sind geöffnet. Bei einer gespeicherten Vorlage klickst du im **Ablaufplan** auf die Phase, die du bearbeiten möchtest. Die Details erscheinen daneben oder bei schmalem Fenster darunter. Trage bei **Name der Phase 1** `DDD Discovery` ein. Wähle bei **Art der Phase** **Arbeitsphase** und bei **Agentrolle für Phase 1** eine für das Projekt und die aktive T3-Verbindung freigegebene Rolle.

Du brauchst nicht für jede Phase eine andere Agentrolle. Wenn eine allgemeine Rolle alle Aufgaben übernehmen kann, wähle sie auch in den weiteren Phasen aus. Jede Phase startet einen eigenen Auftrag mit ihrem **Auftrag für diese Phase** und der gespeicherten Übergabe. Du kannst stattdessen spezialisierte Rollen kombinieren.

Trage den folgenden Text unter **Auftrag für diese Phase** ein.

```text
Lies das Ticket und die relevanten Stellen im Projekt. Kläre die fachlichen Begriffe und Regeln. Halte fest, was die Programmierung umsetzen soll, woran sie den Erfolg erkennt und welche Fragen offen sind. Nenne bei wichtigen Aussagen die Quelle. Ändere in dieser Phase keine Dateien.
```

Wähle bei **Boardspalte bei Phasenstart für Phase 1** auf deinem **Projektboard** die Option **In Arbeit · In Arbeit**. Der erste Name im Eintrag ist der Spaltenname. Der zweite zeigt die Statuskategorie an. Wenn die Discovery beginnt, wandert das Ticket nach **In Arbeit**.

Nachdem die erste Phase ausgefüllt ist, klicke auf **Phase hinzufügen**. Die neue Phase wird ausgewählt und **Phasendetails** öffnen sich. Trage bei **Name der Phase 2** `Programmierung` ein, wähle **Arbeitsphase** und bei **Agentrolle für Phase 2** dieselbe allgemeine Rolle oder eine für dieses Projekt und die aktive T3-Verbindung freigegebene Programmierrolle.

Trage den folgenden Text unter **Auftrag für diese Phase** ein.

```text
Lies das Ticket und die Übergabe aus der Discovery. Setze die vereinbarten Änderungen um und prüfe sie anhand der Erfolgskriterien. Melde dem Review, was du geändert und wie du es geprüft hast. Wenn eine fachliche Frage die Umsetzung blockiert, beschreibe die Frage und wähle die angebotene Rückroute zur Discovery.
```

Wähle für **Boardspalte bei Phasenstart für Phase 2** ebenfalls **In Arbeit · In Arbeit**, damit das Ticket bei einer Rückkehr aus dem Review wieder in der Spalte **In Arbeit** landet.

Klicke erst jetzt erneut auf **Phase hinzufügen**. Die neue Phase wird ausgewählt und **Phasendetails** öffnen sich. Trage bei **Name der Phase 3** `Review` ein, wähle **Reviewphase** und ordne unter **Agentrolle für Phase 3** dieselbe allgemeine Rolle oder eine passende Reviewrolle zu. Wenn es die gewünschte Rolle noch nicht gibt, lass **Keine Agentrolle** ausgewählt. Du kannst sie nach dem Speichern der Vorlage anlegen und zuordnen.

Trage den folgenden Text unter **Auftrag für diese Phase** ein.

```text
Prüfe die Änderungen unabhängig anhand des Tickets, der Erfolgskriterien, der Discovery-Übergabe und der gemeldeten Prüfungen. Erstelle eine Merge-Einschätzung.

Ordne die Merge-Reife als freigabefähig, riskant aber behebbar oder menschlicher Eingriff erforderlich ein.

Melde Angenommen, wenn die Erfolgskriterien geprüft sind und kein ungelöstes Risiko gegen das Zusammenführen spricht. Nenne die Belege und offene Einschränkungen.

Melde Änderungen nötig, wenn das Zusammenführen wegen konkreter, behebbarer Findings riskant wäre. Nenne die betroffene Stelle, die Auswirkung und die nötige Korrektur.

Melde Blockiert, wenn ein Risiko oder eine offene Frage eine menschliche Entscheidung oder zusätzliche Prüfung erfordert. Nenne genau, was der Eigentümer entscheiden oder prüfen muss.

Ändere keine Dateien und führe den Merge nicht aus.
```

Für dieses Beispiel führt **Angenommen** zum Ende des Workflows. **Änderungen nötig** führt zurück zur Programmierung. Für **Blockiert** gibt es in der Reviewphase keine automatische Route, damit der Ablauf mit dem Klärungsgrund auf eine menschliche Entscheidung wartet. Der Workflow beurteilt die Merge-Reife, aber der Eigentümer führt den Merge selbst aus.

Wähle bei **Boardspalte bei Phasenstart für Phase 3** **Review · Review**. Das Ticket wandert beim Phasenstart in die Spalte **Review**. Lass im Beispiel **Menschliche Freigabe** ausgeschaltet. Bei wiederholtem Änderungsbedarf entscheidest du über eine weitere Runde, sobald das Überarbeitungslimit erreicht ist.

Du kannst eine Vorlage auch mit noch nicht belegten Rollen speichern und später vervollständigen. Ein Ticketlauf kann erst starten und die Vorlage erst als Boardstandard dienen, wenn jede Phase eine startbereite Agentrolle hat. Wenn du vor dem Weitergehen selbst entscheiden sollst, aktiviere zusätzlich **Menschliche Freigabe** für diese Phase. Die Spaltenwahl ändert den Ticketstatus beim Phasenstart und schließt das Ticket nicht ab.

Die Phase mit dem Badge **Startphase** beginnt den Ablauf. Der **Ablaufplan** ordnet Phasen auf breiten Ansichten von links nach rechts und auf schmalen Ansichten von oben nach unten an. Über die Schaltflächen neben dem Phasennamen in **Phasendetails** kannst du eine Phase nach oben oder unten verschieben.

## 3. Übergänge zwischen den Phasen festlegen

Eine Verzweigung bietet mehrere mögliche nächste Phasen. Pro Ergebnis wählt Falkenwarte einen Übergang und übergibt das Ticket an die Rolle dieser Zielphase.

Klicke auf einen Pfeil im **Ablaufplan**, um **Übergangsdetails · N** zu öffnen. Mit **Übergang hinzufügen** erstellst du eine Route. Die neue Route wird ausgewählt und ihre Details öffnen sich. Bearbeite dort **Von Phase**, **Ergebnis** und **Zu Phase**.

Prüfe, dass **DDD Discovery** mit dem Ergebnis **Angenommen** über die **Standardroute** zu **Programmierung** führt und **Programmierung** mit **Angenommen** zu **Review**.

Klicke auf **Übergang hinzufügen**. In der ausgewählten Route wählst du zuerst **Review** bei **Von Phase**, dann **Programmierung** bei **Zu Phase** und zuletzt **Änderungen nötig** bei **Ergebnis**. Gibt es bereits aktive Themenlabels, erscheint auch **Label für diesen Übergang**. Lass es auf **Standardroute**. Ohne aktive Themenlabels wird das Feld nicht angezeigt und die Route ist bereits die Standardroute. Fordert das Review eine Korrektur, bekommt die Programmierrolle die Begründung und die Karte kehrt nach **In Arbeit** zurück.

Für die Rückfrage aus der Programmierung brauchst du ein aktives Themenlabel. Falls es noch fehlt, speichere den Entwurf mit **Workflow anlegen**. Öffne **Labels**, wähle dein Projekt und klicke auf **Label anlegen**. Lass **Labelart** auf **Thema**, gib als **Name** `Rückfrage zur Discovery` ein und klicke auf **Speichern**. Kehre zu **Workflows → Vorlagen** zurück und klicke bei deiner Vorlage auf **Graph öffnen**.

Für die Rückfrage legst du eine eigene Route mit **Übergang hinzufügen** an. Verwende hier nicht **Gelabelte Alternative hinzufügen**, weil diese Schaltfläche eine vorhandene Phase-Ergebnis-Kombination automatisch um ein Label ergänzt. Klicke auf **Übergang hinzufügen** und stelle zuerst **Von Phase** auf **Programmierung**. Ändere danach **Zu Phase** in **DDD Discovery** und **Ergebnis** in **Blockiert**. Ändere das Ziel vor dem Ergebnis, damit **Blockiert** nicht vorübergehend als Selbstübergang gesperrt ist. Wähle zuletzt bei **Label für diesen Übergang** `Rückfrage zur Discovery`. Der Agent kann diese angebotene Route bei einer Rückfrage im Phasenbericht nennen.

Beim Hinzufügen einer Phase ergänzt Falkenwarte einen Übergang **Angenommen** von der bisherigen letzten Phase, wenn es dort noch keine solche Route gibt. Vorhandene Übergänge werden nicht still umgebogen. Wenn eine Phase nicht erreichbar ist oder ein Ergebnis keine passende Standardroute hat, klicke auf **Übergang hinzufügen**, fülle **Von Phase**, **Ergebnis** und **Zu Phase** aus und prüfe die Route in der Übersicht.

Verwende für einen Themenabzweig ausschließlich ein aktives Themenlabel, das zu deinem Projekt gehört. Eine im Phasenbericht ausdrücklich gewählte Route hat Vorrang vor Ticketlabels, auch wenn der Agent ausdrücklich die **Standardroute** wählt. Nennt der Bericht keine Route, nimmt Falkenwarte einen eindeutigen passenden Abzweig aus den aktiven Themenlabels des Tickets. Gibt es keinen passenden Abzweig, gilt die **Standardroute**, sofern sie für das Ergebnis vorhanden ist.

Ein Themenabzweig wählt das nächste Ziel und fordert für sich allein keine menschliche Freigabe an. Führt er in eine bereits besuchte frühere Phase, zählt dieser Rücksprung zur Reparaturgrenze, unabhängig davon, ob der Übergang gelabelt oder eine Standardroute ist.

Hat ein Ticket mehrere passende Themenlabels mit verschiedenen Zielen, pausiert der Ablauf zur Klärung. Das gilt auch, wenn es für ein Ergebnis nur gelabelte Alternativen gibt und weder Bericht noch Ticketlabel eine davon bestimmen. Öffne dann **Ablauf**, lies den Pausegrund und prüfe die angebotenen Routen im letzten Phasenbericht.

Im Workfloweditor fasst **N Routen** mindestens drei Übergänge zwischen demselben Phasenpaar zusammen. Im Ticketablauf öffnet **N mögliche Routen** die ungeprüften Kandidaten eines solchen Paars; wenn bereits eine Route besucht wurde, heißen die übrigen Kandidaten **N weitere Routen**. Die Liste benennt das Phasenpaar und zeigt je Eintrag Ergebnis, Standardroute oder Themenlabel sowie zusätzliche Bedingungen und im Ticket den Auswahlstatus. Du kannst die Einträge mit Maus oder Tastatur auswählen. Bereits durchgeführte Routen bleiben einzeln auswählbar und öffnen den jeweiligen Besuch.

### Redaktionsrückrunde in einer Zeitungsdemo

Für eine Zeitungsdemo kann ein Ticket eine Seite für die im Auftrag genannten Ressorts und den dort festgelegten Zeitraum verlangen. Jede Meldung nennt ihre Quelle. Aktuelle Daten, Zahlen und Ereignisse, die noch nicht belegt sind, werden als `noch vom Faktencheck zu ermitteln` markiert und nicht als Tatsachen ausgegeben. Dieses Beispiel beschreibt eine Vorlage, keinen ausgeführten oder verifizierten Auftrag.

Verwende dafür die Phasen **Recherche**, **Redaktion** und **Faktencheck**. Die Standardroute führt von der Recherche zur Redaktion und von dort zum Faktencheck. Findet der Faktencheck eine belegte, korrigierbare Abweichung, meldet er **Änderungen nötig**, nennt die betroffene Aussage und den widersprechenden oder fehlenden Beleg und wählt die Standardroute zurück zur Redaktion. Die zweite Redaktionsphase erhält diese Begründung in ihrer Übergabe, aktualisiert den Entwurf und meldet die vorgenommenen Änderungen. Der Faktencheck läuft danach erneut. Ein abschließend angenommener Faktencheck beendet den Workflow.

Im Ticket öffnest du **Ablauf** und wählst im **Workflowablauf** den Knoten **Redaktion**. Unter dem Knoten wählst du **Lauf 1** für den ersten Entwurf und **Lauf 2** für den überarbeiteten Entwurf. Bei mehr als zwei Läufen wählst du den Eintrag im Auswahlfeld unter dem Knoten. Der ausgewählte Lauf öffnet Bericht und **Übergabeprotokoll ansehen**. Öffne so Lauf 2 der Redaktion, um den Auftrag aus dem ersten Faktencheck zu lesen, und danach Lauf 2 des Faktenchecks, um die Prüfung des neuen Entwurfs zu sehen.

Die tatsächliche Kante **Redaktion → Faktencheck** wurde in diesem Ablauf zweimal durchlaufen. Klicke im Graphen auf die Kante mit **×2** und wähle im Dialog **Besuch auswählen · 2 tatsächliche Übergänge** den ersten oder zweiten Besuch. So öffnest du den jeweils zugehörigen Lauf, die Agentenmeldung und das Übergabeprotokoll getrennt.

## 4. Optionale Phasenfreigaben und Überarbeitungsrunden festlegen

Aktiviere **Menschliche Freigabe** für eine Phase, wenn du ihren Bericht prüfen möchtest, bevor der Ablauf weitergeht. Für das Beispiel kannst du die Freigabe bei **DDD Discovery** einschalten, damit du die fachliche Einordnung vor der Programmierung abnimmst. Ohne diesen Haken kann die nächste Phase nach erfolgreichem Abschluss automatisch starten.

Bei aktivierter **Menschliche Freigabe** musst du keine Freigabe bei dir selbst beantragen. Sobald der aktuelle positive Phasenbericht, der abgeschlossene T3-Stand und die übrigen Abschlussprüfungen passen, legt Falkenwarte die offene Eigentümerentscheidung automatisch an. Öffne **Entscheidungen → Freigabe ausstehend**, lies Bericht und Nachweise, gib unter **Begründung** deine Einschätzung ein und wähle **Annehmen** oder **Zurückweisen**.

Du kannst auch für einen Lauf ohne Freigabepflicht ein Review anfordern. Öffne **Ausführung** und wähle den betreffenden Lauf. Stelle **Entscheidungstyp** auf **Phasenreview**, gib bei Bedarf einen Hinweis ein und klicke auf **Freigabe anfordern**.

Wähle für den ersten Durchgang unter **Überarbeitungsrunden** zum Beispiel `1`. Möglich sind Werte von `0` bis `20`. Jedes Ergebnis **Änderungen nötig** und jeder Rücksprung in eine bereits besuchte frühere Phase zählt, auch über eine Standardroute. Bis zum Limit kann Falkenwarte solche Runden automatisch fortsetzen. Bei `0` wartet die erste Runde auf deine Entscheidung. Am Limit prüfst du den letzten Bericht und kannst eine einzelne zusätzliche Runde mit Hinweis freigeben oder den Workflow abbrechen.

## 5. Vorlage speichern und Version prüfen

Klicke auf **Workflow anlegen**. Danach erscheint die Vorlage in **Vorlagen** mit ihrer aktuellen Version. Das Speichern startet keinen Agenten.

Wenn du später Änderungen vornehmen willst, klicke in **Vorlagen** bei der gespeicherten Vorlage auf **Graph öffnen** und dann auf **Workflowversion speichern**. Das erzeugt eine neue Version. Bereits gestartete Abläufe behalten ihre gespeicherte Version auch beim Pausieren und Fortsetzen. Neue Starts verwenden die aktuelle Version.

## 6. Eine Vorlage als Boardstandard auswählen

Öffne im Projekt die Boardansicht, für die die Vorlage gelten soll, und klicke auf **Workflowstandard**. Wähle im Dialog **Boardworkflow festlegen** unter **Standardworkflow** deine Vorlage und klicke auf **Einstellungen speichern**.

Optional kannst du unter **Label für manuelle Tickets** ein aktives Themenlabel wie `Manuell` auswählen. Tickets mit diesem Label starten als manuelle Boardarbeit ohne den Boardworkflow. Entferne das Label oder ändere den Boardstandard, wenn du den Boardworkflow für das Ticket nutzen willst.

Die Boardvorgabe wählt einen Workflow für den späteren Start vor. Speichern oder Zuordnen startet keinen Lauf. Jede Aufgabe bleibt manuell, bis du in ihrem Ticket auf **Workflow starten** klickst. Die Auswahl wird pro Board gespeichert.

### Eine zweite Vorlage im selben Projekt anlegen

Für eine kurze Leseaufgabe kannst du zusätzlich die Vorlage **Kurze Bestandsprüfung** anlegen. Beide Vorlagen stehen später im Ticket zur Wahl.

1. Klicke unter **Workflows → Vorlagen** auf **Neue Vorlage**. Wähle dasselbe Projekt und gib bei **Workflowname** `Kurze Bestandsprüfung` ein.
2. Nenne die erste Phase `Bestandsprüfung`. Wähle **Arbeitsphase** und eine für dieses Projekt freigegebene Rolle.
3. Gib bei **Auftrag für diese Phase** den Text `Lies das Ticket und die relevanten Projektstellen. Vergleiche die Anforderungen mit dem bestehenden Stand. Nenne Quellen, Abweichungen und offene Fragen. Ändere keine Dateien.` ein.
4. Klicke auf **Workflow anlegen**. In der Vorlagenliste siehst du jetzt beide Abläufe.

## 7. Ein Ticket für den ersten Ablauf vorbereiten

Öffne das Projektboard und wähle **Neues Ticket** oder ein vorhandenes Ticket mit einer klaren Aufgabe und prüfbaren Erfolgskriterien. Setze das Ticket auf **Bereit**, wenn es noch im **Backlog** steht.

Wenn dem Ticket eine Workflowlabel-Route zugeordnet ist, hat deren eingefrorene Version Vorrang vor dem Boardstandard und wird vorausgewählt. Ohne Ticketroute wählt Falkenwarte den Boardstandard vor. Das manuelle Ausschlusslabel des Boards sperrt den Workflowstart auch dann, wenn eine Vorlage vorausgewählt ist.

## 8. Den Workflow starten

Öffne das Ticket und danach **Ausführung**. Bei einem Boardstandard steht **Workflow starten** vor dem Einzellauf. Prüfe im Feld **Workflow** die gewünschte Vorlage und öffne **Phasen und Rollen**, um die Phasennamen und die tatsächlich zugeordneten Rollen dieser Version zu sehen. Für den mehrstufigen Auftrag wählst du **Discovery, Umsetzung und Review**. Für eine Leseaufgabe kannst du hier **Kurze Bestandsprüfung · Version 1** wählen. Die Auswahl gilt für diesen Start; klicke einmal auf **Workflow starten**.

Unter **Ausführungen** siehst du den neuen Ablauf. **Start wird übertragen** zeigt den Versand an T3, danach sollte **Läuft in T3** oder ein bereits weiter fortgeschrittener Status erscheinen. Eine Providerberechtigungsanfrage bestätigst du im zugehörigen T3-Thread.

## 9. Fortschritt und Übergaben lesen

Öffne im Ticket **Ablauf**. Unter **Workflows und Agentenläufe** siehst du die gespeicherten Phasen, ihre Rollen und Zustände. Im **Workflowablauf** zeigt das Diagramm außerdem die möglichen Routen dieser Version. Klicke auf eine tatsächliche Route, um das gewählte Ergebnis, den zugehörigen Lauf und die verknüpfte Agentenmeldung zu lesen; das **Übergabeprotokoll ansehen** ist dabei geöffnet. Mit **Details schließen** kehrst du zum Diagramm zurück. Du erreichst dieselbe Ansicht über **Workflows → Läufe → Ticketablauf ansehen**.

Öffne den Lauf der empfangenden Phase und klicke auf **Übergabeprotokoll ansehen**. Dort liest du den Bericht, offene Fragen und Links, die diese Rolle zu Beginn erhalten hat. Falkenwarte speichert die Übergabe mit dem Quellbericht und dem beim Übergang gültigen Stand.

Wenn eine Phase pausiert oder blockiert ist, lies den Grund unter **Ablauf**. Eine menschliche Freigabe findest du unter **Entscheidungen**. Bei **Änderungen nötig** geht der Ablauf über die konfigurierte Route zurück und zählt als Überarbeitungsrunde.

Wenn das Überarbeitungslimit erreicht ist, prüfe den letzten Bericht und die angebotene Rückroute im Ticket. Für eine zusätzliche Runde trägst du unter **Hinweis für die nächste Überarbeitung** ein, was der Agent berücksichtigen soll, und klickst auf **Eine Überarbeitung freigeben**. Dein Hinweis erscheint in der Übergabe der nächsten Phase. Wenn du nicht fortfahren willst, kannst du den Workflow mit einer Begründung **Workflow abbrechen**.

## 10. Workflow und Ticket abschließen

Nach dem letzten Review prüfst du den Ergebnisbericht und seine gemeldeten Nachweise. Bestätige unter **Details → Erfolgskriterien** die Kriterien, die du fachlich geprüft hast. Ein erfolgreich abgeschlossener Workflow erledigt das Ticket nicht automatisch.

Wenn alle erforderlichen Kriterien bestätigt sind, setze den Ticketstatus selbst auf **Erledigt**. Die Karte erscheint danach in der entsprechenden Boardspalte. [Erfolgskriterien bestätigen und Ticket abschließen](AGENTS_AND_WORKFLOWS.md#13-die-erfolgskriterien-bestätigen)
