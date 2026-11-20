# Backup und Restore

Falkenwarte erstellt ein geprüftes SQLite-Backup und kann es aus der laufenden Anwendung wiederherstellen. Ein Restore hält neue Starts an und verlangt danach einen vollständigen Abgleich mit T3. Ein Datenbankwechsel nimmt externe Aufträge nicht zurück.

## Backup erstellen und sichern

1. Öffne **Einstellungen** und gehe zu **Backup und Wiederherstellung**.
2. Wähle **Backup erstellen** und warte, bis der Status **Bereit** lautet.
3. Lade das Backup über **Backup herunterladen** herunter und bewahre die Datei an einem getrennten, geschützten Speicherort auf.
4. Sichere Secretdateien und das generierte Verzeichnis `/data/.secrets` separat und geschützt, wenn die verschlüsselten Einträge später wieder lesbar sein müssen.

Das ZIP enthält `database.sqlite` und `manifest.json` mit Datenbankprüfsumme, App-Schema und installierten Pluginständen. Das aktuelle UI nimmt keine Anhänge in das Backup auf.

Die maximale Archivgröße setzt `FALKENWARTE_BACKUP_MAX_BYTES` fest. Der Standardwert beträgt 5 GiB. Die Datei im Container liegt unter `/data/backups`. Datenbank und ZIP liegen damit zunächst im selben Docker-Volume.

Das UI kann nur einen Backupdatensatz wiederherstellen, der noch in der aktuellen Datenbank verzeichnet ist und dessen ZIP unter `/data/backups/<backup-id>.zip` vorhanden ist.

Ein heruntergeladenes ZIP kann derzeit nicht wieder hochgeladen oder importiert werden. Nach Verlust des Docker-Volumes reicht die ZIP-Datei allein daher nicht für einen Restore über die Oberfläche.

## Wiederherstellung anfordern

1. Wähle unter **Einstellungen** den Schalter **Wartungsmodus** und bestätige **Einstellungen speichern**.
2. Warte, bis der Wartungsmodus als **Aktiv** angezeigt wird. Neue und automatische Starts werden nun angehalten.
3. Wähle beim gewünschten fertigen Backup **Zur Wiederherstellung auswählen**, gib einen Grund ein und bestätige **Wiederherstellung anfordern**.
4. Lass den Container und seine Volumes bestehen, während die Wiederherstellung läuft. Der Produktions-Entrypoint stoppt seine eigenen HTTP-, Worker- und Maintenance-Prozesse für den Offline-Austausch.
5. Warte, bis Falkenwarte wieder erreichbar ist, und prüfe den Backupstatus sowie die Betriebslogs.

Vor dem Datenbankaustausch prüft der Offline-Restore Archivpfade, SHA-256, SQLite-Integrität, App-Migrationen und installierte Plugins. Der Austausch bewahrt den vorherigen Datenbankstand unter `/data/restore-previous/<request-id>/` auf. Migrationen und Abschlussabgleich laufen vor dem Neustart der Prozesse.

Wenn der Kompatibilitätstest vor dem Dateiaustausch scheitert, bleibt die bisherige Datenbank aktiv und der Backupstatus zeigt den Fehler. Behebe die gemeldete Inkompatibilität und wähle denselben fehlgeschlagenen Backupdatensatz erneut aus. Der Wartungsmodus bleibt bis zu deiner Entscheidung eingeschaltet.

## T3-Inventur abschließen

Nach erfolgreichem Restore öffne **Einstellungen** und gehe zu **T3-Abgleich nach Wiederherstellung**. Neue T3-Starts bleiben gesperrt, bis jeder aufgeführte Auftrag und jedes unbekannte T3-Projekt einzeln geprüft wurde.

Ein bekannter Auftrag muss in T3 nachweislich beendet sein, bevor du ihn mit einer Begründung klärst.

Einen nicht in Falkenwarte bekannten aktiven Auftrag registrierst du einzeln mit T3-Thread-ID und Begründung. Warte danach, bis T3 sein Ende meldet. Unbekannte Projektaktivität bestätigst du erst nach deiner Prüfung des zugehörigen T3-Projekts.

Wenn jeder Eintrag geklärt ist, gib die gesamte T3-Projektaktivität mit einer eigenen Begründung frei. Die Anwendung aktiviert neue Starts nicht durch ein pauschales Überspringen offener Einträge.

## Unterbrochenen Austausch behandeln

Wenn der Container beim Start `restore-swap-in-progress.json` meldet, lässt der Entrypoint HTTP, Worker und Maintenance gestoppt. Lösche diesen Marker nicht und starte den Dienst nicht wiederholt neu.

Lass den App-Container gestoppt und sichere zuerst das vollständige Docker-Datenvolume mit einem Offline-Volume-Snapshot.

Prüfe anschließend die SQLite-Integrität und SHA-256. Beziehe zusammengehörige `-wal`, `-shm` sowie `-journal`-Dateien unter `/data/falkenwarte.sqlite` und `/data/restore-previous/<request-id>/` mit ein, bevor du einen Datenbankstand auswählst.

Der Wechsel einer Datenbankdatei während dieser Phase ist eine manuelle Reparatur und kann nicht gefahrlos durch das Löschen eines Markers ersetzt werden. Starte HTTP und Worker erst wieder, wenn der gewählte Datenbankstand und sein Restore-Nachweis zueinander passen.
