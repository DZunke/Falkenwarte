# Gemeinsame Sprache

**Status:** Verbindlicher Fachvertrag aus Konzeptfassung 2.0. Der Umsetzungs- und Abnahmenachweis steht in [TRACEABILITY.md](../TRACEABILITY.md).

| Begriff | Bedeutung in Falkenwarte |
|---|---|
| Projekt | Fachlicher Trennraum mit Name, Icon, Farbe und eigenen Aufgaben, Labels, Boards und T3-Bindung. |
| Ticket / Aufgabe / Task | Dieselbe fachliche Arbeitseinheit. Die UI verwendet Ticket oder Aufgabe; die API verwendet den Typ `Task`. |
| Board | Gespeicherte Sicht auf die Tickets eines Projekts. Ein Ticket kann in mehreren Boards erscheinen. |
| Status | Fachlicher Bearbeitungsstand einer Aufgabe, unabhängig von einem laufenden Agenten. |
| Statuskategorie | Eine der festen Kategorien `backlog`, `ready`, `active`, `review`, `done`, `cancelled`. Benannte Projektstatus ordnen sich einer Kategorie zu. |
| Blockade | Ein eigener Hinderungsgrund; keine zusätzliche Statuskategorie und kein Beweis eines gestoppten Agenten. |
| Label / Tag | Konfigurierbare Kennzeichnung mit stabiler Identität, Name, Farbe und Beschreibung. Beide Wörter bezeichnen dasselbe Objekt. |
| Themenkategorie | Label der Art `topic`; eine kann als primär ausgezeichnet sein. |
| Workflowlabel | Label der Art `workflow`, das über eine versionierte Routingregel einen Workflow auswählt. |
| Attentionlabel | Systemseitige Ableitung eines Handlungs- oder Wartezustands. Mensch erforderlich ist ausschließlich an offene Eigentümergründe gebunden. Das Label ist keine Freigabe. |
| Taxonomie | Versionierter Bestand zulässiger Labels samt ihrer fachlichen Beschreibungen. |
| Intake | Dauerhafter Eingang eines nicht manuell angelegten Tickets samt Prüfung, Klassifikation und Rückfragen. |
| Klassifikation | Auswertung einer konkreten Ticketrevision mit einer konkreten Taxonomie und Policy. Sie enthält Herkunft und Unsicherheit. |
| Decision | Eine eingeschränkte Einschätzung durch OpenAI Decisions: Prädikat, Auswahl oder Score. Sie verleiht keine Berechtigung. |
| Rückfrage | Konkrete benötigte Angabe an einen benannten Adressaten. Der meldende Agent und der menschliche Eigentümer sind unterschiedliche Adressaten. |
| Menschlicher Handlungsbedarf | Persistenter offener Grund, der eine Eigentümeraktion erfordert; sichtbar durch Labels und Dashboard. |
| Rolle / Agentprofil | Falkenwarte-Konfiguration für Auftrag, erlaubte Projekte und ein vorhandenes T3-Ziel. Kein eigener Modellprovider. |
| T3-Ziel | T3-Projektstandard oder vorhandener Referenzthread, dessen Ausführungszuordnung der Adapter aus T3 liest. |
| T3-Projektbindung | Zuordnung eines Falkenwarte-Projekts zu einer bekannten T3-Projektreferenz. Im MVP zugleich konservativer Parallelitätsscope. |
| Run | Ein konkreter Agentauftrag mit eingefrorener Ticketrevision, Zielreferenz, Phase und Startidentität. |
| Versuch | Wiederaufnahme-/Bearbeitungsstand innerhalb eines Runs; Netzwerk-Retries erzeugen keine neue fachliche Reparaturrunde. |
| Dispatch | Dauerhafter Auftrag, eine externe Ausführung anzustoßen. Annahme ist noch kein Erfolg. |
| Agentmeldung | Von einem technischen Akteur gemeldetes Ergebnis, eine Frage oder ein Link. Ihre Herkunft bleibt sichtbar. |
| Beobachtung | Normalisierte Antwort des T3-Adapters über einen externen Zustand, mit Zeitpunkt und Originalstatus. |
| Abgleich / Reconciliation | Aufklärung eines unsicheren externen Ausgangs anhand von IDs, Korrelation und T3-Beobachtung. |
| Phase | Begrenzter Schritt eines versionierten Workflows, etwa Bearbeitung, Reviewmeldung oder menschliche Entscheidung. |
| Übergabe | Neuer Auftrag mit explizitem Kontext und Referenzen an eine andere Rolle. Keine implizite Kopie von Code oder Chatverlauf. |
| Link-Collection | Benannte und geordnete Sammlung externer Referenzen eines Tickets. Quelle, Ergebnis und Referenz sind mögliche Beziehungen. |
| Approval | Entscheidung des Eigentümers über eine genau gebundene fachliche Meldung. Keine Berechtigung zum Merge eines externen PR. |
| Action | Dauerhafter Anwendungsaufruf mit Akteur, Eingang, Status und Ergebnis. |
| Domain Event | Unveränderliche Aussage über eine tatsächlich eingetretene fachliche Änderung. |
| Action Event | Aussage über Annahme, Beginn, Erfolg oder Fehler eines Anwendungsaufrufs. |
| Objektrevision | Redigierter Zustand eines fachlichen Objekts zu einer Version, samt Akteur und Ursache. |
| Outbox / Inbox | Dauerhafte ausgehende Lieferung beziehungsweise atomar deduplizierter eingehender Verarbeitungsschritt. |
| Plugin | Vorinstalliertes Paket mit veröffentlichten Beiträgen und eigenem Aktivierungs-/Datenlebenszyklus. |
| Bridge | Austauschbare technische Umsetzung einer fachlichen Integrationsabstraktion. |
| E2E | Prüfung von außen gegen das gestartete Produkt mit echten inneren Komponenten und gemockten externen Diensten. |

Die Begriffe „geprüfter Code“, „Build erfolgreich“ und „PR gemergt“ sind keine von Falkenwarte selbst ermittelten Produktzustände. Solche Inhalte können ausschließlich als klar zugeordnete Agentmeldung oder menschliche Aussage erscheinen.
