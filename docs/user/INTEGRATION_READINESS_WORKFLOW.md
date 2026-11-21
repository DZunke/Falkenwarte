# Vorlage „Integrationsreife prüfen“ einrichten

Diese vierphasige Vorlage bewertet einen benannten Änderungsstand und hält belegte Risiken sowie offene Fragen fest. Sie ändert keine Dateien und führt keinen Branch-, Push- oder Merge-Vorgang aus. Ein tatsächlicher Git-Merge braucht einen eigenen Auftrag.

Eine allgemeine, für das Projekt und die aktive T3-Verbindung freigegebene Agentrolle kann allen vier Phasen zugewiesen werden. Jede Phase startet einen eigenen T3-Thread und erhält ihren Phasenauftrag sowie die gespeicherte Übergabe aus der vorherigen Phase.

## Vorlage und Themenlabels anlegen

Öffne in der Hauptnavigation **Labels**, wähle oben dein Projekt und klicke auf **Label anlegen**. Lege die Themenlabels `Integrationskandidat` und `Risiko offen` nacheinander an. Wähle jeweils bei **Labelart** **Thema**, trage den **Name** ein und prüfe den automatisch gefüllten **Stabiler Schlüssel** (`integrationskandidat` beziehungsweise `risiko-offen`), bevor du auf **Speichern** klickst.

Öffne **Workflows → Vorlagen → Neue Vorlage**, wähle unter **Projekt** das Projekt und trage bei **Workflowname** `Integrationsreife prüfen` ein. Die erste Arbeitsphase ist bereits angelegt. Benenne sie unter **Name der Phase 1** als **Bestandsaufnahme**, weise die freigegebene Agentrolle zu und ergänze **Auftrag für diese Phase** nach der folgenden Übersicht.

Klicke dreimal auf **Phase hinzufügen**, um insgesamt vier Phasen anzulegen. Die erste Phase ist **Bestandsaufnahme**. Wähle für Phase 2 **Arbeitsphase** und für Phase 3 sowie Phase 4 **Reviewphase**. Fülle für jede ausgewählte Phase **Name der Phase N**, **Agentrolle für Phase N** und **Auftrag für diese Phase** passend zur Übersicht aus. Weise allen Phasen dieselbe Agentrolle zu, wenn sie die vier Aufgaben übernehmen kann.

| Phase | Art | Auftrag für diese Phase |
| --- | --- | --- |
| Bestandsaufnahme | Arbeitsphase | Erfasse den im Ticket benannten Arbeitsbaum, Branch, HEAD und Zielcommit. Grenze den Umfang anhand belegter Fakten ab und nenne Quellen sowie Grenzen der vorhandenen Evidenz. Führe die im Auftrag bezeichneten Offline-Prüfungen ohne Änderungen aus. Wenn ein konkreter Patch vorliegt, prüfe ihn zusätzlich mit `git apply --check`. Melde die tatsächlichen Befehle und Ergebnisse. |
| Kompatibilitätsprüfung | Arbeitsphase | Prüfe die abgegrenzte Änderung gegen den Zielcommit in einem separaten, sauberen Checkout. Führe passende unabhängige Offline-Tests und `git apply --check` aus. Melde nur tatsächlich ausgeführte Befehle und Ergebnisse. Verändere den erfassten Arbeitsbaum nicht. |
| Integrationskandidat | Reviewphase | Prüfe die technische Einstufung unabhängig anhand des Tickets, der Bestandsaufnahme, der Kompatibilitätsprüfung und der gemeldeten Prüfergebnisse. Nenne die Belege und verbleibende Einschränkungen. Ändere keine Dateien und führe keinen Merge aus. |
| Menschliche Risikoklärung | Reviewphase | Beschreibe ein belegtes Risiko oder fehlende Evidenz, nenne die konkrete Frage an den Eigentümer und verweise nur auf tatsächlich vorliegende Belege. Wenn die Risikoanalyse vollständig ist, melde **Angenommen** als Abschluss der Analyse, auch wenn ein technisches Risiko offen bleibt. Das ist keine technische Integrationsfreigabe. Ändere keine Dateien und führe keinen Merge aus. |

Aktiviere **Menschliche Freigabe** nur bei **Menschliche Risikoklärung**. Für diese Phase erscheint automatisch eine offene Eigentümerentscheidung, sobald der positive Ergebnisbericht, der abgeschlossene T3-Stand und die vorherigen Abschlussprüfungen vorliegen. Die Phasen **Bestandsaufnahme**, **Kompatibilitätsprüfung** und **Integrationskandidat** verlangen keine solche Freigabe.

Solange die Entscheidung offen ist, zeigt der Lauf **Phasenabschluss wird geprüft**, belegt den Ausführungsplatz dieser T3-Projektbindung und sperrt weitere Starts mit derselben Bindung.

## Übergänge einrichten

Mit jedem Klick auf **Phase hinzufügen** ergänzt Falkenwarte eine Standardroute **Angenommen** von der bisherigen letzten Phase zur neuen Phase. Nach vier Phasen sind damit diese drei Kanten angelegt: **Bestandsaufnahme → Kompatibilitätsprüfung**, **Kompatibilitätsprüfung → Integrationskandidat** und **Integrationskandidat → Menschliche Risikoklärung**. Behalte die erste Kante. Öffne die zweite und ändere **Zu Phase** auf **Menschliche Risikoklärung**. Öffne die dritte und entferne sie mit **Übergang 3 entfernen**, damit ein angenommener Bericht des **Integrationskandidat** den Ablauf beenden kann.

