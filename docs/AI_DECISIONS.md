# OpenAI Decisions: Einordnung und Intake

Falkenwarte nutzt die Symfony-AI-Platform für OpenAI Decisions, damit eingehende Aufgaben nach den gespeicherten Taxonomie-, Policy- und Routingregeln eingeordnet werden.

Der vollständige Symfony-AI-Aufrufpfad, der Containeraufbau und die MCP-Abgrenzung stehen unter [Wie Falkenwarte Symfony AI nutzt](SYMFONY_AI.md).

## Zuständigkeit und Ablauf

1. `IntakeHandler` speichert Aufgabe und Intake, versieht die Einordnung mit Aufgaben-, Taxonomie-, Policy- und Routingversionen und stellt einen dauerhaften Workerauftrag ein.
2. Der Worker lädt den für das Projekt konfigurierten Secret-Verweis und erzeugt Fragen aus aktiven Themenlabels, ausdrücklich gerouteten Workflowlabels und Pflichtangaben.
3. `DecisionGateway` hält die Application-Schicht vom Anbietertransport fern. `SymfonyAiDecisionAdapter` übergibt den Aufruf an die native Symfony-AI-`Platform`.
4. `OpenAiDecisionsModelClient` formt den nativen HTTP-Request und `DecisionResultConverter` wandelt die Antwort in das Symfony-AI-Ergebnis um.
5. `IntakeHandler` validiert und bewertet die Antworten und schreibt Klassifikationsnachweis und Intakezustand atomar. Nur ein noch aktueller Versionsstand darf angewandt werden.

Code: [IntakeHandler](../src/Classification/Application/IntakeHandler.php), [DecisionGateway](../src/Classification/Application/DecisionGateway.php), [SymfonyAiDecisionAdapter](../src/Classification/Infrastructure/SymfonyAiDecisionAdapter.php), [OpenAiDecisionsModelClient](../src/Classification/Infrastructure/OpenAiDecisionsModelClient.php), [DecisionResultConverter](../src/Classification/Infrastructure/DecisionResultConverter.php).

## Konfiguration

| Einstellung | Aktueller Wert und Grenze |
|---|---|
| Anbieter und Modell | `openai_decisions` und ausschließlich `gpt-6-luna` |
| Produktionsziel | Fest auf `https://api.openai.com/v1/decisions` gesetzt |
| Timeout | Standard 10.000 ms. Konfigurierbar von 500 bis 30.000 ms |
| Wiederholungen | Standard 2 Versuche. Konfigurierbar von 1 bis 3 |
| Lokales Budget | Standard 100 Provider-Requests pro Stunde. Konfigurierbar von 1 bis 10.000 |
| Symfony-Client | `decisions.client`, Redirects sind ausgeschaltet |
| Testziel | `DECISIONS_TEST_ENDPOINT` ist ausschließlich im Test-Environment zulässig |

Der OpenAI-Schlüssel wird über `POST /api/v1/secret-references` verschlüsselt hinterlegt und über `secret_reference_id` mit `PUT /api/v1/decision-configuration` verbunden. Die Konfiguration gibt den Schlüsselwert nie zurück. Die Verschlüsselung benötigt ein `APP_SECRET` mit mindestens 32 Zeichen.

Die gemeinsame [Symfony-Umgebungsdatei](../.env) enthält nicht geheime Defaults. Eine lokale `.env.local` kann sie für die Entwicklungsumgebung überschreiben. Produktive Werte kommen aus der geschützten Runtime-Konfiguration. `DECISIONS_TEST_ENDPOINT` muss im Test auf einen HTTP-Mock mit Host `localhost`, `127.0.0.1` oder `decisions-mock` zeigen und darf keine Credentials, Query oder Fragment enthalten.

Der Container registriert den nativen `Provider` als `ai.provider.openai.decisions` und die native `Platform` als `ai.platform.openai.decisions`. Der `ai.platform`-Tag trägt den Namen `openai.decisions`, den `SymfonyAiDecisionAdapter` explizit injiziert.

Der gesperrte offizielle OpenAI-Bridge-Code implementiert den nativen Decisions-Endpunkt nicht. Der eigene [ModelClient](../src/Classification/Infrastructure/OpenAiDecisionsModelClient.php) ergänzt daher den `ModelClientInterface`-Vertrag. Responses dient nicht als Ersatz.

Details zu Symfony-AI-Paketen, Containerverdrahtung, Secret-Auflösung und MCP stehen in [Wie Falkenwarte Symfony AI nutzt](SYMFONY_AI.md).

