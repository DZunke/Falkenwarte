# Externe E2E-Mocks

Diese Dienste simulieren ausschließlich den externen Netzwerkverkehr der gestarteten Falkenwarte-App.

Der T3-Server spricht ein zustandsbehaftetes Streamable-HTTP-MCP-Teilprofil unter `/mcp` mit Protokollrevision `2025-06-18` und speichert Launches nach Auth-Namespace und `clientRequestId`.

Er unterstützt `DELETE /mcp` zur authentifizierten Sessionbeendigung und antwortet auf nicht unterstützte SSE-`GET`-Streams mit `405`; beide Abläufe sind im Journal als erwarteter Transportverkehr erkennbar.

Das Fault-Set enthält unter anderem `reference_missing_model`, mit dem ein vorhandener T3-Thread ohne Provider-/Modellreferenz zurückgegeben wird.

Der Decisions-Server akzeptiert `POST /v1/decisions`, prüft Modell, native Fragen und strukturierten Eingabekörper und liefert ausschließlich versionierte Antworten aus `qa/fixtures/decisions/intake-responses.json`.

Die Kontrollrouten `/__qa/health`, `/__qa/reset`, `/__qa/scenario` und `/__qa/journal` steuern Szenarien und lesen redigierte Nachweise.

Unbekannte MCP-Methoden, T3-Tools, Entscheidungenpfade und fehlerhafte Fragekörper erscheinen im Journal als Fehler; die Mocks kontaktieren niemals einen externen Dienst.

Der T3-Dienst kann seinen Zustand über `T3_MOCK_STATE` in einem QA-Volume speichern, damit Idempotenz nach einem Mock-Neustart geprüft werden kann.

Beide Dienste verwenden Node.js-Bordmittel und sind nicht Teil des Produktionsimages.
