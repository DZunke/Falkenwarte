# Agent-Skill installieren

Der Falkenwarte-Skill ist eine einzelne Markdown-Datei für Codex, Claude Code und andere Agenten, die Skills und MCP unterstützen. Er erklärt, wie ein Agent im beauftragten Zielprojekt den Ticketkontext liest und sein Ergebnis an Falkenwarte meldet.

Du richtest zwei Dinge ein. Die Datei `SKILL.md` erklärt dem Agenten den Arbeitsablauf. Der MCP-Servereintrag und ein Token erlauben ihm, Falkenwarte zu erreichen und dort im Rahmen seiner Rechte zu arbeiten.

## Im Zielprojekt installieren

1. Öffne in Falkenwarte **Agents & T3** und klicke auf **Skill herunterladen**. Dein Browser lädt die Datei `SKILL.md` herunter.
2. Öffne in deinem Editor den Projektordner, den du in T3 gebunden hast. Läuft dein T3-Backend in WSL, öffne diesen Ordner in WSL. Bei Codex und Pi legst du darin den Ordner `.agents/skills/falkenwarte` an, bei Claude Code den Ordner `.claude/skills/falkenwarte`.
3. Kopiere die heruntergeladene `SKILL.md` in diesen Ordner. Bei Codex solltest du im Projekt jetzt die Datei `.agents/skills/falkenwarte/SKILL.md` öffnen können. Lass das Zielprojekt für die MCP-Konfiguration im Editor geöffnet.

Wenn du einen Skill für mehrere Projekte installieren oder den Download im Terminal ausführen möchtest, kannst du eines dieser Verzeichnisse verwenden.

| Agent | Projektverzeichnis | Benutzerverzeichnis auf dem Provider-Host |
|---|---|---|
| Codex | `.agents/skills/falkenwarte` | `$HOME/.agents/skills/falkenwarte` |
| Pi | `.agents/skills/falkenwarte` | `$HOME/.agents/skills/falkenwarte` |
| Claude Code | `.claude/skills/falkenwarte` | `${CLAUDE_CONFIG_DIR}/skills/falkenwarte`; standardmäßig `$HOME/.claude/skills/falkenwarte` |
| Anderer Provider | Das für Skills dokumentierte Verzeichnis | Das Benutzerverzeichnis des dort laufenden Providers |

Setze `SKILL_DIR` auf eine Zeile der Tabelle und lade die Datei aus deiner Falkenwarte-Instanz:

```sh
FALKENWARTE_ORIGIN=https://falkenwarte.example
SKILL_DIR=.agents/skills/falkenwarte
# Beispiele: .claude/skills/falkenwarte, "$HOME/.agents/skills/falkenwarte"
# oder "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/falkenwarte"
mkdir -p "$SKILL_DIR"
curl -fsSL "$FALKENWARTE_ORIGIN/skills/falkenwarte/SKILL.md" -o "$SKILL_DIR/SKILL.md"
```

