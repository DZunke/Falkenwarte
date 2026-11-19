# OpenAI Decisions und fachliche Eingangsbearbeitung

**Stand: 19. November 2026. Verbindlicher Konzeptentwurf für Falkenwarte.** Die Klassifikation betrifft Tickets und ihren Arbeitsablauf. Sie konfiguriert keine T3-Provider, liest keinen Code und ruft keine registrierten Issue-/PR-Links ab.

## 1. Tatsächlich verwendete API

OpenAI bietet die **Decisions API** unter `POST https://api.openai.com/v1/decisions` an. Der recherchierte Stand nennt `gpt-6-luna` als unterstütztes Modell. Die drei Antwortarten sind `predicate`, `choice` und `score`; einzelne Fragen können statt einer Antwort `refusal` ergeben. Das ist eine andere Schnittstelle als Responses. Falkenwarte verwendet ausdrücklich Decisions, ohne Jev- oder Responses-Fallback. [D1, D2]

Ein `predicate` liefert eine Wahrscheinlichkeit für eine Bedingung. `choice` wählt einen vorgegebenen Wert und liefert Verteilung sowie Confidence; `score` bewertet anhand geordneter Stufen. Diese Werte sind Klassifikationssignale. Sie ersetzen weder Rechteprüfung noch verbindliche Workflowregeln. [D1, D2]

## 2. Einbindung in Symfony AI und PR #2956

**Verbindliche Architektur:** `DecisionGateway → SymfonyAiDecisionAdapter → PlatformInterface → OpenAI-Decisions-Client`. Symfony AI trägt die Providerintegration. Die fachlichen Application-Handler kennen weder HTTP noch SDK-Fragetypen. Eigene DTOs enthalten Fragen, versionierten Kontext, Antworten und fachliche Fehlerzustände.

