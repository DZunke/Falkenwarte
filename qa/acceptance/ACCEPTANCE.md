# Abnahme von Falkenwarte

**Gepflegte Prüfspezifikation.** Diese Fälle beschreiben die erwarteten Produktabläufe und Qualitätsgates. Ihre Beschreibung ist kein Nachweis bereits ausgeführter Anwendungstests; historische Ergebnisse stehen getrennt unter [qa/evidence/](../evidence/README.md).

Die fachliche Laufzeitabdeckung erfolgt ausschließlich End-to-End mit Playwright gegen das laufende Produkt. Browser-, JSON- und MCP-Aktionen dürfen in einem zusammenhängenden Szenario kombiniert werden. A03 und die Dokumentations-/Lieferkettenregeln sind statische beziehungsweise operative Qualitätsnachweise. Nur für Background-Tasks sind ergänzende Backend-Funktionstests ausdrücklich erlaubt; Details stehen in docs/TESTING.md.

<a id="a01"></a>
## A01 - Projektidentität und Archivierung

**Gegeben:** Zwei Projekte mit verschiedenen Namen, Icons und Farben.  
**Wenn:** Der Eigentümer ändert ein Projekt und archiviert es über die Oberfläche.  
**Dann:** Listen, Suche, Board und Dashboard zeigen dieselbe Identität. Das andere Projekt bleibt unverändert. Archivierung verhindert neue automatische Starts; Aufgaben und Historie bleiben lesbar.

<a id="a02"></a>
## A02 - Projektgrenzen über UI, JSON und MCP

**Gegeben:** Ein technischer Principal darf nur Projekt A bearbeiten.  
**Wenn:** Er liest oder verändert über HTTP und MCP eine Aufgabe, Intake-Antwort oder Link-Collection aus Projekt B.  
**Dann:** Beide Wege verweigern Zugriff und Mutation. Listen, Historie und Live-Topics geben keine Daten aus B preis. Der Eigentümer behält seinen Gesamtzugang.

<a id="a03"></a>
## A03 - Architektur und ORM-Abwesenheit

**Gegeben:** Dependency-Graph, Quellstruktur und öffentliche Verträge.  
**Wenn:** Die statische Qualitätsprüfung läuft.  
**Dann:** Es gibt keine ORM-Laufzeitabhängigkeit und keine verbotenen Schichtimporte. Diese Abnahme ist eine statische Regelprüfung, keine Unit-/Architekturtest-Suite mit ausgeführtem Domain-Code.

<a id="a04"></a>
## A04 - Eine Änderung mit vollständiger Historie

**Gegeben:** Eine Aufgabe und ein aktivierter testexklusiver Commit-Fehlerpunkt.  
**Wenn:** Eine Änderung wird einmal erfolgreich und einmal mit einem Fehler vor Commit über die echte API ausgeführt.  
**Dann:** Erfolgreicher Zustand, neue Revision, Ereignis und Actionausgang stimmen überein. Der abgewiesene Versuch hinterlässt keine halbe fachliche Revision. Nach Neustart bleibt der sichtbare Zustand konsistent.

<a id="a05"></a>
## A05 - Angenommene Hintergrundarbeit überlebt Unterbrechung

**Gegeben:** Eine dauerhaft angenommene Action und der echte Worker.  
**Wenn:** Der Test-Harness beendet den Worker an einer definierten Commit-/Publish-Grenze und startet ihn wieder; dieselbe Nachricht wird erneut zugestellt.  
**Dann:** Der Command ist wiederaufnehmbar. Lokale Wirkung und Folgezustand entstehen genau einmal; nötige externe Zustellung ist dedupliziert. Für diese Background-Grenze ist ergänzend ein Backend-Funktionstest zulässig.

<a id="a06"></a>
## A06 - Objektverlauf und Wiederherstellung

**Gegeben:** Mehrere Aufgabenrevisionen, darunter inzwischen deaktivierte Pluginfelder.  
**Wenn:** Der Eigentümer liest den Verlauf und stellt einen erlaubten früheren fachlichen Zustand wieder her.  
**Dann:** Die alte Revision bleibt erhalten; eine neue Revision mit Akteur und Ursache entsteht. Externe Agentarbeit wird nicht als rückgängig gemacht ausgegeben. Secrets fehlen im Verlauf.

<a id="a07"></a>
## A07 - Mehrere Boards mit denselben Aufgaben