Ziehe für zusätzliche Standardrouten im **Ablaufplan** eine Verbindung vom Ausgang der Quellphase zur Zielphase. Falkenwarte ergänzt den ersten zulässigen Übergang. Öffne die Kante und wähle bei **Ergebnis** den Wert aus der Tabelle. Für die beiden beschrifteten Alternativen der **Kompatibilitätsprüfung** klickst du auf **Gelabelte Alternative hinzufügen**. Der neue Pfeil kann zunächst eine andere Quellphase und ein anderes Ergebnis zeigen. Wähle im jeweils geöffneten **Übergangsdetails · N** zuerst **Label für diesen Übergang**, dann **Von Phase**, **Ergebnis** und **Zu Phase**. So bleibt die Kombination aus Quellphase, Ergebnis und Label eindeutig, während du sie bearbeitest. Auf schmalen Ansichten findest du die Aktionen unter **Übergangsaktionen**.

| Von Phase | Ergebnis | Label für diesen Übergang | Zu Phase |
| --- | --- | --- | --- |
| Bestandsaufnahme | Angenommen | Standardroute | Kompatibilitätsprüfung |
| Bestandsaufnahme | Blockiert | Standardroute | Menschliche Risikoklärung |
| Bestandsaufnahme | Fehlgeschlagen | Standardroute | Menschliche Risikoklärung |
| Kompatibilitätsprüfung | Angenommen | Standardroute | Menschliche Risikoklärung |
| Kompatibilitätsprüfung | Angenommen | Integrationskandidat | Integrationskandidat |
| Kompatibilitätsprüfung | Angenommen | Risiko offen | Menschliche Risikoklärung |
| Kompatibilitätsprüfung | Blockiert | Standardroute | Menschliche Risikoklärung |
| Kompatibilitätsprüfung | Fehlgeschlagen | Standardroute | Menschliche Risikoklärung |
| Kompatibilitätsprüfung | Änderungen nötig | Standardroute | Bestandsaufnahme |
| Integrationskandidat | Änderungen nötig | Standardroute | Kompatibilitätsprüfung |

Der Zählcheck ergibt zehn Kanten: die beiden behaltenen Standardrouten **Angenommen**, zwei gelabelte Alternativen, vier getrennte Kanten für **Blockiert** und **Fehlgeschlagen** sowie zwei Rückrouten für **Änderungen nötig**.

Wenn die Kompatibilitätsprüfung eine klar abgegrenzte Änderung mit passenden Prüfergebnissen belegt, kann der Agent die Route `Integrationskandidat` wählen. Ein positives technisches Ergebnis kann trotzdem ein konkretes Risiko dokumentieren und die Route `Risiko offen` wählen. Wenn sich kein eindeutiger Kandidat belegen lässt, wählt der Agent ausdrücklich **Standardroute** zur Risikoklärung. Eine nicht angegebene Route kann stattdessen anhand der Themenlabels am Ticket aufgelöst werden.

Bei **Blockiert** oder **Fehlgeschlagen** in **Bestandsaufnahme** oder **Kompatibilitätsprüfung** führt die jeweilige Standardroute ebenfalls zur Risikoklärung. Meldet die **Kompatibilitätsprüfung** Änderungen, geht der Ablauf zurück zur Bestandsaufnahme. Meldet der **Integrationskandidat** Änderungen, geht er zurück zur Kompatibilitätsprüfung. Ein angenommener Bericht der Phase **Integrationskandidat** endet mit einer technischen Einschätzung und führt selbst keinen Merge aus. Auch eine angenommene Risikoanalyse endet nach der Eigentümerfreigabe, ohne einen Merge auszuführen.

## Überarbeitungen und Verwendung

Setze **Überarbeitungsrunden** auf `0`, wenn automatische Überarbeitungen ausbleiben sollen. Eine konfigurierte Rückroute mit **Änderungen nötig** wartet dann vor der ersten Überarbeitung auf deine Entscheidung. Prüfe den Bericht und verwende bei Bedarf **Eine Überarbeitung freigeben** mit einem konkreten Hinweis.

Speichere die Vorlage mit **Workflow anlegen** oder **Workflowversion speichern**. Wähle sie anschließend im Ticket unter **Ausführung → Workflow** ausdrücklich aus, wenn du diesen Prüfablauf starten willst. Eine vorhandene Board- oder Ticketvorgabe kann vorausgewählt sein; die Auswahl einer anderen aktiven Vorlage gilt nur für diesen Start.

Bei einer kleinen, isolierten Änderung kann die Kompatibilitätsprüfung den exakten Unterschied in einem sauberen Checkout prüfen und die tatsächlich gelaufenen Offline-Tests samt `git apply --check` berichten. Bei einem vermischten Arbeitsbaum hält die Bestandsaufnahme den belegbaren Umfang und die Evidenzgrenzen fest. Erfinde keine Testergebnisse und behaupte keinen Kandidaten, wenn der prüfbare Unterschied nicht isoliert werden kann.

Gibt der Agent eine vollständige Risikoanalyse mit `reported_success` ab, findest du unter **Entscheidungen** die Freigabe für diesen Bericht. Auch ein Urteil gegen die Integration kann eine vollständig beantwortete Prüfaufgabe sein. Meldet der Agent dagegen `blocked`, weil er die Analyse selbst nicht abschließen konnte, pausiert diese Endphase. Öffne den Bericht unter **Ablauf**, kläre die offene Frage und entscheide über einen Folgeauftrag. Ein einfaches **Fortsetzen** kann denselben fehlenden Übergang erneut melden. Einen tatsächlichen Merge beauftragst du gesondert.