Der ausdrücklich betrachtete [Symfony-AI-PR #2956](https://github.com/symfony/ai/pull/2956) ergänzt die native Anbindung. Der recherchierte Stand ist **offen und nicht gemergt**, Head `581bfaae3fa9ab15b0d69f8308c6085f1c826ef6`. Dieser Entwicklungsstand wird nicht als bereits veröffentlichte Paketfähigkeit ausgegeben. Die bisherige Releasebasis und die API des PR werden getrennt dokumentiert. [D3, D4]

Im geprüften PR erwartet `PlatformInterface::invoke()` benannte Fragen in der Option `questions`. Die konkreten Klassen heißen `Symfony\AI\Platform\Decision\Question\NoulQuestion`, `ChoiceQuestion` und `ScoreQuestion`. Ein `NoulQuestion` entspricht auf der OpenAI-Leitung einem `predicate`. Die Rückgabe wird als `Symfony\AI\Platform\Decision\Answer\Answers` gelesen. `Gpt\ModelClient` leitet einen Aufruf mit `questions` an den nativen `DecisionClient` weiter; dieser sendet an `/v1/decisions`. Die bloße Verwendung des OpenAI-Platforms ohne diese belegte Leitung genügt nicht. Batching und Decisions werden im geprüften Client nicht gemeinsam akzeptiert. [D5, D6, D8]

### Erweiterung und Releaseübergang

Der erste Implementierungsmeilenstein wählt eine kohärent installierbare Symfony-AI-Version. Ist der PR bis dahin veröffentlicht und mit dem restlichen Paketset kompatibel, verwendet Falkenwarte die native Implementierung. Solange diese Fähigkeit fehlt, entsteht ein enges internes Composer-Paket, etwa `falkenwarte/symfony-ai-decisions`, im eigenen Namespace. Es ergänzt ModelClient, Frage-/Inputnormalisierung und Resultkonvertierung über die tatsächlich vorhandenen Symfony-AI-Interfaces. Symfony HttpClient ist darin der Transport; er ersetzt nicht die Platform-Abstraktion im Application-Code.

Das Paket orientiert sich an den geprüften nativen Verträgen, übernimmt aber keine nicht vorhandenen Klassen oder Enum-Werte als angebliche Release-API. Der geprüfte OpenAI-ResultConverter und Gpt-ModelClient sind final. Die Erweiterung verwendet deshalb eigene kompatible Implementierungen beziehungsweise Komposition und registriert sie an den nachgewiesenen Platform-Erweiterungsstellen; sie erbt nicht von finalen Upstream-Klassen. Insbesondere sind `Capability::DECISION`, neue Question-Klassen und Result-Konvertierungsstellen gegen die konkret gesperrte Version zu prüfen. Falls diese Erweiterung neue Core-Interfaces benötigt, muss M0 ein zusammenhängendes, exakt gepinntes Symfony-AI-Paketset wählen und seinen Entwicklungsstatus im ADR festhalten. Ein beliebiger Branch, ein ungeprüfter Gesamtdiff und ein dauerhaftes `dev-main` sind keine Versionsstrategie.

Eigene Extension und spätere native Bridge haben denselben `DecisionGateway`-Vertrag und dieselben HTTP-E2E-Fixtures. Ein Releasewechsel entfernt die Kompatibilitätsimplementierung erst nach diesen Nachweisen. Anwendungsfälle importieren keine TypeSafe-/Jev-Klassen. Ein Responses-Fallback und ein generativer Chat-Agent für den Pflichtintake sind nicht vorgesehen.

### Im Repository umgesetzt

Die im Composer-Lock installierte Symfony-AI-Version enthält die Decisions-Bridge noch nicht. Der bei der Umsetzung live geprüfte [PR #2956](https://github.com/symfony/ai/pull/2956) war am 19. November 2026 offen und nicht gemergt; das veröffentlichte `symfony/ai-open-ai-platform`-Paket `v1.0.0-BETA1` stellt keinen nativen Decisions-Client bereit. Falkenwarte implementiert deshalb `DecisionGateway → SymfonyAiDecisionAdapter → PlatformInterface`; die lokale `App\Classification\Infrastructure\OpenAiDecisionsPlatform` sendet ausschließlich an den nativen Decisions-Endpunkt. Die echte Produktverbindung ist erst belegt, wenn sie mit einem produktiven Schlüssel ausgeführt wurde. Aktuelle Mock- und Abnahmenachweise stehen in [TRACEABILITY.md](TRACEABILITY.md).

### Refusal und Metadaten

Die OpenAI-API kann einzelne Fragen mit `refusal` beantworten. Der im PR geprüfte ResultConverter wirft dafür jedoch eine allgemeine `RuntimeException`; er liefert keine Sammlung mit teilweise erfolgreichen und teilweise zurückgewiesenen Antworten. Falkenwarte behauptet diese feinere native Semantik deshalb nicht. [D1, D2, D7]

Die eigene schmale Konvertererweiterung erhält den typisierten Rückweisungsgrund aus dem strukturierten Providerkörper und lässt **keinen** Pflichtentscheid dieser Auswertung automatisch wirksam werden. Das fachliche Ergebnis ist `needs_human_decision`. Eine generische SDK-Konvertierungsexception ohne verlässlich strukturierten Refusal-Nachweis wird als `classification_unavailable` behandelt. Exceptiontexte werden nicht als Protokoll geparst. Das komplette Ergebnis, bekannte Teilantworten und der Ablehnungsgrund können geschützt im Klassifikationsnachweis gespeichert werden; das bedeutet keine teilweise automatische Anwendung.

Ebenso werden Modellbezeichnung, Anfragefingerprint, Provider-Request-ID und Usage nur übernommen, soweit sie tatsächlich im HTTP-/SDK-Ergebnis verfügbar sind. Falls die gewählte Result-API diese Metadaten nicht erhält, ergänzt die Extension einen begrenzten Transportbeobachter. Sie erfindet keine Werte. Dieser Pfad und der Refusal-Pfad werden als echte Hintergrund-/HTTP-E2E-Szenarien geprüft; Upstream-Unit-Tests werden nicht zu eigenen Produkttests umdeklariert.

Die produktive Provideradresse ist fest auf OpenAI begrenzt. Nur der Testmodus erlaubt den abgeschotteten Decisions-Mock. API-Zugang wird über eine Secret-Referenz gesetzt. Er ist unabhängig von T3- und Codex-Anmeldungen. Timeouts, Versuchslimit und lokales Anfragebudget sind konfiguriert; die Testpipeline benötigt keinen echten Providerzugang.

## 3. Herkunft bestimmt die Pflicht

Jeder Eingang über MCP und jede Anlage durch einen technischen API-Principal wird klassifiziert. Die Herkunft entsteht serverseitig aus Transport und Authentifizierung. Ein Client kann weder `source=manual` noch ein vergleichbares Feld verwenden, um diese Regel zu umgehen.

Ein Eigentümer, der ein Ticket in UI oder über seine authentifizierte JSON-Sitzung von Hand anlegt, kann die Einordnung direkt vornehmen. Die zusätzliche KI-Unterstützung für diesen Pfad ist konfigurierbar. Automationen verwenden technische Tokens, keine zweckentfremdeten Browsersitzungen.

Die erste Transaktion speichert Ticket, Ursprungsakteur, Eingangsversion, Action und Outbox. Erst danach wird Decisions aufgerufen. Auch bei Anbieterfehler oder fehlenden Angaben ist das eingegangene Ticket dauerhaft vorhanden.

## 4. Themen, Tags und Workflowlabels

`LabelDefinition` besitzt ID, stabilen Key, Name, Farbe, Beschreibung, Typ und Aktivität. Labels gehören im MVP zu einem Projekt.

| Typ | Bedeutung | Schreibregel |
|---|---|---|
| `topic` | Themenkategorie und zusätzliche fachliche Tags | Eigentümer konfiguriert; KI kann vorhandene aktive Labels vorschlagen |
| `workflow` | Einordnung in einen vorgesehenen Arbeitsablauf | Nur explizit konfigurierte, versionierte Route verwendbar |
| `attention` | Sichtbarer Hinweis auf Rückfrage oder menschlichen Eingriff | Vom Domainzustand abgeleitet; Darstellung konfigurierbar |

Topiclabels sind die kanonischen Themenkategorien. `primary_topic_label_id` benennt die Hauptkategorie; weitere Topiclabel-IDs stehen in `label_ids`. Es entsteht kein zweites Kategorienmodell mit widersprüchlichen Namen.

Name, Farbe und Beschreibung eines Labels sind bearbeitbar. ID, Key und Typ bleiben stabil. Die Beschreibung erklärt dem Menschen und dem Klassifikator, wann ein Label passt. Ein technischer Melder darf vorhandene Labels vorschlagen; unbekannte IDs oder freie vom Modell erfundene Tags werden nicht übernommen. Neue Taxonomieeinträge werden durch den Eigentümer angelegt.

Jedes routbare Workflowlabel verweist in `WorkflowRoutingRules` auf eine konkrete Workflow-ID und Definitionsversion. Die Anwendung erwartet genau eine eindeutige Route. Keine passende Route, mehrere widersprüchliche Workflowlabels oder zu geringe Entscheidungssicherheit führen zur menschlichen Einordnung. Eine aktive Workflowinstanz behält ihre Version und ihre Startgrundlage; spätere Labeländerungen ersetzen sie nicht heimlich.

## 5. Fragen statt freier Generierung

Eine Auswertung erhält den Ticketinhalt und versionierte Beschreibungen erlaubter Kategorien. Sie stellt getrennte, benannte Fragen:

1. `primary_topic`: `choice` aus den erlaubten Topiclabel-IDs plus einem internen `unknown`-Wert.
2. `tag.<label-id>`: einzelne `predicate`-Fragen für passende zusätzliche Tags.
3. `workflow`: `choice` aus den vorhandenen erlaubten Workflowlabel-IDs plus `unknown`.
4. `missing.<field-key>`: `predicate` für konkret definierte Pflichtangaben.
5. Optional eine `score`-Frage für einen sichtbaren Prioritätsvorschlag nach einer verständlichen Rubrik.

Gemeinsam unabhängige Fragen können in einem Request stehen. Workflowabhängige Pflichtangaben werden erst nach einer verwertbaren Workflowentscheidung geprüft. Jede Anfrage bleibt innerhalb der Anbietergrenzen; die recherchierte API erlaubt bis zu 400 Fragen. [D1, D2]

Die Rückfrage selbst entsteht aus `IntakeRequirement.question_template`. Beispiel: Ergibt `missing.expected_behavior` einen fehlenden Erwartungswert, antwortet Falkenwarte mit dem konfigurierten Text „Welches Verhalten wird stattdessen erwartet?“. Decisions generiert dabei keinen angeblich frei formulierten Fragetext und keine Begründung, die der Endpunkt nicht geliefert hat.

Das Eingangsmaterial bleibt untrusted Daten. Darin enthaltene Aufforderungen, andere Provider aufzurufen, Freigaben zu umgehen oder URLs zu laden, werden nicht zu Anweisungen des Systems. Die Fragen und erlaubten Werte liefert Falkenwarte aus der eigenen Konfiguration.

## 6. Entscheidung anwenden

Ein `ClassificationRecord` speichert Eingangsrevision, Taxonomie-, Policy- und Routingversion, Frage-/Requestfingerprint, Modell, typisierte Antworten und Herkunftsmetadaten. Der versionierte Taxonomiesnapshot enthält die tatsächlich verwendeten Labelbeschreibungen; ein Hash und die unveränderliche Versionsreferenz erlauben den späteren Vergleich. Ein OpenAI-Request-Identifier wird nur gespeichert, wenn er tatsächlich geliefert wurde; er wird nicht aus einer erfundenen `id` im Antwortkörper gewonnen.

Schwellwerte berücksichtigen gewählte Wahrscheinlichkeit, Confidence und Abstand zum zweitbesten Wert. Ihre Startwerte sind Produktkonfiguration, keine garantierte Genauigkeitszusage. Bei fehlenden Antworten, unbekannten Frage-IDs, unzulässigen Auswahlwerten, unplausiblen Verteilungen oder `refusal` wird die Auswertung nicht automatisch angewandt. Auch eine teilweise gültige Antwort darf keinen Pflichtschritt vorwegnehmen.

Vor dem Commit prüft Falkenwarte per CAS, ob die fachliche Ticketrevision, Taxonomie, Policy, Routingdefinition und geschützte menschliche Einordnung noch dieselben sind. Ein verspätetes Ergebnis bleibt als nicht angewandter Nachweis erhalten und wird als veraltet behandelt. Ein neuer Hintergrundauftrag wertet den aktuellen Stand aus. Der fachliche Commit verbindet Labels, Intakezustand, Historie, Domain Events und Outbox atomar.

Jeder `ClassificationRecord` bleibt über `GET /api/v1/tasks/{task_id}/classifications/{classification_id}` projektgebunden lesbar und weist Eingangsrevision, Regelversionen, Fingerprints, normalisierte Antworten, Ergebnis und `applied` aus. `applied=true` bedeutet, dass genau dieser Nachweis die Versionsprüfung bestanden hat und auf den damaligen aktuellen Taskstand angewandt wurde; es behauptet nicht, dass er nach späteren Änderungen noch der aktuelle Stand ist. Der Task verweist mit `classification_id` auf den seiner Darstellung zugeordneten Nachweis; `classification_required` und der aktuelle Intake zeigen, ob eine Neubewertung läuft oder nötig ist. Ältere Nachweise und ihre History-Einträge bleiben erhalten.

Beim Commit eines neueren Intake-Ergebnisses werden offene Intake-Gründe früherer Generationen derselben Aufgabe superseded; ein durch das neue Ergebnis erforderlicher Grund wird anschließend mit der aktuellen Intake-ID eröffnet. Der vorherige Grund bleibt während der laufenden Neubewertung offen. Eine passende Eigentümerentscheidung schließt die Intake-Gründe, die sie ersetzt, aber weder ein Approval noch einen unabhängigen Run-, Auth- oder Reconciliation-Grund.

Die Playwright-Abnahme übt die Supersession mit `classification_unavailable` gefolgt von einer mehrdeutigen neuen Bewertung in A26/A27 und prüft die erhaltene, nicht angewandte verspätete Klassifikation sowie die neue aktuelle Revision in A33 ([E2E-Szenarien](../tests/e2e/tests/decisions-intake.spec.mjs)).

Manuell gesetzte Einordnungen werden geschützt. Eine KI-Antwort kann sie nicht überschreiben. Notwendige Änderungen werden vorgeschlagen und mit ihrer Ursache sichtbar gemacht. Ein Workflowlabel ist kein Ausführungsrecht; vor jedem Start werden Projektregeln, Rollenrechte, T3-Fähigkeiten, offene menschliche Entscheidungen und Parallelitätsgrenzen erneut geprüft.

## 7. MCP-Response und Rückfragezyklus

`tasks_create` ruft denselben Application-Handler wie `POST /api/v1/projects/{project_id}/tasks` auf. Nach dauerhafter Annahme kann der Aufruf höchstens `prefer_wait_ms` auf ein schnelles Ergebnis warten; der erlaubte Bereich beträgt 0 bis 1500 Millisekunden. Die Klassifikation bleibt einem dauerhaften Workerauftrag zugeordnet.

| `outcome` | Bedeutung | Fortsetzung |
|---|---|---|
| `accepted` | Ticket gespeichert, Einordnung läuft | `tasks_intake_get` nach dem mitgelieferten Pollintervall |
| `ready` | Aktuelle Einordnung ist verwendbar | Zulässiger nächster Arbeitsschritt; kein impliziter Start |
| `needs_information` | Konkrete Angaben fehlen | `tasks_supply_information` für dasselbe Ticket |
| `needs_human_decision` | Unklare Route, Refusal oder ausdrückliche Eskalation | Eigentümerentscheidung in UI/JSON |
| `classification_unavailable` | Anbieterfehler, Budget oder Einrichtung verhindert Einordnung | Sichtbarer Wartezustand und begrenzter Retry beziehungsweise Ownerentscheidung |

Diese Outcomes werden als reguläres `structuredContent` mit `isError:false` zurückgegeben. Die JSON-RPC-Verarbeitung hat funktioniert. Fehlende Angaben sind kein Transportfehler, der einen Agenten zum wiederholten Anlegen desselben Tickets verleiten soll. Ungültige Argumente oder fehlende Rechte bleiben echte Toolfehler.

Jeder Receipt enthält `task_id`, `intake_id`, `action_id`, `task_version`, `missing_fields`, `human_attention` und gegebenenfalls `poll_after_ms`. Ein technischer Eingang hat stets eine Intake-ID. Das vollständige Beispiel steht in `contracts/examples/intake-needs-information.json`.

Die Rückfrage richtet sich standardmäßig an den ursprünglichen Melder. Ist das ein Agent, bleibt `human_attention.required=false`; das Systemlabel zeigt „Rückfrage an Agent“. Erst eine an den Eigentümer gerichtete Frage, eine unklare Entscheidung oder eine ausdrückliche Eskalation erzeugt „Mensch erforderlich“. Mehrere Gründe können gleichzeitig bestehen. Ein Grund verschwindet erst durch den dafür zulässigen Command; ein bloßes Entfernen eines Labels genügt nicht.

`tasks_supply_information` verwendet dieselbe Task-ID, erwartete Version und einen eigenen Idempotenzschlüssel. Zulässig sind nur angefragte Feldschlüssel. Die Antwort erzeugt eine neue Revision und eine neue Auswertung; sie verändert keinen alten Nachweis. Ein konfiguriertes Limit begrenzt Rückfragerunden, danach wird an den Eigentümer eskaliert.

## 8. Weitere sinnvolle Decision-Einsätze

Der erste Produktumfang nutzt Decisions zusätzlich für die erneute Einordnung geänderter Ticketinhalte und für den Vollständigkeitscheck eingehender Agent-Ergebnismeldungen. Bei der Ergebnismeldung werden nur erforderliche Angaben und Referenzen geprüft, etwa ob ein verlangter Ergebnislink angegeben wurde. Die Anwendung behauptet dadurch keine inhaltliche Prüfung des verlinkten Codes.

Ein Prioritätsvorschlag nach Rubrik kann sichtbar ergänzt werden. Weitere probabilistische Entscheidungen werden nur eingeführt, wenn eine konkrete fachliche Frage, ein zulässiger Antwortkatalog und ein Fehler-/Eskalationsweg dokumentiert sind.

Berechtigung, Projektzugehörigkeit, URL-Syntax, Versionskonflikte, WIP, Pluginaktivität, Idempotenz und Abschlussfreigaben bleiben deterministisch. Ein modellbasiertes „sicher“ gibt weder ein Ticket frei noch bestätigt es Tests oder einen Pull Request.

## 9. Betriebs- und E2E-Grenzen

Anbieter-Timeouts, 429 und vorübergehende Serverfehler erhalten begrenzten Backoff. Ein wiederholter Aufruf kann zusätzliche Providerkosten auslösen; eigene logische Deduplizierung garantiert keine externe Exactly-once-Abrechnung. Ein Lease schützt die lokale Klassifikationsgeneration, und ein bereits angewandtes Ergebnis wird nicht erneut wirksam.

Alle regulären E2E-Läufe verwenden den HTTP-Decisions-Mock und feste Fixtures für ready, Rückfrage, Unklarheit, Refusal, fehlerhafte Antwort, Timeout, Retry und verspätetes Ergebnis. Sie durchlaufen den echten Intake, Worker, DBAL, Historie und MCP-/JSON-Rückweg. Mocks belegen Ablauflogik, keine reale Modellgüte. Ein bewusst gestarteter realer E2E-Nachweis kann die tatsächliche Provideranbindung prüfen; er ist kein Pflichtteil einer unbemerkt kostenpflichtigen CI-Pipeline.

## Primärquellen

- **D1:** [OpenAI: Decisions Guide](https://developers.openai.com/api/docs/guides/decisions) – Endpoint, Modell, Fragetypen, Verteilungen, Rückweisungen und Fragegrenzen.
- **D2:** [OpenAI: Create a decision](https://developers.openai.com/api/reference/resources/decisions/methods/create) – nativer Request-/Response-Vertrag.
- **D3:** [Symfony AI: Platform Component](https://symfony.com/doc/current/ai/components/platform.html) – Platform-Abstraktion; aktuelle Dokumentation allein ist kein Nachweis einer bestimmten installierten Releasefähigkeit.
- **D4:** [Symfony AI: PR #2956](https://github.com/symfony/ai/pull/2956) – ausdrücklich gewählte native Entwicklungsrichtung; Status und Head sind eine Recherche-Momentaufnahme.
- **D5:** [Geprüfter Gpt ModelClient](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/src/platform/src/Bridge/OpenAi/Gpt/ModelClient.php) und [DecisionClient](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/src/platform/src/Bridge/OpenAi/Decision/DecisionClient.php) – tatsächliche Endpointrouting- und Requestleitung.
- **D6:** [Natives OpenAI-Decisions-Beispiel des PR](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/examples/openai/decision.php) – benannte Fragen, Aufruf und typisierte Antworten.
- **D7:** [Geprüfter OpenAI Decision ResultConverter](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/src/platform/src/Bridge/OpenAi/Decision/ResultConverter.php) – Strukturprüfung und gegenwärtige Refusal-Exception.
- **D8:** [QuestionNormalizer am geprüften PR-Head](https://github.com/chr-hertel/ai/blob/581bfaae3fa9ab15b0d69f8308c6085f1c826ef6/src/platform/src/Bridge/OpenAi/Decision/QuestionNormalizer.php) – explizite Abbildung von NoulQuestion auf den nativen Typ `predicate`.