Die offiziellen Verträge sind in der [Symfony AI Platform](https://symfony.com/doc/current/ai/components/platform.html) und beim [Symfony HTTP Client 7.4](https://symfony.com/doc/7.4/http_client.html) beschrieben.

## Anfrage und konkrete Fragen

Der native Request wird als JSON-Eingabe in einer User-Nachricht übertragen. Pro Request sind 1 bis 400 benannte Fragen der Typen `predicate`, `choice` oder `score` erlaubt. Der aktuelle Intake erzeugt nur `predicate`- und `choice`-Fragen.

| Beispielname | Typ | Erlaubte Antwort |
|---|---|---|
| `primary_topic` | `choice` | Aktive Themenlabel-IDs oder `unknown` |
| `tag.<label-id>` | `predicate` | Wahrscheinlichkeit für ein zusätzliches Themenlabel |
| `workflow` | `choice` | Geroutete Workflowlabel-IDs oder `unknown` |
| `missing.<field-key>` | `predicate` | Ob eine definierte Pflichtangabe fehlt |

Die Eingabe enthält Tasktitel, Beschreibung, Typ, Kriterien, Antworten, vorgeschlagene Labels sowie die verwendeten Taxonomie-, Policy- und Routingversionen. Ist ein Workflow ausreichend sicher gewählt und geroutet, fragt ein zweiter Request nur die zu diesem Workflow gehörenden Pflichtangaben ab.

Die Anwendung akzeptiert nur Antworten mit bekannten, eindeutigen Namen und passenden Typen. Choice-Werte müssen aus der Anfrage stammen. Wahrscheinlichkeiten müssen zwischen 0 und 1 liegen, und die Choice-Verteilung muss innerhalb einer Toleranz von 0,05 insgesamt 1 ergeben.

## Ergebnis und fachliche Grenzen

Eine ausreichend sichere Route ohne fehlende Pflichtangaben ergibt `ready`. Fehlende Angaben ergeben `needs_information` und verwenden die festgelegte Rückfragevorlage. Eine Refusal-Antwort, ein unbekanntes Ergebnis, eine zu unsichere Wahl oder eine fehlende Route ergibt `needs_human_decision`. Ein technischer Fehler ergibt `classification_unavailable`. Die gespeicherte Aufgabe bleibt erhalten.

Ein Workflowlabel wählt nur eine fachliche Route. Es verleiht keine Rechte und startet keinen Run. Rollenrechte, Projektzugehörigkeit, Freigaben und Ausführungsgrenzen werden später deterministisch geprüft. Die Modellantwort kann weder Code- oder Teststatus belegen noch verlinkte Inhalte abrufen.

Der Klassifikationsnachweis enthält Aufgabenrevision, Taxonomie-/Policy-/Routingversion, Fingerprints, validierte Antworten, Ergebnis, Modell, verfügbaren Provider-Request-Identifier und `applied`. Er ist projektgebunden über `GET /api/v1/tasks/{task_id}/classifications/{classification_id}` lesbar.

## Ausfall und Wiederaufnahme

Nur Transportfehler, HTTP 429 und HTTP 5xx werden wiederholt. Der Backoff beginnt bei 100 ms und steigt exponentiell bis maximal 500 ms. Das Stundenbudget wird vor jedem Provider-Request geprüft. Andere HTTP-Fehler und ungültige Antworten werden nicht wiederholt.

Ein Worker-Lease verhindert parallele Bearbeitung derselben Generation. Nach einem Timeout wird ein nicht verfügbares Ergebnis dauerhaft festgehalten. Eine neue Intake-Generation kann anschließend erneut bewertet werden. Änderungen an Task, Taxonomie, Policy oder Routing machen ein verspätetes Ergebnis ungültig. Der Nachweis bleibt mit `applied=false` erhalten und der aktuelle Stand wird neu eingeplant.

Die Test-URL ist kein Produktionsschalter: außerhalb von `APP_ENV=test` verwendet die Platform fest den OpenAI-Endpunkt. Ein echter OpenAI-Aufruf ist ohne eingerichtete Secret-Referenz nicht verfügbar. Lokale Mocks prüfen Transport- und Fachablauf, nicht Modellqualität.

## Verträge und Quellen

- [OpenAI Decisions Guide](https://developers.openai.com/api/docs/guides/decisions) und [Create a decision API](https://developers.openai.com/api/reference/resources/decisions/methods/create).
- [OpenAPI-Vertrag](../contracts/openapi.yaml): Decisions-Konfiguration, Projekt-Policy und Klassifikationsnachweis.
- [DecisionResultConverter](../src/Classification/Infrastructure/DecisionResultConverter.php): lokale Antwortkonvertierung. Der [Symfony-Serviceaufbau](../config/services.php) registriert `gpt-6-luna` im nativen `InMemoryModelCatalog`.
