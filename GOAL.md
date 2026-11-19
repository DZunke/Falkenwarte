# /goal - Falkenwarte implementieren

## Auftrag

Implementiere Falkenwarte als private Single-User-Steuerplattform für eine bestehende T3-Code-Instanz. Verwende dieses Paket als verbindlichen Konzept- und Vertragsstand 2.0. Arbeite M0 bis M6 in lauffähigen Schritten ab und halte Entscheidungen und echte Prüfergebnisse im Repository fest.

Lies zuerst README.md und FALKENWARTE_KONZEPT.md, danach docs/AI_DECISIONS.md, docs/T3_INTEGRATION.md, docs/TESTING.md, docs/GITHUB_DELIVERY.md, docs/PLUGIN_SYSTEM.md, docs/LIVE_SERVICES.md, docs/DOCUMENTATION.md, docs/OPERATIONS.md und docs/SOURCES.md. Beachte docs/domain, docs/adr, contracts, qa und acceptance/ACCEPTANCE.md. mockups/falkenwarte.html ist die visuelle Spezifikation mit Demo-Daten.

## Verbindliche Grenzen

- Projekt- und Produktname: Falkenwarte. Zielbetrieb ausschließlich Linux.
- Ein produktiver App-Container mit FrankenPHP, Mercure, Symfony, Workern, SQLite, statischen React-Assets und Dokumentation. Zusätzliche Mock-/Runnerdienste sind nur im Testprofil zulässig.
- Symfony 7.4 LTS / PHP 8.5 als recherchierte Ausgangsbasis; kompatible Abhängigkeiten tatsächlich auflösen und fixieren.
- DDD und Clean Architecture als modularer Monolith. Doctrine DBAL und Migrationen, kein Doctrine ORM.
- React/TypeScript/Vite/Tailwind mit echten shadcn/ui-Komponenten; vollständig typisierter JSON-Client. UI und MCP verwenden dieselben Application-Handler.
- Domain Events, Action-Lebenszyklus, dauerhafte Commands, atomare History/Outbox und Inbox-Deduplizierung.
- Falkenwarte steuert T3; Provider, Modelle, Homes, Arbeitsbereiche und Codezugriff gehören T3 und den Agents. Keine Repository-, GitHub-/GitLab-/Jira- oder CI-Integration in der App.
- Link-Collections sind reine registrierte Referenzen. Kein serverseitiges Abrufen, kein PR-Status, kein Merge, keine unabhängige Test-/Codeverifikation.
- GitHub hostet den eigenen Falkenwarte-Quellcode und dessen QA-/Releasepipeline. Dieser Entwicklungszugriff gehört nicht in das Produkt.
- Nicht manuelle Tickets durchlaufen OpenAI Decisions zur Einordnung. Verwende die tatsächliche Decisions API, nicht Jev und nicht stillschweigend Responses API. Die Symfony-AI-Anbindung folgt DecisionGateway → SymfonyAiDecisionAdapter → PlatformInterface. Prüfe den vom Nutzer gewählten PR #2956 und seine Releaseverfügbarkeit. Verwende bis zu einer kompatiblen nativen Veröffentlichung eine schmale Erweiterung im eigenen Namespace; keine ungeprüften PR-Klassen als veröffentlichte API voraussetzen.
- Labels besitzen stabile Identität, Name, Farbe und Beschreibung. Topiclabels klassifizieren Themen; Workflowlabels wählen versionierte Routen. Attentionlabels bilden systemseitige Handlungs-/Wartezustände ab. Mensch erforderlich folgt ausschließlich offenen Eigentümergründen; eine Rückfrage an Agent bleibt getrennt.
- Agents dürfen ihre Pflichtklassifikation nicht durch origin=manual umgehen. KI kann keine Berechtigungen oder menschlichen Freigaben erteilen.
- Ein fehlender OpenAI- oder T3-Zugang verhindert den Aufbau gegen realistische Mocks nicht. Echte Integrationsnachweise bleiben sichtbar offen.

## Testvertrag

Die Produktabdeckung erfolgt ausschließlich durch Playwright-E2E gegen die gestartete Anwendung und ihre öffentlichen Browser-/JSON-/MCP-Schnittstellen. Keine Unit-, Component- oder allgemeinen Backend-Funktionstests anlegen. Keine isolierten Domain-/Controllerprüfungen als E2E umbenennen.

Einzige Ausnahme: eng begrenzte Backend-Funktionstests für Hintergrundaufgaben wie Messenger, Outbox, Reconciliation, Scheduler und Decisions-Jobs. Statische QA mit Formatierung, PHPStan, TypeScript, Schemas und Dokumentationslinks ist weiterhin gewollt.

