# T3-Integration: Verbindung, Läufe und Wiederaufnahme

Falkenwarte steuert eine vorhandene T3-Instanz über deren MCP-Endpunkt. Falkenwarte besitzt Aufgaben, Ausführungszustände, Ergebnisse und Freigaben. T3 besitzt Provider, Modellwahl, Laufzeit und Workspace.

## Konfiguration und Transport

| Wert | Quelle und Grenze |
|---|---|
| Kanonische T3-Adresse | Wird je Verbindung in Falkenwarte gespeichert. Produktiv nur HTTPS ohne Zugangsdaten, Query oder Fragment |
| Testadresse | Ausschließlich im Test-Environment ist `http://t3-mock` erlaubt |
| OAuth-Callback | Standard `FALKENWARTE_PUBLIC_URL/auth/t3/callback`. `FALKENWARTE_PUBLIC_URL` fällt auf `FALKENWARTE_PUBLIC_ORIGIN` zurück |
| HTTP-Clients | `t3.client` ist ein Symfony Scoped Client für OAuth mit Redirects ausgeschaltet. `psr18.t3.client` und `mcp.psr17_factory` transportieren MCP |
| OAuth-Zeitlimits | Discovery und Clientregistrierung 10 s, Codeaustausch 15 s |
| MCP-Zeitlimits | Initialisierung und Aufruf je 15 s. Client-Retries sind ausgeschaltet |

Die gemeinsamen Defaults und lokalen Überschreibungen stehen in der [Symfony-Umgebungsdatei](../.env). Die [Framework-Konfiguration](../config/packages/framework.yaml) legt den Scoped Client fest. OAuth-Anfragen verwenden die in der T3-Metadatenantwort genannten Endpunkte. Redirects werden nicht verfolgt. Absolute OAuth-Endpunkt-URLs aus den Metadaten werden aktuell nicht auf dieselbe Origin beschränkt.

Die URL-Regel schützt vor Zugangsdaten, Query und Fragment in der konfigurierten T3-Adresse. Sie pinnt weder DNS-Adressen noch beschränkt sie private IP-Netze. Produktive Zielnetze müssen daher durch den Betreiber kontrolliert werden.

## OAuth-Verbindung

Ein Eigentümer startet `POST /api/v1/connections/{connection_id}/oauth/start`. Der Browser folgt der zurückgegebenen Authorization-URL und kehrt über `GET /auth/t3/callback` zurück.

Die OpenAPI-Operation überschreibt für den Callback den globalen Serverpfad `/api/v1` mit `/`.

1. Falkenwarte liest `/.well-known/oauth-protected-resource/mcp` und bei Bedarf `/.well-known/oauth-authorization-server`.
2. Es registriert einen öffentlichen OAuth-Client ohne Client-Secret und fordert den Scope `orchestration:operate` an.
3. Der Flow verwendet zufälligen State und PKCE S256. Der State wird gehasht und der PKCE-Verifier als verschlüsseltes Secret gespeichert.
4. Der Flow läuft nach 10 Minuten ab. Der Callback prüft State, Ablaufzeit und einen gelieferten Issuer, markiert den Flow als verbraucht und tauscht den Code aus.
5. Das Zugriffstoken wird verschlüsselt gespeichert. `auth_epoch` steigt und offene T3-Läufe werden zur Abstimmung vorgemerkt.

Eine erneute Anmeldung nach unbekanntem Start erzeugt keinen stillen Replay in einem neuen T3-Namespace. Wird ein gespeichertes T3-Token entfernt oder läuft es ab, werden neue Starts blockiert und der Eigentümer muss sich erneut anmelden. Eine Remote-Revocation in T3 wird durch das Entfernen des lokalen Secrets nicht ausgeführt.

Die Verbindungsprüfung ist ein dauerhafter Auftrag. Sie prüft Netzwerk, Anmeldung, MCP-Handshake und erforderliche Fähigkeiten und speichert einen Fähigkeitssnapshot. Der API-Aufruf selbst wartet nicht auf den externen Dienst.

Code: [T3ConnectionRules](../src/AgentCatalog/Domain/T3ConnectionRules.php), [AgentCatalogHandler](../src/AgentCatalog/Application/AgentCatalogHandler.php), [T3OAuthAuthenticator](../src/Orchestration/Infrastructure/T3OAuthAuthenticator.php).

## MCP-Profil und tatsächlich genutzte Werkzeuge

`T3McpSessionFactory` erstellt pro Verbindung mit der gespeicherten kanonischen URL und dem Zugriffstoken eine `ServerConnection` aus Symfony MCP Bundle.

Der Client handelt ausschließlich MCP `2025-06-18` aus und deaktiviert Protokoll-Fallback. Eine abweichende ausgehandelte Version wird abgewiesen. Das im Pluginmanifest benannte Adapterprofil lautet `t3.mcp.v0_1_10`.

| T3-Werkzeug | Verwendung in Falkenwarte |
|---|---|
| `orchestrator_capabilities` | Serverversion, Provider und unterstützte Aktionen lesen |
| `t3_project_list` | Projekte für ein Projektbinding auflisten |
| `t3_thread_launch` | Einen neuen Thread mit eingefrorener Nachricht und stabiler Request-ID starten |
| `t3_thread_read` | Thread und Laufstatus beobachten |
| `t3_thread_send` | Nachricht mit Modus `queue` in einen bestehenden Thread senden |
| `t3_thread_interrupt` | Bekannten Lauf unterbrechen |

