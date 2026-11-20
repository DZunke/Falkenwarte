# Eigentümerzugang und technische Tokens

Der Eigentümer arbeitet mit einer Browsersitzung. Ein Agent verwendet ein technisches Token, das an bestimmte Projekte und Berechtigungen gebunden ist. Du verwaltest beide Zugangsarten unter **Einstellungen**.

## Ein Token für ein Projekt ausstellen

1. Öffne **Technische Principals** und gib unter **Tokenname** an, welcher Client diesen Zugang bekommt.
2. Wähle unter **Projektzugriff** die Projekte und unter **Berechtigungen** die benötigten Aktionen. Für einen Client, der nur Tickets eines Projekts lesen soll, reichen das betreffende Projekt und **Tickets lesen**.
3. Lege die **Gültigkeit (Tage)** fest und wähle **Token ausstellen**.
4. Kopiere den angezeigten Wert in den vorgesehenen Client. Er wird nur bei der Ausstellung im Klartext angezeigt. HTTP und MCP erwarten den Wert als Bearer-Token im Authorization-Header. [Anbindung über HTTP und MCP](../API.md)

## Einen Zugang ersetzen oder beenden

Wähle unter **Technische Principals** beim betreffenden Zugang **Widerrufen**. Ab diesem Zeitpunkt akzeptiert Falkenwarte das Token bei der nächsten Anfrage nicht mehr. Für einen geplanten Wechsel kannst du ein neues Token ausstellen, im Client einsetzen und anschließend das bisherige widerrufen. Bei unzureichenden Rechten prüfst du neben der gewählten Berechtigung auch, ob die angesprochene Ressource zum freigegebenen Projekt gehört.

Das Token gewährt einem Agenten Rechte in Falkenwarte. Den Zugang von Falkenwarte zu T3 richtest du an der T3-Verbindung ein. [T3-Verbindungen und Agentrollen](../user/AGENTS_AND_WORKFLOWS.md)

## Das Eigentümerpasswort ändern

Gib unter **Passwort ändern** das aktuelle und ein neues Passwort mit mindestens zwölf Zeichen ein und wähle **Passwort aktualisieren**. Deine aktuelle Sitzung bleibt gültig. Andere aktive Eigentümersitzungen werden beendet. Die einmalige Ersteinrichtung und das Einrichtungstoken beschreibt die [Installationsanleitung](DEPLOYMENT_AND_CONFIGURATION.md).
