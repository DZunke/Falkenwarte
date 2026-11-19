# Dokumentation als Teil des Produkts

**Status:** Verbindlicher Fachvertrag aus Konzeptfassung 2.0. Der Umsetzungs- und Abnahmenachweis steht in [TRACEABILITY.md](TRACEABILITY.md).

## 1. Zweck und Leser

Die Dokumentation muss einem Menschen erklären, warum Falkenwarte sich so verhält, und einem Coding-Agent präzise Grenzen geben. Sie ist weder ein automatisch erzeugter Klassenspiegel noch eine zweite unkontrollierte Spezifikation. Fachbegriffe, Zustandsübergänge, Invarianten und Entscheidungen werden zuerst in verständlicher Sprache beschrieben. Technische Details folgen dort, wo sie das Verhalten begründen.

Die Pflege liegt beim Eigentümer des Projekts. Ein implementierender Agent darf Entwürfe ergänzen, muss neue Annahmen aber als Vorschlag kennzeichnen. Eine offene Frage wird mit Zuständigkeit und betroffenem Meilenstein dokumentiert; sie verschwindet nicht durch eine selbstbewusste Formulierung.

## 2. Verzeichnis und Verantwortung

| Ort | Inhalt | Änderungsauslöser |
|---|---|---|
| `docs/README.md` | Lesbarer Einstieg und Navigation | Neuer Dokumenttyp oder geänderte Wege |
| `docs/domain/GLOSSARY.md` | Gemeinsame Sprache | Neuer oder geänderter Fachbegriff |
| `docs/domain/BOUNDED_CONTEXTS.md` | Datenbesitz, Aggregate, Invarianten | Änderung einer Modulgrenze oder Regel |
| `docs/domain/CONTEXT_MAP.md` | Abhängigkeiten und veröffentlichte Verträge | Neue Context-Beziehung oder Bridge |
| `docs/domain/LIFECYCLES.md` | Zustände, Übergänge, Guards, Auslöser | Neuer Zustand, Übergang oder Abschlussregel |
| `docs/domain/EVENTS.md` | Domain-/Action-Events und History | Neuer Ereignistyp oder Schemaänderung |
| `docs/adr/` | Einzelne begründete Architekturentscheidungen | Langfristige Richtungsentscheidung |
| `docs/USER_GUIDE.md` | Menschliche Arbeitsabläufe | Neue oder geänderte Bedienhandlung |
| `docs/OPERATIONS.md` | Installation, Wiederanlauf, Backup, Restore | Neue Betriebsanforderung |
| `contracts/` | Maschinenlesbare öffentliche Verträge | Änderung von API, MCP oder Ereignisformat |
| `acceptance/` und `qa/` | Erwartetes beobachtbares Verhalten und Fixtures | Neue Regel oder behobener Fehlermodus |
| `docs/SOURCES.md` | Versionierte externe Nachweise | Paket-/Protokollupgrade oder neuer Integrationsvertrag |

## 3. Der Bereich innerhalb der Anwendung

Beim Build werden die freigegebenen Markdown-Dateien, Diagramme und ein Suchindex in statische Dokumentationsassets umgewandelt. Die vorhandene React-Anwendung zeigt sie unter `/docs` in derselben Navigation und mit denselben shadcn-Tokens. Es ist kein eigener Node-Server und kein externer Dokumentationsdienst erforderlich.

Der Einstieg zeigt Produktüberblick, Fachmodell, Architekturentscheidungen, Bedienung und Betrieb. Ein Leser sieht Dokumenttitel, zugehörige Konzept-/Produktversion und Status. Die Suche arbeitet lokal über Titel, Überschriften und Textauszüge. Markdown bleibt zusätzlich direkt im GitHub-Repository lesbar.

Rendering erfolgt mit einer festgelegten sicheren Markdown-Konfiguration. Freies HTML und ausführbare eingebettete Skripte werden nicht akzeptiert. Mermaid-Quellen werden beim Build in Diagrammassets übersetzt; es wird kein fremder Mermaid-Dienst mit Dokumentinhalten angesprochen. API-Referenzen werden aus OpenAPI gebaut und im selben Bereich verlinkt.