**Gegeben:** Zwei Boards mit unterschiedlichen Filtern und Reihenfolgen.  
**Wenn:** Eine Aufgabe wird per UI verschoben und in einem Board umgeordnet.  
**Dann:** Der fachliche Status stimmt in beiden Ansichten. Die Reihenfolge des anderen Boards bleibt unabhängig. Eine Sammelspalte verwendet ihren ausdrücklich festgelegten Zielstatus.

<a id="a08"></a>
## A08 - Gleichzeitige Änderungen und harte Grenzen

**Gegeben:** Eine freie WIP-Position und zwei gleichzeitig arbeitende Clients.  
**Wenn:** Beide versuchen per UI-/MCP- oder HTTP-Aufruf, diese Position zu belegen; ein Client verwendet eine veraltete Version.  
**Dann:** Die WIP-Grenze wird transaktional durchgesetzt und der Versionskonflikt sichtbar. Fehlende board_id, geänderte Filterfelder oder neue Boardregeln umgehen die Grenze nicht. Gleichzeitig angelegte Abhängigkeiten bilden keinen Zyklus.

<a id="a09"></a>
## A09 - T3-Adapter mit echtem HTTP-Verkehr

**Gegeben:** Die laufende Anwendung mit produktivem MCP-Client und externem T3-Mock.  
**Wenn:** Ein Auftrag wird angefordert; anschließend meldet der Mock eine unbekannte Fähigkeit oder einen unbekannten Zustand.  
**Dann:** Die tatsächliche Adapter-/MCP-Strecke wird durchlaufen. Nicht verfügbare Aktionen werden erklärt; unbekannter Zustand wird nie als Erfolg behandelt. Kein direkter Handleraufruf ersetzt den Ablauf.

<a id="a10"></a>
## A10 - Launch angenommen, Antwort verloren

**Gegeben:** Der T3-Mock persistiert einen Launch unter stabilem Key und Auth-Namespace.  
**Wenn:** Er schließt die Verbindung nach Annahme, bevor die Antwort Falkenwarte erreicht.  
**Dann:** Der Retry enthält unveränderten Auftrag und denselben Key. Der Mock liefert dieselben Thread-/Run-Referenzen; genau eine externe Launch-Wirkung besteht. Ein Timeout erzeugt keinen neuen fachlichen Auftrag.

<a id="a11"></a>
## A11 - Neue Autorisierung bei ungeklärtem Auftrag

**Gegeben:** Ein ungeklärter Launch aus Auth-Generation 1.  
**Wenn:** Der Test wechselt ausdrücklich in OAuth-Namespace 2 und setzt die Bearbeitung fort.  
**Dann:** Falkenwarte setzt keine globale Idempotenz voraus. Es gleicht alte Referenzen und korrelierte Threads ab. Mehrdeutigkeit bleibt sichtbar und verhindert blinde Doppelstarts. Ein bloßer neuer MCP-Handshake wird davon unterschieden.

<a id="a12"></a>
## A12 - Agentbericht, menschliche Annahme und Phasenabschluss

**Gegeben:** Ein Agentbericht für einen konkreten Run und eingefrorenen Aufgabenstand.  
**Wenn:** Der Bericht wird doppelt, für einen falschen Versuch oder mit fehlenden geforderten Angaben gemeldet.  
**Dann:** Doppelte Meldungen sind dedupliziert; falsche Zuordnung wird abgewiesen. Bericht und externe Beobachtung bleiben getrennt. Falkenwarte behauptet weder gelesenen Code noch ausgeführte Tests. Ein Implementierungslauf kann den Review auslösen, bevor die Gesamtaufgabe ihre strengere Abschlussregel erfüllt. Menschlich bearbeitete Aufgaben benötigen keinen erfundenen Run.

<a id="a13"></a>
## A13 - Gemeinsame Regeln für JSON und MCP

**Gegeben:** Derselbe Task, Principal und fachliche Änderungsauftrag.  
**Wenn:** Die Änderung wird über JSON und MCP in getrennten identischen Fixture-Stacks ausgeführt.  
**Dann:** Version, Fachregel, Historie und Fehlersemantik stimmen überein. Ein asynchrones Receipt ist über Actions beziehungsweise Intake eindeutig nachverfolgbar. MCP erlaubt keine fremde menschliche Freigabe.

<a id="a14"></a>
## A14 - Veraltete Oberfläche und Konflikt

**Gegeben:** Ein geöffnetes Task-Sheet und eine parallele Agentänderung.  
**Wenn:** Der Mensch speichert die alte Revision oder ein optimistischer Board-Move wird abgewiesen.  
**Dann:** Ein verständlicher Konflikt erscheint und der aktuelle Serverstand wird geladen. Eine abgelehnte Änderung bleibt nicht als Erfolg sichtbar.

