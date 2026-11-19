# Qualität durch vollständige Abläufe

**Verbindlicher Testvertrag für Falkenwarte, Stand 19. November 2026.** Die fachliche Abdeckung entsteht durch End-to-End-Szenarien mit Playwright. Es werden keine Unit-, Component-, isolierten Domain-, Repository-, Controller- oder allgemeinen Symfony-Functional-Tests angelegt. Die ausdrücklich zugelassene Ausnahme sind Backend-Funktionstests für Background-Tasks.

Die Playwright-Projekte liegen unter `tests/e2e`; Fixtures, externe Netzwerk-Mocks und die Szenariovorlagen liegen unter `qa/`. Tatsächliche Ergebnisse stehen in [VALIDATION.md](VALIDATION.md) und im erzeugten Laufbericht `qa/results.json`. Die Szenariobeschreibung allein ist kein Nachweis eines bestandenen Ablaufs.

## 1. Was End-to-End hier bedeutet

Ein Szenario betritt das laufende Produkt über seine tatsächlichen Grenzen: Browser, JSON-HTTP-API oder MCP. Es durchläuft die echte Symfony-Anwendung, Autorisierung, Application-/Domain-Regeln, DBAL, SQLite, Hintergrundverarbeitung und gegebenenfalls Mercure. Ergebnisse werden über Benutzeroberfläche oder öffentliche Schnittstellen geprüft. Der Test ruft keinen Command-Handler direkt auf und ersetzt kein Repository durch einen Mock.