Die Produktdokumentation wird durch Repository-Änderungen gepflegt. Ein integrierter Wiki-Editor, eine kollaborative Dokumentplattform und ein KI-generierter Chat über die Dokumentation sind kein Bestandteil dieser Fassung. Laufzeitdaten, Secrets und private Agent-Transkripte gelangen nicht in den statischen Build.

## 4. Fachliche Dokumentvorlagen

Ein Bounded-Context-Dokument nennt Zweck, Sprache, Aggregate, Invarianten, Datenbesitz, öffentliche Commands/Queries, konsumierte/publizierte Ereignisse und Beziehungen. Es beschreibt insbesondere, was andere Module nur über einen Vertrag verändern dürfen.

Ein Lebenszyklus nennt Anfangs- und Endzustände, auslösenden Akteur, Guard, lokale Wirkung, mögliche Außenwirkung und Fehler-/Wiederaufnahmeweg. Ein Diagramm ergänzt diese Angaben; die Übergangstabelle bleibt auch ohne Diagramm verständlich.

Ein Ereigniseintrag benennt Zeitpunkt der fachlichen Wahrheit, Produzent, Empfänger, Schema-Version, zulässige Daten und Deduplizierung. Er erklärt ausdrücklich, ob das Ereignis einen Vorschlag, eine Meldung oder einen bestätigten Zustand bezeichnet.

Ein ADR enthält ID, Titel, Datum, Status, Kontext, Entscheidung, Konsequenzen, abgelehnte Alternativen, betroffene Verträge und Abnahmen. Statuswerte sind `proposed`, `accepted`, `superseded` oder `rejected`. Ein ersetztes ADR nennt sein Nachfolgedokument. Alte Inhalte werden nicht so umgeschrieben, als sei die spätere Entscheidung schon immer gültig gewesen.

## 5. Dokumentationsablauf im Pull Request

1. Die Änderung benennt betroffene Fachregeln und öffentliche Verträge.
2. Der Autor aktualisiert passende Domain-Dokumente, API/MCP-Schemas und Abnahmefälle gemeinsam.
3. Eine neue Richtungsentscheidung erhält ein ADR. Eine bloße Schreibfehlerkorrektur braucht keines.
4. CI prüft interne Links, Schema-Referenzen, ADR-IDs, Dokumentationsbuild und erzeugte Clienttypen.
5. Der Review prüft den Sinn der Änderung: passen UI, Regeln, Ereignisse und Fehlerverhalten noch zusammen?

Die PR-Vorlage enthält ein kurzes Feld „Dokumentation/Fachregel betroffen“. Ein begründetes „nicht betroffen“ ist zulässig. Es gibt keine automatische Pflicht, jede geänderte Codezeile in Prosa zu spiegeln.

## 6. Drift vermeiden

OpenAPI ist die Quelle der öffentlichen API-Typen. Generierte TypeScript-Dateien werden nicht manuell korrigiert. Ereignisschemas tragen eine Version; inkompatible Änderungen erhalten eine neue Version und eine dokumentierte Lesestrategie für History. Eine Änderung an einer Taxonomiebeschreibung erzeugt eine neue fachliche Taxonomieversion, wenn sich ihre Bedeutung ändert.

CI kann veraltete Links, unauflösbare IDs und vergessene Generierung erkennen. Ob eine Fachregel verständlich und zutreffend beschrieben ist, bleibt eine Reviewaufgabe. Es werden keine Unit-Tests unter dem Namen Dokumentationsprüfung eingeführt.

## 7. Reifegrad dieser Lieferung

Glossar, Context Map, Kontextverantwortungen, Lebenszyklen, Ereigniskatalog und ADRs liegen als versionierte Markdown-Dateien vor. `scripts/build-docs.php` erzeugt den lokalen Dokumentationsindex und kopiert die freigegebenen Texte und Verträge nach `public/docs`; die echte Darstellung und Navigation werden als Browserverhalten separat geprüft.