<a id="a15"></a>
## A15 - Private Live-Aktualisierung und Wiederverbindung

**Gegeben:** Zwei autorisierte UI-Kontexte mit passenden privaten Topics und getrennten Publish-Rechten.  
**Wenn:** Ein Update entsteht, die Verbindung wird getrennt, der Subscriber läuft ab oder der Replaypuffer wird geleert.  
**Dann:** Erlaubte Ansichten laden die aktuellen JSON-Daten nach; unberechtigte Topics bleiben gesperrt. Reconnect und Cookieerneuerung funktionieren ohne JWT im JavaScript. T3- und Publish-Secrets erreichen den Browser nicht.

<a id="a16"></a>
## A16 - Kennzahlen mit nachvollziehbarer Herkunft

**Gegeben:** Ein deklarierter Fixture-Verlauf mit Abschlüssen, Wiedereröffnung, Blockaden, Abbrüchen und unbekannten Providerwerten.  
**Wenn:** Projekt- und Gesamtmetriken werden angezeigt; eine Projektion wird neu aufgebaut.  
**Dann:** Definitionen, Median, Stichprobe und Datenstand stimmen. Unbekannte Kosten bleiben unbekannt. Ein Rebuild startet keine Agents und bestätigt keine externen Tests oder PR-Zustände.

<a id="a17"></a>
## A17 - Installiertes Plugin aktivieren und deaktivieren

**Gegeben:** Ein im QA-Image installiertes kleines Beispielplugin mit eigener Fähigkeit und UI-Beitrag.  
**Wenn:** Der Eigentümer aktiviert, benutzt, deaktiviert und erneut aktiviert es.  
**Dann:** API, MCP und UI beachten denselben Zustand. Historie und vorhandene Daten bleiben lesbar. Die neue Fähigkeit benötigt keine Änderung der Core-Domain.

<a id="a18"></a>
## A18 - Plugin mit laufender Arbeit deaktivieren

**Gegeben:** Ein aktiver Run verwendet eine Bridge und ein weiteres Plugin hängt von ihr ab.  
**Wenn:** Deaktivierung wird angefordert.  
**Dann:** Neue Starts enden, vorhandene Arbeit bleibt beobachtbar. Abhängigkeiten und ungeklärte Ausführung blockieren den Abschluss. Eine lokale Aufgabeentscheidung behauptet keine externe Beendigung.

<a id="a19"></a>
## A19 - Produktionsbetrieb auf Linux

**Gegeben:** Ein frischer Checkout, gepinnte Abhängigkeiten und ein persistentes Volume.  
**Wenn:** Das Produktionsimage wird gebaut und gestartet.  
**Dann:** Genau ein App-Service enthält Symfony/FrankenPHP, Mercure, statisches Frontend, Worker, Maintenance und SQLite. Fixture-/Mockdienste und Teststeuerung fehlen in Produktion. Ein T3-Ausfall wird als Verbindungsproblem angezeigt.

<a id="a20"></a>
## A20 - Neustart und Restore mit externer Arbeit

**Gegeben:** Ein externer Run sowie ein Backup, das spätere Starts noch nicht kennt.  
**Wenn:** Die App startet neu beziehungsweise wird bei angehaltenen Workern wiederhergestellt.  
**Dann:** Bekannte und seit dem Backup entstandene zuordenbare externe Arbeit werden abgeglichen. Neue automatische Starts bleiben bis zur geklärten Inventur gesperrt. Versions-/Plugin- und Datenintegrität werden geprüft.

<a id="a21"></a>
## A21 - Menschlich bedienbare Oberfläche

**Gegeben:** Desktop, mobile Breiten, vergrößerter Text und Tastaturbedienung.  
**Wenn:** Tickets, Labels und Links werden erstellt, gefiltert und bearbeitet; Entscheidungen werden geöffnet.  
**Dann:** Fokus, Dialoge, Tastaturalternativen und verständliche Fehler funktionieren. Die Oberfläche zeigt nur implementierte Produktfähigkeiten. Providerkonfiguration, Codeansicht, Testausführung und PR-Merge werden nicht angeboten.

<a id="a22"></a>
## A22 - Pflichtklassifikation nicht manueller Eingänge

**Gegeben:** Ein technischer Principal meldet ein Ticket mit vollständigen Angaben über MCP oder JSON.  
**Wenn:** Der echte Intake-/Backgroundpfad verwendet den nativen Decisions-HTTP-Mock.  
**Dann:** Ein dauerhaftes Receipt, Themenkategorie und passende konfigurierte Labels entstehen. Der Server bestimmt den Eingangstyp aus dem authentifizierten Kontext. Ein frei gesetztes origin=manual umgeht die Klassifikation nicht. Rein menschliche Erstellung bleibt möglich.

