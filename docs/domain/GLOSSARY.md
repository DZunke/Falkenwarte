# Gemeinsame Sprache

| Begriff | Bedeutung im aktuellen System |
|---|---|
| Projekt | Fachlicher Bereich, der Aufgaben, Status, Boards, Labels, Regeln und eine T3-Projektbindung zusammenfasst. |
| Aufgabe / Task | Die zentrale Arbeitseinheit. `Task` ist der API- und Datensatztyp. „Aufgabe“ ist die deutsche Bezeichnung. |
| Status und Statuskategorie | Der Status ist ein Projektwert. Die Kategorie ist eine der festen Gruppen `backlog`, `ready`, `active`, `review`, `done` oder `cancelled`. |
| Blockade | Ein gesondertes Aufgabenmerkmal mit Begründung. Es ersetzt weder den Status noch den Zustand eines Agentenlaufs. |
| Board | Eine gespeicherte Sicht mit Filter und Spalten, die Projektstatus zuordnet und Aufgaben für die Anzeige gruppiert. |
| Label | Projektbezogene Kennzeichnung mit stabiler ID und Schlüssel. Aktuelle Arten sind `topic`, `workflow` und das systemverwaltete `attention`. |
| Themenlabel | Aktives `topic`-Label aus der projektspezifischen Taxonomie. Eine Klassifikation kann ein primäres Label und weitere Vorschläge enthalten. |
| Workflowlabel | Aktives `workflow`-Label, für das Classification eine versionierte Zuordnung zu einer Workflowdefinition führt. |
| Attentionlabel | Systemverwaltete Anzeige eines offenen Grundes. Es ist eine Ableitung und keine eigenständige Freigabe oder vom Agenten setzbare Wahrheit. |
| Intake | Persistierter Bewertungsprozess für einen technischen Aufgabeneingang. Manuelle Aufgaben erhalten ihn nur, wenn die Projektpolicy Klassifikation für manuelle Eingänge aktiviert. |
| Outcome | Fachliches Ergebnis eines Vorgangs, etwa eines Intake, Runs, Approvals oder einer Action. `ready` bedeutet, dass die Klassifikation einsatzbereit ist. Ein Run startet erst über eine eigene Operation. |
| Klassifikation | Ergebnis einer konkreten Bewertung, gebunden an Aufgabenrevision und Versionen von Taxonomie, Policy und Routingregeln. |
| Klassifikationsnachweis | Gespeicherte Providerantworten, Fingerprints, Versionen, gewählte Werte und Outcome. Der Nachweis hält die Bewertung nachvollziehbar fest. Er bestätigt nicht, dass das Modellurteil wahr ist. |
| Decision | Aufruf der konfigurierten Entscheidungsplattform über `DecisionGateway`. Das normalisierte Ergebnis ändert keine Berechtigungen. |
| Rückfrage | Fehlende oder unzureichende Angabe mit Feldschlüssel und Adressat `requester` oder `owner`. Der Adressat bestimmt, wer den nächsten Schritt ausführen darf. |
| Menschlicher Handlungsbedarf | Serverseitig aus offenen, an den Eigentümer gerichteten Gründen abgeleiteter Zustand. Eine Rückfrage an den ursprünglichen technischen Melder setzt diesen Zustand nicht. `WorkHandler` leitet ihn aus offenen Eigentümergründen ab. |
| Eigentümer | In der Ersteinrichtung angelegter menschlicher Betreiber. Eigentümerentscheidungen ändern fachliche Werte und ersetzen nicht die externe T3-Ausführung. |
| Technischer Principal | Über Bearer-Zugang authentifizierter Akteur mit Projekt- und Capability-Beschränkungen. Er verwendet die technischen Rechte seines Tokens und handelt nicht als Eigentümer. |
| Agentprofil | Falkenwarte-Konfiguration mit erlaubten Projekten, Verbindung, Rolle und Ausführungsziel. Es ist keine eigene Modell- oder Agentlaufzeit. |
| Ausführungsziel | Auswahl, mit der eine Agentrolle T3 den Projektstandard, ein T3-Referenzthreadziel oder eine benannte T3-Providerinstanz samt Modell übergibt. Bei einem direkten Providerziel speichert Falkenwarte nur die von T3 gemeldete Instanz-ID und Modell-ID; Providerkonfiguration und Zugang bleiben in T3. |
| T3-Providerinstanz | Von T3 gemeldete, verbindungsbezogene Providerkonfiguration, die für einen Start zusammen mit einer konkreten T3-Modell-ID ausgewählt werden kann. Falkenwarte verwendet den gemeldeten Slug als Referenz und verwaltet die Instanzparameter nicht selbst. |
| Referenzthread | Vorhandener Thread im gebundenen T3-Projekt, aus dem ein Agentprofil belegte Provider- und Modellroutingwerte für einen neuen T3-Thread übernimmt. Der Gesprächsverlauf wird nicht übernommen. |
| T3-Projektbindung | Zuordnung eines Falkenwarte-Projekts zu einer bestehenden T3-Verbindung und einem vorhandenen T3-Projekt. Sie ist zugleich der aktuelle Belegungsscope für parallele Runs. |
| Run | Persistierter Auftrag und Ablauf einer externen T3-Ausführung mit Snapshot, Versuch, Zustandsbeobachtungen, Ergebnisbericht und gegebenenfalls Nachweisen. |
| Versuch | Eine konkrete T3-Startidentität innerhalb des Runs. Ein technischer Zustellretry erhöht nicht automatisch die fachliche Reparaturrunde. |
| Beobachtung | Vom T3-Adapter normalisierte Information über den externen Zustand zu einem Zeitpunkt. Sie ist von einer Agentmeldung getrennt. |
| Abgleich | Prüfung der gespeicherten T3-IDs, Startannahme, Beobachtung und Meldung, um einen unsicheren externen Ausgang zu klären. |
| Boardstandard | Workflowvorlage, die ein Board beim ausdrücklichen Start im Ticket vorschlägt. Ein konfiguriertes Ausschlusslabel hält passende Tickets in manueller Bearbeitung. |
| Workflowdefinition | Versionierter Ablauf aus Phasen, Übergängen, Bedingungen und Grenzen. Die Definition wird von Orchestration gespeichert und von Automation geprüft. |
| Workflowinstanz | Laufender, pausierter oder beendeter Ablauf für eine Aufgabe. Sie verwendet einen Snapshot der gestarteten Definition. |
| Agentmeldung | Vom technischen Akteur übermittelte Behauptung zu Ergebnis, Frage oder Nachweis. Ihre Herkunft wird gespeichert. Erst der Eigentümer kann einen Nachweis menschlich bestätigen. |
| Nachweis | An Aufgabenrevision und optionalen Runversuch gebundene Information, die gemeldet und anschließend vom Eigentümer bestätigt oder abgelehnt werden kann. |
| Link-Collection | Benannte Sammlung registrierter HTTP- oder HTTPS-Referenzen an einer Aufgabe. `WorkHandler` speichert die Links, ruft sie aber nicht ab. |
| Approval | Eigentümerentscheidung über einen bestimmten Runversuch, eine Aufgabenrevision und einen Ergebnisdigest. Ein veralteter Bezug wird ungültig. |
| Action | Nachverfolgbarer API-Aufruf mit Akteur und lokalem Verarbeitungsstatus. Eine erfolgreiche Action kann einen erst später endenden Run ausgelöst haben. |
| Domain-Ereignis | Journalumschlag über eine tatsächlich gespeicherte lokale Datensatzänderung. Falkenwarte ist kein vollständiges Event-Sourcing-System. |
| UI-Änderungshinweis | Minimale Ressourcenreferenz für Mercure. Der Client lädt danach die aktuelle JSON-Ressource nach. |
| Revision | Redigierter Snapshot eines unterstützten Datensatzes zu einer Version. Eine Wiederherstellung wird als neue Änderung geprüft und gespeichert. |
| Hintergrundauftrag | Dauerhafter Eintrag in `commands`, der einem Worker zugewiesen wird. `inbox` verhindert doppelte lokale Verarbeitung desselben Auftrags. |
| Plugin | Im vertrauenswürdigen App-Image registriertes Paket mit Manifest, Fähigkeiten und Laufzeitstatus. Aktivierung lädt keinen neuen ausführbaren Code herunter. |