E2E verwendet echte DB, Worker und Mercure. T3 wird durch einen zustandsbehafteten MCP-Servermock ersetzt; ein Agent-Simulator spricht den echten Falkenwarte-MCP-Server an. OpenAI Decisions wird am HTTP-Rand simuliert. Browserroute-Mocks allein reichen nicht. Deterministische Fixtures und isolierte Testzustände sind Pflicht. Eine interne FakeBridge ersetzt nicht die abschließende E2E-Ausführung über den echten T3-MCP-Adapter zum Mockserver.

## M0 - Grundlage

Lege den Symfony-/React-Projektaufbau an. Löse Composer/npm-Abhängigkeiten auf, fixiere Lockdateien und Images, prüfe ORM-Abwesenheit sowie SQLite-/Mercure-Versionen. Validiere Verträge und korrigiere Abweichungen zusammen mit Dokumentation und ADR. Richte GitHub-QA, Conventional Commits, Dokumentationsstruktur und Testnetz mit Fixtureprofilen ein. Prüfe die tatsächlich ausgewählte MCP-Protokollrevision.

## M1 - Menschlich bedienbarer Kern

Implementiere Projekte, Tickets, Status, Kriterien, Boards, konfigurierbare Labels, Link-Collections, Actions und History. Liefere echte shadcn-Ansichten über den generierten API-Client. Menschliche Aufgaben müssen ohne Agent-Run abschließbar sein. Erste E2E-Szenarien prüfen komplette Nutzervorgänge einschließlich Konflikten und Projektgrenzen.

## M2 - MCP und Decisions-Intake

Implementiere technische Principals, MCP-Werkzeuge, dauerhafte Eingangsprüfung und die OpenAI-Decisions-Bridge. Fixiere Fragen-/Taxonomie-/Ticketrevisionen. Implementiere Rückfragen an den meldenden Agenten, menschlichen Entscheidungsbedarf bei entsprechenden Gründen, Labels und versioniertes Routing. Prüfe den vollständigen Ablauf gegen echte Netzwerkgrenzen mit MCP-/Decisions-Mocks.

## M3 - T3 und Übergaben

Implementiere Verbindung und Rollenreferenzen. T3-Projektstandard beziehungsweise bestehender T3-Referenzthread werden aufgelöst; es entsteht kein Modell-/Providereditor. Speichere die gesendete Dispatch-Payload unveränderlich. Im Referenzthread-Modus sind Routingwerte aufgelöst; beim Projektstandard entscheidet T3 erst bei erster Annahme über seine wirksame Auswahl. Friere keine zuvor unbekannte effektive Defaultkonfiguration ein. Nutze keyed Launch mit Initialmessage, kurze Beobachtung, Ergebnismeldung, Rückfrage und Abbruch. Prüfe verlorene Antworten, früh eintreffende Reports, neue OAuth-Sitzung und Neustart.

## M4 - Workflows und Sichtbarkeit

Implementiere phasenbezogene Run-Abschlüsse, getrennten Ticketabschluss, begrenzte Folgerunden, menschliche Entscheidungen, private Mercure-Updates und Metriken mit erkennbarer Datenherkunft. Agentmeldungen bleiben als solche erkennbar. Konfigurierte Workflowlabels ersetzen keine Startberechtigung.

## M5 - Erweiterbarkeit und Wissen

Implementiere Manifest, Registry, Capability-Gates, Migrationen, Drain und UI-Beiträge. Verwende ein kleines scopekonformes Beispielplugin, die im Manifest beschriebene lokale Linknotiz-Erweiterung. Halte Fachsprache, Context Map, Bounded Contexts, Lebenszyklen, Events und ADRs mit dem implementierten Stand synchron. Liefere den lesbaren statischen Dokumentationsbereich.

## M6 - Release und Betrieb

Vervollständige Release Please, GitHub-Checks, nachvollziehbare Versionen und den Release aus einem geprüften Commit. Baue ein reproduzierbares App-Image. Implementiere Backup/Restore, Migrationssperre, Supervisorverhalten und Betriebsdokumentation. Nach Restore werden externe T3-Aufträge abgeglichen. Führe die fachlichen E2E-Abnahmen und erlaubten Background-Funktionstests aus.

## Fertigstellung

Verknüpfe jede Anforderung aus requirements.json mit Umsetzung, Dokumentation und Abnahme. Berichte tatsächliche Befehle und Ergebnisse, keine erwarteten oder simulierten Erfolge. Behaupte weder Live-Verbindungen noch echte Browserprüfungen ohne deren Durchführung. Normale Implementierungsentscheidungen triffst du innerhalb dieser Vorgaben selbst; nur konkret blockierende Unklarheiten werden zurückgefragt.