Playwright ist der produktweite E2E-Runner. Browserabläufe und MCP-/API-Clientabläufe können in demselben Szenario zusammenwirken. Die eingebaute Request-Fixture erlaubt echte HTTP-Aufrufe, zum Beispiel eine Agent-Meldung an `/mcp`, deren Ergebnis anschließend im Board sichtbar wird. Dies ist ein vollständiger Ablauf am laufenden Produkt, keine nachträglich als E2E bezeichnete isolierte Methodenprüfung. [Playwright API testing](https://playwright.dev/docs/api-testing)

Die Anwendung besitzt einen Eigentümer, aber getrennte technische Principals. Fixtures bilden diese Zugangswege ab; ein Test darf nicht alle Aufrufe mit dem Owner-Token ausführen und daraus funktionierende Agent-Berechtigungen ableiten.

## 2. Testumgebung

| Bestandteil | Verhalten im E2E-Lauf |
|---|---|
| Falkenwarte | Produktnahes Linux-Image mit denselben gebauten Frontend-Assets und Backend-Abhängigkeiten |
| SQLite | Echte Datenbank auf einem isolierten Testvolume |
| Messenger und Maintenance | Echte Prozesse, kontrollierbare Arbeits- und Beobachtungszyklen |
| Mercure | Echter integrierter Hub mit Testschlüsseln und vertrauenswürdiger Test-CA |
| T3 | Zustandsbehafteter HTTP-/MCP-Testdienst außerhalb des App-Containers |
| Agent-Rückweg | Playwright-Agent-Simulator ruft Falkenwartes echten MCP-Server auf |
| OpenAI Decisions | Separater HTTP-Testdienst mit festgelegten Antworten und Fehlern |
| GitHub/GitLab/Jira | Kein Dienst und kein API-Zugang; nur inerte Link-Fixtures |

Zusätzliche Mock- und Runner-Container gehören ausschließlich zur QA-Umgebung. Die produktive Anwendung benötigt weiterhin genau einen App-Container. Der produktive Runtime-Build enthält keine Fixture-Loader, Reset-Routen, Fault-Injection-Controller oder Mock-Credentials.

Das E2E-Netz erlaubt ausschließlich die definierten Testdienste. Ein Test benötigt weder einen echten T3-/Provider-Zugang noch einen OpenAI-Key. Ein versehentliches Fallback auf reale URLs muss fehlschlagen. Derselbe Schutz gilt für jeden einzelnen PHP-Worker, nicht nur für den Browser.

## 3. Fixtures und Isolation

Die Ausgangsdaten sind versionierte, kleine Fixtures: zwei Projekte mit verschiedenen Rechten, definierte Statuswerte, Kategorien, Topic-/Workflow-/Attention-Labels, Aufgaben mit unterschiedlichem Informationsstand, ein T3-Binding und benannte Link-Collections. IDs und fachliche Zeiten sind reproduzierbar. Berechnungen verwenden einen Test-Clock-Port; Retry-/Netzwerkfristen dürfen durch den Harness separat beschleunigt werden.

Ein BrowserContext isoliert Cookies und lokalen Browserzustand, jedoch nicht automatisch die serverseitige Datenbank. Daher erhält jeder Playwright-Worker einen eigenen Stack beziehungsweise einen eindeutigen Satz aus Volume, Ports, Mockjournal und Fixture-Namespace. Innerhalb eines Workers werden Szenarien seriell mit vollständigem Reset ausgeführt. Parallelisierung erfolgt erst, wenn diese serverseitige Isolation nachgewiesen ist. [Playwright Isolation](https://playwright.dev/docs/browser-contexts), [Fixtures](https://playwright.dev/docs/test-fixtures)

Der Test-Harness hält Worker an, setzt die Datenbank über den ausschließlich im QA-Image verfügbaren Fixture-Loader zurück, leert Inbox/Outbox und Mockzustand, lädt das Szenario und startet die Prozesse wieder. Der spätere Commandname wird bei Implementierung festgelegt; das Konzept behauptet keinen bereits vorhandenen Symfony-Command.

Fixtures sind fachlich zusammenhängend. Ein Szenario zum Intake enthält einen unvollständigen Titel-/Beschreibungskontext und erwartete Rückfragen. Ein Szenario zur Linkregistrierung enthält einen gültigen Agent-Principal und eine vorhandene Collection. Es gibt keine riesige zufällige Datenbank, von deren zufälliger Reihenfolge Tests abhängen.

## 4. MCP-Traffic wird an der Servergrenze ersetzt

Playwrights `page.route()` kann Browseranfragen ersetzen. Die ausgehenden Requests eines Symfony-Workers zu T3 laufen dagegen außerhalb des Browsers. Deshalb prüft ein Board mit ausschließlich gemockten Browserantworten die T3-Anbindung nicht. Der produktive MCP-Client zeigt im E2E-Betrieb auf einen echten HTTP-Testdienst. [Playwright Mock APIs](https://playwright.dev/docs/mock)

Der MCP-Testdienst muss folgende Eigenschaften besitzen:

1. JSON-RPC-IDs korrekt spiegeln und Benachrichtigungen ohne erfundene Resultat-ID behandeln.
2. Den vereinbarten Protokolldialekt einschließlich HTTP-Headern, Lebenszyklus und Sessionverhalten umsetzen.
3. `tools/list` mit den benötigten Werkzeugnamen und Eingabeschemas liefern.
4. `tools/call` mit `content`, passendem `structuredContent` und tatsächlichen Fehlerformen beantworten.
5. HTTP-Fehler, JSON-RPC-Fehler und `isError:true` als unterschiedliche Fälle darstellen.
6. Zustände, angenommene Aufträge, Request-Identitäten und Beobachtungen über mehrere Requests behalten.
7. Ein Journal erwarteter und unerwarteter Aufrufe führen; nicht gematchte Requests schlagen ausdrücklich fehl.

### Zwei klar getrennte Protokollprofile

Der geprüfte T3-Stand `v0.1.10` unterstützt `2025-06-18` und `2026-07-28`. Das konkrete Legacy-Beispiel im Paket verwendet ausdrücklich **2025-06-18** mit `initialize`, `notifications/initialized`, `Mcp-Session-Id` und anschließenden Toolaufrufen. Dieses Profil muss der tatsächliche Symfony-MCP-Client ausdrücklich verwenden können.

Das neuere T3-Profil verwendet `server/discover` und eine zustandslose Protokollform mit eigener Metadaten-/Headerstruktur. Es wird nicht durch das Austauschen einer Versionszeichenfolge in einem Legacy-Handshake simuliert. Wird dieses Profil in M0 gewählt, erhält es einen eigenen bestätigten Fixture-Satz. Bis dahin darf kein automatischer Protokollwechsel einen grünen Test erzeugen. Quellen: [T3 HTTP-Transport](https://github.com/pingdotgg/t3code/blob/v0.1.10/apps/server/src/mcp/McpHttpServer.ts), [Transportnachweise im T3-Repository](https://github.com/pingdotgg/t3code/blob/v0.1.10/apps/server/src/mcp/McpHttpServer.test.ts).

MCP-Session-ID und OAuth-Authentifizierungsnamespace sind verschiedene Identitäten. Ein neuer HTTP-/MCP-Handshake bei demselben Bearer muss nicht automatisch eine neue fachliche Idempotenzgrenze bedeuten. Das Szenario einer neuen OAuth-Autorisierung wechselt den Auth-Namespace ausdrücklich.

### Verlorene Antwort nach angenommener Arbeit

Der Mock speichert zuerst die Launch-Wirkung unter Auth-Namespace und `clientRequestId` und schließt erst danach die Verbindung ohne Antwort. Beim erneuten unveränderten Request liefert er dieselben Thread-/Run-Referenzen. Ein statischer Stub, der beim ersten Request nur einen Timeout und beim zweiten einen beliebigen Erfolg liefert, prüft diese Eigenschaft nicht.

Der Mock bildet dabei T3s Verhalten ab und darf nicht stillschweigend stärkere Garantien liefern. Die unveränderte Payload und ihr Hash werden von Falkenwarte erzwungen. Der Test beobachtet die eingehenden Requests im Mockjournal. Auch bei einem neuen OAuth-Namespace bleibt Falkenwartes ungeklärter alter Start sichtbar und wird zuerst abgeglichen.

## 5. Agent-Simulator und Decisions-Mock

Der Agent-Simulator initialisiert eine eigene Verbindung zu Falkenwartes echtem `/mcp`, authentifiziert sich als projektgebundener technischer Principal und verwendet die veröffentlichten Tools. Er erstellt ein Ticket, liest den Intake-Ausgang, ergänzt angeforderte Angaben und registriert Quellen- oder PR-/MR-Links. Direkte Datenbankänderungen ersetzen diese Arbeit nicht.

Ein fehlender fachlicher Hinweis wird als `needs_information` mit konkreten Fragevorlagen ausgegeben. Ein noch laufender Intake liefert `accepted` und einen nachverfolgbaren Status. Ein solcher Geschäftsausgang ist kein JSON-RPC-Protokollfehler. Die genauen Feldnamen folgen `contracts/mcp-tools.json` und `docs/AI_DECISIONS.md`.

Der Decisions-Mock prüft die native HTTP-Requestform, das erlaubte Modell, Fragenamen und die konkrete Taxonomieversion. Er liefert feste `predicate`-/`choice`-/`score`-Antworten, einzelne Refusals oder Transportfehler. Falkenwartes eigentliche Klassifikations- und Routingregeln laufen real. Ein Test darf nicht bereits das fertige Falkenwarte-Ticket als vermeintliche OpenAI-Antwort zurückgeben.

Pflichtfälle sind Informationsmangel, eindeutige Klassifikation, mehrdeutiges Workflowlabel, Refusal, 429 mit Retry, Timeout, ausgeschöpftes Budget sowie eine zwischenzeitlich geänderte Ticket- oder Taxonomieversion. Ein strukturiert erkanntes Refusal führt zur menschlichen Entscheidung. Ein nicht typisierbarer SDK-/Konvertierungsfehler führt dagegen zu `classification_unavailable`; Exceptiontexte dienen nicht als Klassifikator. Eine veraltete Antwort überschreibt keine neuere menschliche Entscheidung. Ein Default-Erfolg bei API-Ausfall ist unzulässig.

## 6. Umfang der Szenarien

`acceptance/ACCEPTANCE.md` enthält die normativen End-to-End-Abläufe. `qa/scenarios.json` benennt ihre Testdaten und externen Störungen. Der QA-Runner speichert je Szenario die Anforderungs-/Abnahme-IDs. Abdeckung bedeutet hier nachvollziehbare **fachliche Szenarioabdeckung**, nicht einen vorgeschriebenen Prozentwert für Methoden oder Zeilen.

Kernabläufe laufen auf jedem Pull Request mit Chromium. Relevante weitere Browser und die mobile Bedienung werden als festgelegte E2E-Projekte vor Release geprüft. Es werden keine flächendeckenden Screenshot-Snapshots jeder kleinen Komponente verlangt. Ein visueller Vergleich ist sinnvoll, wenn er einen konkreten Darstellungsfehler absichert.

Tests warten auf sichtbare Zustände beziehungsweise begrenztes Polling, nicht auf feste lange Sleeps. Ein einmaliger Retry dient der Diagnose; ein nur beim Wiederholen erfolgreicher Fall wird als flaky sichtbar und erfüllt das Release-Gate nicht stillschweigend. Traces, Screenshots, gefilterte Prozesslogs und das Mockjournal helfen, Fehler entlang des vollständigen Ablaufs zu finden.

## 7. Einzige Ausnahme: Background-Task-Funktionstests

Unter `tests/BackgroundFunctional` dürfen gezielte Symfony-/PHP-Funktionstests für Messenger-Consumer, Outbox-/Inbox-Verarbeitung, Wiederholungen, Leases, Reconciliation, Projektionen und Decisions-Hintergrundjobs entstehen. Sie verwenden den tatsächlichen Kernel, echte DBAL-Persistenz und den externen Traffic-Mock. Ein PHPUnit-basierter Runner ist dafür zulässig, jedoch nur innerhalb dieser ausdrücklich benannten Suite.

Geprüft werden beispielsweise ein Prozessabbruch zwischen Commit und Publish, doppelte Nachrichtenzustellung, ein abgelaufenes Lease oder ein überholter Klassifikationsjob. Diese Fälle sind wertvoll, wenn ein rein zeitgesteuerter Browsertest unnötig unzuverlässig wäre.

Die Ausnahme eröffnet keine allgemeine Backend-Testsuite. Ein isolierter Task-Aggregat-Test, Controller-Test oder Repository-Test wird nicht durch Umbenennen zum Background-Test. Benutzerseitige Folgen dieser Jobs bleiben zusätzlich durch die betreffenden E2E-Abläufe abgedeckt.

## 8. Statische Qualitätsprüfungen

Formatierung, PHPStan, TypeScript, ESLint, Composer-Validierung, Abhängigkeits- und Lizenzprüfung, OpenAPI-/JSON-Schema-Validierung, generierte Clienttypen sowie Dokumentationslinks sind statische Prüfungen. Sie starten keine verdeckte zusätzliche Laufzeittestebene.

Eine statische Abhängigkeitsregel prüft die Domain-Grenzen und die ORM-Abwesenheit. Eine Dokumentationsregel verlangt bei fachlichen Änderungen aktualisierte Kontext-/Lifecycle-/Vertragsdokumente oder eine konkrete, überprüfbare Begründung im Pull Request. Die fachliche Abnahme bleibt E2E.

## 9. Ehrlicher Nachweis

Ein grüner E2E-Lauf mit Traffic-Mocks belegt Falkenwartes Verhalten gegen den fixierten externen Vertrag. Er belegt keinen erfolgreichen Zugriff auf eine reale private T3-Instanz. Der erstmalige reale Handshake und ein vereinbarter kleiner T3-Rundlauf sind gesonderte Integrationsnachweise in M0/M3, ebenfalls als zusammenhängende äußere Abläufe und ohne neue Unit-/Functional-Suite.

Falkenwarte führt selbst keine fremden Repositorytests aus, liest keinen Quellcode und bestätigt keinen PR-Zustand. E2E-Fixtures prüfen diese Grenze: Ein gemeldeter Link bleibt eine Agentenreferenz; eine menschliche Annahme bleibt eine protokollierte menschliche Entscheidung.
