# Agent-Skill installieren

Der Falkenwarte-Skill ist eine einzelne Markdown-Datei für Codex, Claude Code und andere Agenten, die Skills und MCP unterstützen. Er erklärt, wie ein Agent im beauftragten Zielprojekt den Ticketkontext liest und sein Ergebnis an Falkenwarte meldet.

Im Bereich **Agents & T3** kannst du **Agent-Skill einrichten** öffnen oder über **Skill herunterladen** die Datei beziehen. Der Download liefert nur den Skill; er richtet keinen MCP-Zugang ein.

## Im Zielprojekt installieren

Wähle das Zielverzeichnis für deinen Agenten und führe den Befehl im Stammverzeichnis des Zielprojekts aus. Für eine T3-Instanz muss der Skill am selben Projektpfad und auf dem Rechner sichtbar sein, auf dem der Provider arbeitet.

| Agent | Projektverzeichnis | Benutzerverzeichnis auf dem Provider-Host |
|---|---|---|
| Codex | `.agents/skills/falkenwarte` | `$HOME/.agents/skills/falkenwarte` |
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

Der MCP-Zugang ist getrennt vom Skill. Stelle in Falkenwarte unter **Einstellungen → Technische Principals** ein technisches Token für das benötigte Projekt aus. Falkenwarte zeigt den Tokenwert nur einmal; bewahre ihn in einem Secret-Manager oder im geschützten Prozessumfeld auf und füge ihn nie in eine eingecheckte Datei oder in den Chat ein.

Für einen übergebenen Lauf reichen gewöhnlich **Tickets lesen** (`tasks.read`), **Aufträge lesen** (`runs.read`) und **Ergebnismeldungen senden** (`runs.report`). Zum Anlegen von Tickets oder Nachreichen von Intake-Angaben kommt **Tickets bearbeiten** (`tasks.write`) hinzu. `tasks_intake_get` nutzt `tasks.read`; die Werkzeugliste und deren Sichtbarkeit richten sich nach Projektbindung und Tokenrechten. Erteile `runs.request` nur, wenn eine konkrete Rollenaufgabe es verlangt.

### Codex

Ergänze die Codex-Konfiguration auf dem Host, auf dem Codex läuft. Standardmäßig ist das `~/.codex/config.toml`; die Variable enthält den Token und wird außerhalb der Datei gesetzt:

```toml
[mcp_servers.falkenwarte]
url = "https://falkenwarte.example/mcp"
bearer_token_env_var = "FALKENWARTE_MCP_TOKEN"
```

Setze `FALKENWARTE_MCP_TOKEN` in der Umgebung des Codex- beziehungsweise T3-Provider-Prozesses und starte diesen Prozess neu. Die Codex-CLI, IDE-Erweiterung und Desktop-App teilen auf demselben Rechner ihre MCP-Konfiguration. Prüfe sie mit `codex mcp list` oder im Codex-Terminal mit `/mcp`. [Codex-MCP-Konfiguration](https://developers.openai.com/codex/mcp/)

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

Bei einer lokalen Zertifizierungsstelle installiere ihr CA-Zertifikat im Vertrauensspeicher des Hosts oder Containers, der die MCP-HTTPS-Verbindung aufbaut, und starte den Provider neu. Die Codex-MCP-Konfiguration dokumentiert keine CA-Datei pro Server. Schalte die Zertifikatsprüfung nicht ab. [Codex-Konfigurationsreferenz](https://developers.openai.com/codex/config-reference)

## Verbindung im Zielprojekt prüfen

Öffne in T3 einen frischen Thread im tatsächlichen Zielprojekt und wähle den Falkenwarte-Skill über den Skills-Picker des Providers aus. Gib die UUID `task_id` eines Tickets an, das du lesen darfst und mindestens ein noch offenes Kriterium hat, und bitte den Agenten, `task_handoff_get` aufzurufen sowie Ticketkennzeichen und offenen Kriteriumstext zurückzugeben.

Dieser Lesetest sollte den Ticketkontext wirklich aus Falkenwarte beziehen. Der Agent soll keine Aufgabe anlegen, keine Angaben nachreichen, keinen Lauf starten und keinen Bericht senden. Wenn der MCP-Server nur als konfiguriert angezeigt wird, aber `task_handoff_get` nicht verfügbar ist, prüfe Token, Projektbindung und **Tickets lesen** (`tasks.read`) auf dem Provider-Host. [MCP-Werkzeuge](../API.md#mcp-tools-verwenden)