<a id="a23"></a>
## A23 - Nachvollziehbare Projektübernahme

**Gegeben:** Repositorydokumentation, Verträge, Fixtures und Implementierung.  
**Wenn:** Ein Mensch oder Coding-Agent beginnt beim Dokumentationsindex.  
**Dann:** Produktgrenzen, Begriffe, Bounded Contexts, Domain Map, Lebenszyklen, ADRs, Installation und QA sind verlinkt und widerspruchsfrei. Offene echte Integrationsnachweise sind sichtbar.

<a id="a24"></a>
## A24 - Konfigurierbare Kategorien und Labels

**Gegeben:** Ein Projekt mit Topic-, Workflow- und Attention-Labels.  
**Wenn:** Der Eigentümer ändert Namen, Farbe und Beschreibung und archiviert eine nicht mehr verwendete Definition.  
**Dann:** Stabile IDs/Keys bleiben erhalten, UI und Klassifikation verwenden die neue Taxonomieversion. Aktive Routingreferenzen verhindern ein unbemerktes Entfernen benötigter Definitionen. Der Name allein löst keine technische Berechtigung aus.

<a id="a25"></a>
## A25 - Fehlende Informationen über MCP zurückmelden

**Gegeben:** Ein Agent reicht ein Ticket ohne ausreichende Ziel- oder Kontextangaben ein.  
**Wenn:** Der Decisions-Mock erkennt anhand der konfigurierten Fragen fehlende Angaben; der Agent ergänzt diese.  
**Dann:** Die Antwort enthält needs_information und konkrete strukturierte Fragen, keinen JSON-RPC-Fehler. Ticket und Intake bleiben erhalten. Nach Ergänzung wird derselbe Eingang neu bewertet; es entsteht kein Duplikat.

<a id="a26"></a>
## A26 - Unklare Entscheidung und Providerfehler

**Gegeben:** Ein gültiger Intake und ein Mock mit mehrdeutigem Routing, Refusal, 429 oder Timeout.  
**Wenn:** Die Klassifikation wird durchgeführt und gegebenenfalls begrenzt wiederholt.  
**Dann:** Unklarheit und ein strukturiert erkanntes Refusal führen zur menschlichen Entscheidung; dauerhafte Nichtverfügbarkeit und nicht typisierbare SDK-/Konvertierungsfehler bleiben als classification_unavailable sichtbar. Kein erfundener Erfolg und kein Ersatz durch eine andere Modell-API entstehen. Teilantworten werden nicht als vollständige Freigabe verwendet.

<a id="a27"></a>
## A27 - Menschlicher Eingriff ist fachlich erkennbar

**Gegeben:** Eine dem Menschen zugewiesene offene Rückfrage, Routingentscheidung oder Freigabe.  
**Wenn:** Ein Agent beziehungsweise der Eigentümer versucht, nur das zugehörige Attention-Label zu entfernen.  
**Dann:** Der fachliche Grund bleibt offen und die Attention-Anzeige bleibt erkennbar. Erst die konkrete berechtigte Antwort oder Entscheidung schließt den Grund. Mehrere gleichzeitige Gründe bleiben getrennt sichtbar.

<a id="a28"></a>
## A28 - Link-Collections ohne fremde Systemanbindung

**Gegeben:** Ein Ticket mit Collections für Quellen und Ergebnisse.  
**Wenn:** Ein Agent registriert einen GitHub-/GitLab-PR-/MR-Link sowie einen Jira-Quellenlink über MCP.  
**Dann:** Titel, URL, Typ, Beziehung, Akteur und Zeitpunkt sind sichtbar und historisiert. Links lassen sich im erlaubten Umfang bearbeiten. Falkenwarte ruft keine dieser URLs ab, importiert keine Issueinhalte und behauptet keinen Merge-/PR-Status. Unzulässige URL-Schemata werden abgewiesen.

<a id="a29"></a>
## A29 - T3 verwaltet Provider und Ausführungsdetails

**Gegeben:** Ein Rollenprofil mit einer T3-seitigen Referenz.  
**Wenn:** T3 ändert oder entfernt die referenzierte Ausführungsmöglichkeit.  
**Dann:** Falkenwarte zeigt den Konfigurationsbedarf und führt keinen stillen Modellwechsel durch. Die UI bietet keine Provider-/Home-/API-Key-Konfiguration für T3 und keinen Repositoryzugriff an. Bestehende Run-Snapshots bleiben nachvollziehbar.

