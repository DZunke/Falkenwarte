# Von der Einrichtung zur ersten Aufgabe

Am Ende dieser Anleitung siehst du im Ticket, wie ein Agent deinen Auftrag in T3 bearbeitet und was er an Falkenwarte zurückmeldet. Du brauchst eine laufende Falkenwarte und ein T3-Projekt mit einem aktivierten Provider. Das Beispiel verwendet Codex. Für Pi und Claude Code findest du die passenden Einstellungen in Schritt 7.

## 1. In Falkenwarte anmelden

Öffne Falkenwarte im Browser. Bei der ersten Einrichtung gibst du das einmalige Einrichtungstoken ein und legst das Eigentümerpasswort fest. Melde dich mit deinem Passwort an. Jetzt siehst du die Hauptnavigation mit **Agents & T3**. [Falkenwarte installieren](../OPERATIONS.md)

## 2. T3 verbinden und Projekte laden

Öffne **Agents & T3**. Trage unter **Verbindung hinzufügen** einen Namen und die HTTPS-Adresse deines T3-Servers ein, etwa `https://t3.example.net`. Falkenwarte ergänzt `/mcp` selbst. Klicke auf **Verbindung speichern**.

Klicke auf **Bei T3 anmelden** und schließe die Anmeldung ab. Sobald die Verbindung in Falkenwarte **Autorisiert** anzeigt, klicke einmal auf **Verbindung testen**. Warte, bis du das Ergebnis für Netzwerk, Autorisierung, MCP und Fähigkeiten siehst. Klicke bei erfolgreicher Prüfung auf **Projekte laden**. In der Liste sollte dein T3-Projekt erscheinen.

**Windows-App mit WSL-Backend:** Du kannst die Windows-App weiterverwenden. Trage in Falkenwarte die HTTPS-Adresse ein, über die sein Container den T3-Server erreicht, etwa die Adresse deines eingerichteten T3-Relays. `localhost` bezeichnet im Falkenwarte-Container den Container selbst. [T3 anbinden](../operations/DEPLOYMENT_AND_CONFIGURATION.md)

## 3. Das Projekt zuordnen

Klicke in der Zeile deines T3-Projekts auf **Projekt verbinden**. Wenn du noch kein Falkenwarte-Projekt dafür hast, wähle **Neues Falkenwarte-Projekt anlegen**, fülle **Projektname** und **Kurzname** aus und klicke auf **Projekt anlegen und verbinden**. Hast du das Projekt in Falkenwarte schon angelegt, verwende **Vorhandenes Projekt wählen**.

Nach dem Speichern siehst du in der Projektzeile **{Projektname} öffnen**. Über diesen Link kommst du später zum Board. Falls das Projekt bereits angelegt wurde und die Zuordnung fehlgeschlagen ist, kannst du im selben Dialog die Verbindung für dieses Projekt erneut speichern.

## 4. Eine Agentrolle auswählen oder anlegen

Klicke in der verbundenen Projektzeile auf **Agentrolle einrichten**. Projekt und T3-Verbindung sind dann vorausgewählt. Wenn du für dieses Projekt bereits eine aktivierte Rolle mit der richtigen Verbindung, dem gewünschten Ziel und **Konfiguration bereit** hast, merke dir ihren Namen und gehe zu Schritt 5.

1. Gib unter **Rolle hinzufügen** einen **Namen** ein, den du später im Ticket wiedererkennst. Unter **Rolle** beschreibst du die Aufgabe, etwa `Entwicklung`.
2. Prüfe **T3-Verbindung** und **Erlaubte Projekte**. Wähle dein Projekt oder **Alle Projekte**, wenn die Rolle auch für künftige Projekte verfügbar sein soll. Ein Agent kann für ein Projekt starten, wenn es an dieselbe T3-Verbindung gebunden ist.
3. Wähle unter **Ausführungsziel in T3** den Eintrag **T3-Providerinstanz**. Wähle unter **Providerinstanz aus T3** deine Instanz und unter **Modell aus T3** ihr Modell. Der Slug neben dem Namen unterscheidet auch zwei Varianten desselben Providers. Ist nur ein Modell verfügbar, kann es schon ausgewählt sein. Wenn T3 für das Modell Reasoning-Werte meldet, kannst du unter **Reasoning-Level** einen davon oder **T3-Standard** wählen. **T3-Standard** sendet keine zusätzliche Reasoning-Auswahl. Ein von T3 gemeldeter Standardwert erscheint nur als Hinweis. Ohne gemeldete Werte gibt es nichts auszuwählen.
4. Klicke auf **Rolle anlegen**. Prüfe in der Rollenliste den Namen, das Ziel und die Anzeige **Konfiguration bereit**.