Wenn eine ältere Falkenwarte-Version den Download noch nicht anbietet, nutze die aktuelle Datei aus dem öffentlichen [Falkenwarte-Quelltext](https://github.com/DZunke/Falkenwarte/blob/main/skills/falkenwarte/SKILL.md):

```sh
curl -fsSL https://raw.githubusercontent.com/DZunke/Falkenwarte/main/skills/falkenwarte/SKILL.md \
  -o "$SKILL_DIR/SKILL.md"
```

Codex findet Projektskills unter `.agents/skills` und Benutzerskills unter `$HOME/.agents/skills`; rufe den Skill mit `$falkenwarte` auf. Claude Code verwendet `.claude/skills` oder das `skills`-Verzeichnis seiner Konfiguration; rufe ihn dort mit `/falkenwarte` auf. Andere Provider benötigen dasselbe `SKILL.md` im jeweiligen dokumentierten Skills-Verzeichnis. [Codex-Skills](https://developers.openai.com/codex/skills) · [Claude-Code-Skills](https://code.claude.com/docs/en/skills)

T3 muss die Datei im aktiven Projekt und in der Umgebung seines ausgewählten Providers lesen können. Der aktuelle T3-Codex-Provider fragt Codex nach Skills für den Projektpfad des Threads; T3 dokumentiert für Claude sowohl `.claude/skills` als auch das `skills`-Verzeichnis der Provider-Konfiguration. Installierte T3-Versionen können sich unterscheiden. Wenn der Skill fehlt, prüfe Projektpfad, Provider-Konto und Codex- beziehungsweise Claude-Konfiguration und starte den Provider neu. [T3-Codex-Provider](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Drivers/CodexDriver.ts) · [T3-Claude-Provider](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md)

## MCP-Zugang einrichten

Die T3-Verbindung erlaubt Falkenwarte, einen Agenten zu starten. Für den Rückweg braucht der Agent einen eigenen Zugang, damit er das Ticket lesen und sein Ergebnis an Falkenwarte melden kann.

1. Öffne **Einstellungen → Technische Principals**. Gib unter **Tokenname** einen für dich erkennbaren Namen ein, etwa „Entwickler für Projekt A“.
2. Wähle unter **Projektzugriff** die gewünschten Projekte. **Alle Projekte** schließt jedes künftig angelegte Falkenwarte-Projekt ein. Die Projektfreigabe der Agentrolle und der Zugriff dieses Tokens lassen sich unabhängig einstellen.
3. Wähle unter **Berechtigungen** die Aufgaben, die der Agent ausführen darf. Für einen ersten Auftrag reichen **Tickets lesen**, **Aufträge lesen** und **Ergebnismeldungen senden**.
4. Klicke auf **Token ausstellen**. Erst jetzt erzeugt Falkenwarte den geheimen Wert und zeigt ihn einmal an. Kopiere ihn in deinen Passwortmanager und verwende ihn für die unten beschriebene Providerkonfiguration.

Die drei Rechte für den ersten Auftrag heißen in der API `tasks.read`, `runs.read` und `runs.report`. Soll der Agent Tickets anlegen oder Angaben zum Eingang nachreichen, gib ihm zusätzlich **Tickets bearbeiten** (`tasks.write`).

### Codex

**1. Serverdatei im Zielprojekt anlegen.** Öffne im Editor die oberste Ebene des gebundenen Projekts. Lege dort den Ordner `.codex` und darin die Datei `config.toml` an, falls sie fehlen. Gibt es die Datei bereits, behalte die vorhandenen Einstellungen und ergänze den folgenden Abschnitt. Gibt es darin bereits einen Abschnitt `[mcp_servers.falkenwarte]`, bearbeite diesen. Speichere die Datei. Für Falkenwarte und den T3-Provider auf derselben WSL-Instanz mit dem Standardport kannst du diesen Eintrag übernehmen.

```toml
[mcp_servers.falkenwarte]
url = "https://localhost:8443/mcp"
bearer_token_env_var = "FALKENWARTE_MCP_TOKEN"
```

Bei einer anderen Installation ersetze `https://localhost:8443` durch die Falkenwarte-Adresse, die **aus der Providerumgebung** erreichbar ist. Belasse `/mcp` am Ende. In der Datei steht der Name der Variablen. Ihren geheimen Wert trägst du im nächsten Schritt ein. Codex lädt Projektkonfigurationen aus vertrauenswürdigen Projekten. [Codex-MCP-Konfiguration](https://developers.openai.com/codex/mcp/)

**2. Token der richtigen Codex-Instanz geben.** Öffne in der T3-App **Settings → Providers**. Klicke links auf die Codex-Instanz, die du in der Falkenwarte-Agentrolle ausgewählt hast. Klicke rechts unter **Environment → Variables** auf **Add variable**. Gib als Namen `FALKENWARTE_MCP_TOKEN` und als Wert das Token ein, das du unter **Token ausstellen** erhalten hast. Übernimm die Änderung. Tokenwerte gehören ausschließlich in die Providerumgebung und deinen Passwortmanager.

**3. Bei einer lokalen Falkenwarte das Zertifikat hinterlegen.** Verwendest du die lokale Standardinstallation, braucht auch der Codex-Prozess Zugriff auf deren öffentliche Zertifizierungsstelle. Falls du die Datei bei der Installation bereits nach WSL kopiert hast, verwende ihren vorhandenen Pfad. Andernfalls öffne in WSL im Falkenwarte-Ordner mit der `compose.yaml` ein Terminal und führe den folgenden Befehl aus. Die zweite Zeile zeigt den vollständigen Pfad, den du gleich einträgst.

```sh
docker compose cp app:/certs/root.crt "$HOME/falkenwarte-root.crt"
realpath "$HOME/falkenwarte-root.crt"
```

Klicke bei derselben Codex-Instanz erneut auf **Add variable**. Gib als Namen `CODEX_CA_CERTIFICATE` ein und füge als Wert den vollständigen Pfad aus WSL ein, zum Beispiel `/home/anna/falkenwarte-root.crt`. Nutzt dein Server bereits ein öffentlich vertrauenswürdiges Zertifikat, fahre direkt mit dem Lesetest fort. [Codex und private Zertifizierungsstellen](https://learn.chatgpt.com/docs/auth?surface=cli#custom-ca-bundles)

**4. Neuen Thread öffnen.** Wähle in T3 das gebundene Projekt, erstelle einen neuen Thread mit genau dieser Codex-Instanz und führe den [Lesetest](#verbindung-im-zielprojekt-prüfen) aus. Die Projektdatei muss für diesen Codex-Prozess lesbar sein.

### Pi

Lege im vertrauenswürdigen Zielprojekt den folgenden Server in `.pi/mcp.json` unter `mcpServers` an. Ersetze die Beispieladresse durch die HTTPS-Adresse deiner Falkenwarte. Pi liest das Token zur Laufzeit aus der Umgebung der jeweiligen Providerinstanz. [Pi-MCP-Konfiguration](https://docs.pi.dev/latest/mcp)

```json
{
  "mcpServers": {
    "falkenwarte": {
      "url": "https://falkenwarte.example/mcp",
      "headers": { "Authorization": "Bearer ${FALKENWARTE_MCP_TOKEN}" }
    }
  }
}
```

Öffne in T3 **Settings → Providers**, wähle die Pi-Instanz und trage für sie unter **Environment → Variables** `FALKENWARTE_MCP_TOKEN` als geheimen Wert ein. Zwei Pi-Instanzen können dieselbe Projektdatei mit jeweils eigenen Tokens nutzen. Öffne einen neuen Thread im Zielprojekt. Pi lädt den Projektskill aus `.agents/skills/falkenwarte`. In einer interaktiven Pi-Sitzung kannst du den MCP-Status mit `/mcp` prüfen und den Skill mit `/skill:falkenwarte` aufrufen. Falls Pi meldet, dass Projektdateien übersprungen wurden, prüfe die Projektfreigabe in genau der Umgebung, die diese T3-Instanz verwendet. [Pi in T3](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/providers-pi.md) · [Pi-Skills](https://docs.pi.dev/latest/skills)

### Claude Code

Für eine Projektverbindung füge diesen Eintrag in die `.mcp.json` des Zielprojekts ein. Die Datei enthält nur den Variablennamen, nicht den Tokenwert:

```json
{
  "mcpServers": {
    "falkenwarte": {
      "type": "http",
      "url": "https://falkenwarte.example/mcp",
      "headers": {
        "Authorization": "Bearer ${FALKENWARTE_MCP_TOKEN}"
      }
    }
  }
}
```

Setze `FALKENWARTE_MCP_TOKEN` in der Umgebung, aus der Claude Code beziehungsweise der T3-Provider gestartet wird. Claude Code kann beim ersten Projektstart um Freigabe für den MCP-Server bitten; kontrolliere den Eintrag und bestätige ihn nur im gewünschten Projekt. Prüfe den Verbindungsstand mit `claude mcp get falkenwarte`. [Claude-Code-MCP-Konfiguration](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson)

Für andere Agenten nutze deren dokumentierte HTTP-MCP-Konfiguration und verweise dort auf dieselbe Umgebungsvariable. Wenn T3 remote oder containerisiert läuft, müssen Skill-Datei, MCP-Endpunkt und Token in dieser Provider-Umgebung verfügbar sein; die lokale Browserumgebung genügt nicht.

## Interne TLS-Zertifizierungsstelle

Bei einer privaten Zertifizierungsstelle benötigt der Provider ihr öffentliches CA-Zertifikat. Bei Codex kannst du `CODEX_CA_CERTIFICATE` in der Provider-Umgebung auf den Pfad der PEM-Datei setzen. Der Pfad muss auf dem Rechner lesbar sein, auf dem der T3-Provider läuft. Andere Provider können den Vertrauensspeicher ihres Hosts oder Containers verwenden. Starte nach Änderungen einen neuen Provider-Prozess. [Codex und private Zertifizierungsstellen](https://learn.chatgpt.com/docs/auth?surface=cli#custom-ca-bundles)

## Verbindung im Zielprojekt prüfen

Öffne das Board in Falkenwarte. Kopiere aus der Adresse die Projekt-ID zwischen `/project/` und `/board`. Ersetze in diesem Text `<Projekt-ID>` durch die kopierte ID und sende ihn im neuen T3-Thread mit der Providerinstanz deiner Agentrolle.

> Rufe beim MCP-Server falkenwarte das Werkzeug `tasks_list` mit `project_id <Projekt-ID>` und `limit 1` auf. Zeige mir das Ergebnis des Werkzeugaufrufs. Ändere nichts.

Bei einem leeren Board zeigt die Werkzeugantwort `isError: false` und `items: []`. Hat das Projekt schon Tickets, kann `items` ein Ticket enthalten. Beide Antworten bestätigen, dass dieser Agent das Projekt lesen kann.

Wenn der Server fehlt, prüfe die MCP-Konfiguration des gewählten Providers. Bei einem Zertifikatsfehler prüfe die CA im Providerprozess. Bei abgewiesenem Zugriff prüfe dort die Tokenvariable und in Falkenwarte die Gültigkeit, die Projektfreigabe und das Recht **Tickets lesen**. Sobald ein Ticket existiert, kannst du auch die Übergabe mit `task_handoff_get` und der Ticket-UUID prüfen. [MCP-Werkzeuge](../API.md#mcp-tools-verwenden)