<a id="a30"></a>
## A30 - E2E-Störungen an der tatsächlichen Protokollgrenze

**Gegeben:** Der externe Mock mit dem festgelegten MCP-Dialekt, Test-Auth und Journal.  
**Wenn:** Die Suite prüft Handshake, Sessionablauf, Toolfehler, verlorene Antwort und eine Agentmeldung vor der Launch-Antwort.  
**Dann:** Der echte Adapter verarbeitet die Unterschiede. HTTP 200 mit isError:true wird nicht als Erfolg gewertet. Unbekannte Requests lassen das Szenario fehlschlagen; reale externe Dienste werden nie als stilles Fallback kontaktiert.

<a id="a31"></a>
## A31 - GitHub-QA und Release Please

**Gegeben:** Das echte GitHub-Repository mit Branchregel, QA-Workflow und Releasekonfiguration.  
**Wenn:** Ein normaler PR und ein Release-Please-PR durchlaufen die Pipeline; ein E2E-Job wird absichtlich fehlerhaft beziehungsweise übersprungen.  
**Dann:** Der erforderliche Gesamtstatus wird nur bei allen notwendigen Erfolgen grün. Release-PRs lösen nachweislich QA aus. Ein veröffentlichtes Image ist einem geprüften unveränderlichen Release-Commit und Digest zugeordnet. Kein automatischer Zugriff auf Projekt-Repositories entsteht.

<a id="a32"></a>
## A32 - Dokumentation folgt einer Fachänderung

**Gegeben:** Ein geänderter Intake- oder Workflow-Lebenszyklus.  
**Wenn:** Ein Pull Request verändert das Verhalten.  
**Dann:** Kontext-/Lifecycle-/Event-/Vertragsdokumente und betroffene E2E-Abnahmen werden gemeinsam aktualisiert. Eine wichtige neue Entscheidung erhält eine ADR; ersetzte Entscheidungen bleiben mit Nachfolger lesbar.

<a id="a33"></a>
## A33 - Überholte Klassifikationen und manuelle Entscheidungen

**Gegeben:** Ein laufender Decisions-Auftrag mit fixierter Ticket- und Taxonomieversion.  
**Wenn:** Während seiner Bearbeitung ändert der Eigentümer relevante Angaben, Routing oder Labels; danach trifft die alte Antwort ein.  
**Dann:** Die alte Antwort wird als überholt protokolliert und überschreibt keine neuere Entscheidung. Eine erforderliche Neubewertung verwendet einen neuen fachlichen Versuch; technische Retries erzeugen keine Ticketduplikate.

## Meilenstein-Gates

| Gate | Erforderliche Fälle |
|---|---|
| M0 - Basis | A03, A23; statische Verträge und dokumentierte MCP-/Decisions-Kompatibilität |
| M1 - Tickets, Labels, Links, UI | A01, A04, A06, A07, A08, A14, A21, A24, A28 |
| M2 - Decisions-Intake und MCP | A02, A13, A22, A25, A26, A27, A33 |
| M3 - T3 und Übergaben | A05, A09, A10, A11, A12, A29, A30 |
| M4 - Workflows und Metriken | A12, A16, A27, A33 und vollständige Ticket-/Übergabekette |
| M5 - Plugins und Dokumentation | A17, A18, A23, A32 |
| M6 - Release und Betrieb | A15, A19, A20, A21, A31 sowie E2E-Nachweis des Release-Images |

Die Gates wachsen mit den verfügbaren Schnittstellen. M1 nimmt Labels, Historie und Links zunächst über UI/JSON ab; die MCP-Anteile von A24/A28 sowie die Klassifikationswirkung werden erst in M2 vollständig geschlossen. Die Historie deaktivierter Pluginfelder aus A06 folgt in M5. Solche Teilumfänge erhalten getrennte Nachweiszeilen und bleiben bis zur späteren Abnahme ausdrücklich offen. Ein vollständiger Abnahmefall wird nicht wegen einer bestandenen Teilstrecke grün markiert.

Jeder Nachweis nennt getesteten Commit, Image, Fixture-/Szenarioversion, erwarteten und beobachteten Ausgang. Eine Mockumgebung wird nicht als reale T3-Anbindung ausgegeben. Die fachliche Abdeckung wird über diese IDs und die zugeordneten E2E-Szenarien geführt; es gibt keine verpflichtende Unit-Test- oder Zeilenabdeckungsquote.