## 5. Das Board einrichten

Öffne dein Projekt. Klicke auf **Board einrichten**, lass den vorgeschlagenen Namen **Projektboard** stehen und klicke auf **Board erstellen**. Jetzt siehst du das Board mit seinen Spalten. Bei einem neuen Projekt beginnt es mit **Backlog** und **Bereit**. Hast du schon ein Board, öffne es direkt. [Board und Status anpassen](PROJECTS_AND_TICKETS.md)

## 6. Ein Token für den Agenten ausstellen

Falkenwarte hat jetzt Zugang zu T3. Damit dein Agent in die andere Richtung Tickets lesen und Ergebnisse melden kann, stellst du ihm in Falkenwarte ein Token aus.

1. Öffne **Einstellungen → Technische Principals**. Gib unter **Tokenname** einen frei gewählten Namen ein, etwa `Entwicklung – Projekt A`.
2. Wähle unter **Projektzugriff** dein Projekt. **Alle Projekte** gibt diesem Token auch Zugriff auf künftig angelegte Projekte. Hier bestimmst du, welche Daten der Agent lesen oder bearbeiten darf. Die Projektfreigabe der Rolle aus Schritt 4 bestimmt, wo du sie starten kannst.
3. Wähle **Tickets lesen**, **Aufträge lesen** und **Ergebnismeldungen senden**. Diese drei Rechte reichen für die erste Aufgabe. Prüfe die **Gültigkeit (Tage)** und klicke auf **Token ausstellen**.
4. Kopiere den einmal angezeigten Wert in deinen Passwortmanager. Du brauchst ihn im nächsten Schritt bei der Providerinstanz.

## 7. Skill und MCP im Zielprojekt einrichten