Der Client prüft die verfügbaren Werkzeuge vor dem jeweiligen Aufruf und behandelt MCP `isError` als Fehlschlag. Für `t3_thread_read` verwendet er derzeit einen einzelnen Abruf mit `afterPosition=0`, höchstens 100 Threadeinträgen, 50 Läufen und 20.000 Zeichen je Eintrag. Cursorfortsetzung und weitere Seiten werden von diesem Adapter nicht abgerufen.

Referenzthreads können eine belegte Provider-/Modellreferenz an einen neuen Start weitergeben. Fehlen diese Werte oder gehört der Thread nicht zum gebundenen Projekt, wird der Start blockiert. Der Modus `t3_project_default` lässt T3 seinen Projektstandard auswählen. Falkenwarte verwaltet keine Provider- oder Modellkonfiguration.

## Datenfluss eines Laufs

1. `RunHandler` speichert Taskrevision, Agentprofil, Projektbinding, Policy, T3-Verbindung und Versuch als dauerhaften Snapshot.
2. Vor dem Netzaufruf speichert Falkenwarte einen Dispatch-Request mit Hash und stabiler `clientRequestId`.
3. T3 liefert Thread- und gegebenenfalls Runreferenz. Falkenwarte speichert die Zuordnung und plant Beobachtung.
4. Der Maintenance-Prozess stellt Beobachtungsaufträge ein. Der nächste Laufstatus wird etwa alle 5 Sekunden angefragt.
5. Agenten melden Rückfragen, Links und Ergebnisse separat über die Falkenwarte-API beziehungsweise den Falkenwarte-MCP-Server.

Ein beobachteter T3-Status `completed` führt in Falkenwarte zunächst zu `verifying`. Der Run endet erst, wenn passende Agentmeldungen, verlangte Nachweise und die gespeicherte Completion-Policy erfüllt sind. Diese Anwendung bestätigt keine gemeldeten Tests, Commits oder Pull Requests selbst.

## Ausfall und Wiederaufnahme

| Situation | Wirkung |
|---|---|
| T3-Zeitüberschreitung nach möglicher Annahme | Der unveränderte Dispatch-Request und seine ID bleiben gespeichert. Solange die Auth-Epoch gleich bleibt, kann derselbe Versuch mit derselben Request-ID wiederholt werden |
| Threadreferenz ist bekannt | Beobachtung läuft mit derselben Referenz weiter, auch nach erneuter Anmeldung |
| Startausgang unbekannt und Auth-Epoch geändert | Status `reconciling`. Kein Replay über die neue OAuth-Session |
| HTTP 401 oder 403 | Status `auth_blocked`. Eigentümer meldet sich erneut an |
| Unbekannter T3-Status oder unvollständige Launchantwort | Status `reconciling`. Der Ausführungsplatz bleibt belegt |
| Anwendung nach Backup/Wiederherstellung | Neue T3-Inventur muss bekannte und unbekannte externe Aktivität klären, bevor neue Starts freigegeben werden |
| T3 meldet Fehler oder bestätigten Abbruch | Run wird `failed` beziehungsweise `cancelled` und die nächste Phase wird nach Policy geprüft |

Ein beobachteter Lauf erhält dieselbe gespeicherte Thread-/Runreferenz. Ein neuer bewusster Versuch bekommt eine neue Attempt- und Request-ID. Bei unklarer externer Aktivität entscheidet der Eigentümer über die Wiederherstellung, statt einen möglichen Parallelstart zu riskieren.

## Verträge und Quellen

Wie du den Falkenwarte-Skill im Zielprojekt installierst und den MCP-Zugang für deinen Agenten einrichtest, erklärt [Agent-Skill installieren](user/AGENT_SKILL.md).

- [OpenAPI-Vertrag](../contracts/openapi.yaml): Verbindungen, OAuth-Callback, Projektbindungen und Run-/Recovery-Operationen.
- [T3-MCP-Bridge](../src/Orchestration/Infrastructure/T3McpBridge.php), [Session-Factory](../src/Orchestration/Infrastructure/T3McpSessionFactory.php), [RunHandler](../src/Orchestration/Application/RunHandler.php) und [Bridge-Manifest](../packages/t3-mcp-bridge/manifest.json).
- [Symfony MCP Bundle](https://symfony.com/doc/current/ai/bundles/mcp-bundle.html) liefert MCP-Transport- und Sitzungsbausteine. OAuth bleibt in Falkenwartes eigenem [T3OAuthAuthenticator](../src/Orchestration/Infrastructure/T3OAuthAuthenticator.php).
- [T3-MCP-Verträge, v0.1.10](https://github.com/pingdotgg/t3code/blob/v0.1.10/packages/contracts/src/orchestratorMcp.ts) und [T3-OAuth-Implementierung, v0.1.10](https://github.com/pingdotgg/t3code/blob/v0.1.10/apps/server/src/auth/McpOAuth.ts).
- [MCP-Protokollprofil 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18).