Öffne in Falkenwarte **Agents & T3 → Skill herunterladen**. Öffne dann in deinem Editor genau das Projekt, das du in T3 gebunden hast. Läuft dein Provider in WSL, arbeite im Projektordner in WSL. Für Codex legst du darin den Ordner `.agents/skills/falkenwarte` an und kopierst die heruntergeladene `SKILL.md` hinein. So findet der Agent die Anleitung, wie er Aufträge lesen und Ergebnisse melden soll. [Installationspfade nach Provider](AGENT_SKILL.md#im-zielprojekt-installieren)

Jede Providerinstanz, mit der du eine Agentrolle startest, braucht einen eigenen MCP-Zugang zu Falkenwarte. Die Agentkonfiguration nennt den MCP-Server und verwendet einen Umgebungsvariablen-Namen für das Token. In T3 hinterlegst du das Token bei der passenden Providerinstanz und richtest dort auch das Vertrauen in das TLS-Zertifikat ein. Diese Rückverbindung zum Falkenwarte-MCP ist von Falkenwartes Autorisierung bei T3 getrennt. Installiere den Skill außerdem in dem Projekt, das der Agent bearbeitet.

**Codex-Beispiel:** Lege im selben Projekt den Ordner `.codex` und darin die Datei `config.toml` an, falls sie fehlen. Ergänze den folgenden Abschnitt. Falls es bereits einen Abschnitt mit diesem Namen gibt, aktualisiere ihn und behalte die übrigen Einstellungen. Speichere die Datei. Das Beispiel passt, wenn der T3-Provider Falkenwarte in derselben WSL-Umgebung unter Port 8443 erreicht. Bei einer anderen Installation nimm deren erreichbare HTTPS-Adresse und hänge `/mcp` an.

```toml
[mcp_servers.falkenwarte]
url = "https://localhost:8443/mcp"
bearer_token_env_var = "FALKENWARTE_MCP_TOKEN"
```

Öffne in der T3-App **Settings → Providers** und klicke auf dieselbe Codex-Instanz, die du in der Falkenwarte-Rolle gewählt hast. Klicke unter **Environment → Variables** auf **Add variable**. Trage als Namen `FALKENWARTE_MCP_TOKEN` ein und als Wert das Token aus Schritt 6. Übernimm die Änderung.

Für die lokale Standardinstallation braucht Codex auch das öffentliche CA-Zertifikat deiner Falkenwarte. Klicke bei derselben Instanz erneut auf **Add variable**. Verwende den Namen `CODEX_CA_CERTIFICATE` und als Wert den vollständigen Pfad zur Zertifikatsdatei in der Providerumgebung. Wenn du die Datei noch nicht hast, zeigt dir das Rezept, wie du sie aus deiner laufenden Falkenwarte kopierst und den Pfad abliest. Bei einem öffentlich vertrauenswürdigen Zertifikat genügt die Tokenvariable. [Zertifikat kopieren und Codex einrichten](AGENT_SKILL.md#codex)

**Für jede weitere Providerinstanz:** Wiederhole diese Einrichtung in der Projektumgebung, in der T3 den Agenten ausführt. Nutze das eigene MCP-Konfigurationsformat des Providers und registriere darin einen Server mit dem Namen `falkenwarte`, der auf die erreichbare HTTPS-Adresse deiner Falkenwarte mit dem Pfad `/mcp` zeigt.

1. Installiere den heruntergeladenen Falkenwarte-Skill am Installationspfad dieses Providers im gebundenen Projekt. Die Übersicht nennt die Pfade für Pi und Claude Code. [Skillpfade nach Provider](AGENT_SKILL.md#im-zielprojekt-installieren)
2. Weise der Providerkonfiguration das Falkenwarte-Token aus Schritt 6 als Bearer-Token zu. Verwende dafür den Umgebungsvariablen-Namen `FALKENWARTE_MCP_TOKEN` und hinterlege den geheimen Wert in der Umgebung dieser Providerinstanz bei T3.
3. Richte für ein lokales oder selbst signiertes Zertifikat das Vertrauen in die öffentliche CA deiner Falkenwarte nach dem Verfahren dieses Providers ein. Deaktiviere dafür nicht die TLS-Prüfung.
4. Öffne in T3 einen neuen Thread im gebundenen Projekt mit genau dieser Providerinstanz und führe den Lesetest aus Schritt 8 aus. Erst wenn `tasks_list` eine erfolgreiche Antwort liefert, ist dieser zusätzliche MCP-Zugang geprüft.

Die Formate, Einstellungsfelder und Zertifikatspfade unterscheiden sich zwischen Providern. Verwende deren eigene MCP-Anleitung, übertrage aber dieselbe Serveradresse, Tokenumgebung, TLS-Vertrauensstellung und den erfolgreichen Lesetest. [Pi einrichten](AGENT_SKILL.md#pi) · [Claude Code einrichten](AGENT_SKILL.md#claude-code)

## 8. Den Zugang prüfen, solange das Board noch leer ist

Öffne dein Board in Falkenwarte. Kopiere aus der Adresse die Projekt-ID zwischen `/project/` und `/board`. Öffne in T3 einen **neuen Thread** in diesem Projekt mit deiner ausgewählten Providerinstanz. Ersetze im folgenden Text `<Projekt-ID>` durch die kopierte ID und sende die Nachricht.

```text
Rufe beim MCP-Server falkenwarte das Werkzeug tasks_list mit project_id <Projekt-ID> und limit 1 auf. Zeige mir das Ergebnis des Werkzeugaufrufs. Ändere nichts.
```

Bei einem leeren Board siehst du `isError: false` und `items: []`. Das ist die erwartete Antwort. Gibt es bereits Tickets, kann unter `items` ein Ticket stehen. Bei einem Fehler prüfe zuerst die Serverdatei, bei einem Zertifikatsfehler den CA-Pfad und bei abgewiesenem Zugriff die Tokenvariable, die Projektfreigabe und **Tickets lesen**. [Verbindung im Zielprojekt prüfen](AGENT_SKILL.md#verbindung-im-zielprojekt-prüfen)

## 9. Das erste Ticket anlegen

Klicke auf deinem Board auf **Neues Ticket**. Wähle eine Aufgabe, die zu deinem Projekt passt. Für ein Python-Projekt mit Ruff und pytest kannst du dieses Beispiel übernehmen.

| Feld | Beispiel |
| --- | --- |
| **Titel** | Python-Abhängigkeiten aktualisieren |
| **Beschreibung** | Aktualisiere die Laufzeit- und Entwicklungsabhängigkeiten auf die neuesten stabilen Versionen, die mit dem Projekt kompatibel sind. Gleiche die Abhängigkeitsdateien und die CI-Installation ab. Begründe verbleibende Versionsgrenzen. |
| **Erfolgskriterien** | Erste Zeile: `Die aktualisierten Abhängigkeiten lassen sich installieren.` Zweite Zeile: `ruff check src tests scripts sowie pytest -q laufen erfolgreich.` |

Klicke auf **Ticket anlegen**. Du siehst die Karte im Standardstatus des Projekts, bei einem neuen Board in **Backlog**. Für ein von dir angelegtes Ticket brauchst du mit den Standardeinstellungen keinen OpenAI-Zugang. [Optionale Einordnung für manuelle Tickets](INTAKE_AND_DECISIONS.md)

## 10. Das Ticket auf Bereit setzen

Öffne die Karte. Unter dem Titel siehst du ein Auswahlfeld mit **Backlog**. Klicke darauf und wähle **Bereit**. Wenn das Feld **Bereit** anzeigt, lass das Ticket geöffnet.

## 11. Den Agenten starten

Öffne den Reiter **Ausführung**. Wähle im Abschnitt **Einzellauf anfordern** unter **Rollenprofil** deine Rolle. Lass **Phase** auf `task`. Unter **Startbedingungen** sollte jetzt „Für Ticket und Projekt sind keine bekannten Startblockaden offen.“ stehen. Steht dort eine Sperre, behebe den genannten Grund, bevor du fortfährst.

Klicke einmal auf **Einzellauf anfordern**. Schau im selben Reiter unter **Ausführungen** auf den neuen Lauf. Auf **Start wird übertragen** folgt bei erfolgreicher Übergabe **Läuft in T3**. Bei einem schnellen Start siehst du unter Umständen direkt den zweiten Status. Mit **Aktualisieren** kannst du den Stand neu laden.

Wartet der Auftrag auf eine Antwort, öffne **Eingabe an den laufenden Auftrag**. Steht dort **Antwort über Falkenwarte möglich**, kannst du dort antworten. Eine Berechtigungsanfrage des Providers bestätigst du direkt im zugehörigen T3-Thread.

## 12. Das Ergebnis prüfen

Öffne im Ticket **Ausführung** und wähle **task · Versuch 1**. Lies unter **Ergebnisberichte**, was der Agent geändert hat und welche Prüfungen er tatsächlich ausgeführt hat. Die zugehörigen Prüfberichte findest du unter **Details → Gemeldete Nachweise**.

Prüfe im Beispiel, ob der Nachweis die Installation der aktualisierten Abhängigkeiten belegt und ob er die Ergebnisse für Ruff und pytest nennt. Unter **Details → Erfolgskriterien** siehst du **Agentenmeldung liegt vor** bei den Kriterien, denen der Agent einen Nachweis zugeordnet hat.

**Falls die Zuordnung fehlt:** Öffne unter **Gemeldete Nachweise** den passenden Prüfbericht. Klicke auf **Kriterien zuordnen**, hake die Kriterien an, die dieser Bericht tatsächlich belegt, und klicke auf **Zuordnung speichern**. Bei diesen Kriterien erscheint jetzt **Bestätigen**. Diesen Schritt brauchst du beispielsweise bei einem älteren Agentenbericht. [Nachweise zuordnen und prüfen](PROJECTS_AND_TICKETS.md#ticketdetails-nachweise-und-verlauf)

## 13. Die Erfolgskriterien bestätigen

Klicke unter **Details → Erfolgskriterien** beim ersten belegten Kriterium auf **Bestätigen**. Trage unter **Begründung** kurz ein, was dich am Nachweis überzeugt hat, und klicke auf **Fachlich bestätigen**. Wiederhole das für die übrigen Kriterien, die du geprüft hast. Bei jedem abgenommenen Kriterium steht jetzt **Menschlich bestätigt**.

## 14. Das Ticket abschließen

Klicke oben im geöffneten Ticket auf das Statusfeld **Bereit** und wähle **Erledigt**. Schließe die Ticketansicht, sobald der neue Status angezeigt wird. Auf dem Board findest du deine Karte jetzt in der Spalte **Erledigt**.

Verhindert eine Abschlussregel den Wechsel, öffne im Ticket den Reiter **Ablauf** und lies unter **Ticketstand**, was noch aussteht. Wenn eine Phase **Menschliche Freigabe** verlangt, erstellt Falkenwarte die offene Entscheidung automatisch, sobald der aktuelle Phasenbericht und die übrigen Abschlussprüfungen passen. Öffne **Entscheidungen → Freigabe ausstehend**, begründe deine Entscheidung und wähle **Annehmen** oder **Zurückweisen**. Eine zusätzliche manuelle Phasenreview kannst du am aktuellen Lauf unter **Ausführung** anfordern, sofern dafür noch keine passende Freigabe existiert.

### Den Ablauf eines Tickets lesen

Klicke im Ticket auf **Ablauf**. Unter **Ticketstand** siehst du den Status, offene Erfolgskriterien und Gründe für eine Blockade. Über **Details öffnen** kommst du zu den Kriterien. Bei einem Workflow siehst du zusätzlich die Phasen der beim Start gespeicherten Version und die bisherigen Ergebnisse.

Öffne für eine Übergabe den Lauf der empfangenden Phase und klicke auf **Übergabeprotokoll ansehen**. Du siehst den Bericht, die offenen Fragen und die Links, die diese Rolle zu Beginn erhalten hat. Versuch und Ticketrevision zeigen, auf welchen Stand sich die Übergabe bezieht.

## Weitere Ausführungsziele und Workflows

Unter **Agentrollen** kannst du eine gespeicherte Rolle **Aktivieren**, ihre **Projektfreigaben ändern** oder ihr **Ausführungsziel ändern**. Änderungen gelten für künftige Starts. Bereits laufende Aufträge behalten die bei ihrem Start gespeicherte Auswahl samt Reasoning-Level. Nach Änderungen in T3 kannst du **Provider neu laden** oder über **Modellsuche in T3** nach einem Modell suchen.

| Ausführungsziel der Rolle | Wann es passt |
| --- | --- |
| **T3-Projektstandard** | T3 soll das für dieses Projekt eingerichtete Standardziel wählen. |
| **T3-Providerinstanz** | Du möchtest einen bestimmten Instanz-Slug und ein Modell auswählen. T3 prüft beim Start, ob die Instanz in dem Projekt aktiviert ist. |
| **Vorhandener Referenzthread** | Ein Thread im gebundenen Projekt liefert Provider- und Modellreferenz. Wähle ihn unter **Referenzthread aus T3** oder nutze **ID manuell eingeben**. Der neue Auftrag startet in einem eigenen Thread mit eigener Unterhaltung. |

Wenn du mehrere Phasen mit eigenen Agentrollen verbinden willst, richte einen mehrphasigen Ablauf ein und verfolge seine Übergaben im Ticket. [Von der Ersteinrichtung zum ersten Workflow mit mehreren Agentrollen](FIRST_WORKFLOW.md)

Pro Rolle kann höchstens ein Auftrag gleichzeitig laufen. Unter **Workflowlabels zuordnen** kannst du eine Workflowversion für passende Tickets festlegen. Der Start wird weiterhin im Ticket angefordert. Ein **Manueller Trigger** wird ebenfalls ausdrücklich ausgelöst.
