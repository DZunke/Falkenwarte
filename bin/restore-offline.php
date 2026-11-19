<?php
declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';

const MAX_MANIFEST_BYTES = 1048576;
const COPY_CHUNK_BYTES = 1048576;

function failRestore(string $message): never
{
    fwrite(STDERR, $message.PHP_EOL);
    exit(1);
}

function syncPath(string $path): void
{
    if (!function_exists('fsync')) {
        return;
    }
    $handle = fopen($path, 'r');
    if ($handle !== false) {
        fsync($handle);
        fclose($handle);
    }
}

function syncFile(string $path): void
{
    if (!function_exists('fsync')) {
        return;
    }
    $handle = fopen($path, 'rb');
    if ($handle !== false) {
        fsync($handle);
        fclose($handle);
    }
}

/** @param array<string, mixed> $data */
function writeMarker(string $path, array $data): void
{
    $temporaryPath = $path.'.'.bin2hex(random_bytes(8)).'.tmp';
    $handle = fopen($temporaryPath, 'xb');
    if ($handle === false) {
        failRestore('Restore-Ergebnis kann nicht temporär abgelegt werden.');
    }
    chmod($temporaryPath, 0600);
    try {
        $contents = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (fwrite($handle, $contents) !== strlen($contents) || !fflush($handle)) {
            failRestore('Restore-Ergebnis kann nicht dauerhaft geschrieben werden.');
        }
        if (function_exists('fsync')) {
            fsync($handle);
        }
    } finally {
        fclose($handle);
    }

    if (!rename($temporaryPath, $path)) {
        unlink($temporaryPath);
        failRestore('Restore-Ergebnis kann nicht veröffentlicht werden.');
    }
    syncPath(dirname($path));
}

/** @param array<string, mixed> $manifest */
function validateManifest(array $manifest, string $databasePath): void
{
    $requiredKeys = ['app_version', 'schema_version', 'plugin_versions', 'database_sha256', 'artifact_count', 'artifact_manifest_sha256'];
    $keys = array_keys($manifest);
    sort($keys);
    sort($requiredKeys);
    if ($keys !== $requiredKeys) {
        failRestore('Das Backupmanifest enthält nicht unterstützte Felder.');
    }
    foreach (['app_version', 'schema_version', 'database_sha256', 'artifact_manifest_sha256'] as $field) {
        if (!is_string($manifest[$field]) || trim($manifest[$field]) === '') {
            failRestore('Das Backupmanifest ist unvollständig.');
        }
    }
    if (preg_match('/^[a-f0-9]{64}$/i', $manifest['database_sha256']) !== 1 || preg_match('/^[a-f0-9]{64}$/i', $manifest['artifact_manifest_sha256']) !== 1) {
        failRestore('Das Backupmanifest enthält eine ungültige Prüfsumme.');
    }
    if (!is_int($manifest['artifact_count']) || $manifest['artifact_count'] !== 0) {
        failRestore('Dieses Image kann die im Backup verzeichneten Dateien nicht wiederherstellen.');
    }
    if (!is_array($manifest['plugin_versions'])) {
        failRestore('Die Pluginversionen im Backupmanifest sind ungültig.');
    }

    $currentVersion = trim((string) @file_get_contents(dirname(__DIR__).'/version.txt'));
    if ($currentVersion === '' || version_compare($manifest['app_version'], $currentVersion, '>')) {
        failRestore('Das Backup wurde mit einer neueren, nicht kompatiblen Appversion erstellt.');
    }

    $database = new SQLite3($databasePath, SQLITE3_OPEN_READONLY);
    try {
        $integrity = $database->querySingle('PRAGMA integrity_check');
        if ($integrity !== 'ok') {
            failRestore('Die Datenbank besteht die SQLite-Integritätsprüfung nicht.');
        }
        $versions = $database->query('SELECT version FROM doctrine_migration_versions ORDER BY version');
        if ($versions === false) {
            failRestore('Der Datenbank-Migrationsstand fehlt.');
        }
        $lastVersion = null;
        while ($row = $versions->fetchArray(SQLITE3_ASSOC)) {
            $lastVersion = (string) ($row['version'] ?? '');
            if ($lastVersion === '' || !class_exists($lastVersion)) {
                failRestore('Das Backup enthält einen Migrationsstand, der in diesem Image nicht unterstützt wird.');
            }
        }
        if ($lastVersion === null || $lastVersion !== $manifest['schema_version']) {
            failRestore('Der Datenbank-Migrationsstand stimmt nicht mit dem Backupmanifest überein.');
        }
    } finally {
        $database->close();
    }
}

function extractDatabase(ZipArchive $archive, string $temporaryPath, string $expectedHash, int $maximumBytes): void
{
    $entry = $archive->statName('database.sqlite');
    if (!is_array($entry) || (int) ($entry['size'] ?? 0) <= 0 || (int) $entry['size'] > $maximumBytes) {
        failRestore('Die Datenbankdatei im Backup hat eine unzulässige Größe.');
    }

    $input = $archive->getStream('database.sqlite');
    $output = fopen($temporaryPath, 'xb');
    if ($input === false || $output === false) {
        if (is_resource($input)) {
            fclose($input);
        }
        if (is_resource($output)) {
            fclose($output);
        }
        failRestore('Die Datenbankdatei im Backup kann nicht gelesen werden.');
    }

    chmod($temporaryPath, 0600);
    $hash = hash_init('sha256');
    try {
        $bytesWritten = 0;
        while (!feof($input)) {
            $chunk = fread($input, COPY_CHUNK_BYTES);
            if ($chunk === false) {
                failRestore('Die Datenbankdatei im Backup kann nicht vollständig gelesen werden.');
            }
            if ($chunk === '') {
                continue;
            }
            $bytesWritten += strlen($chunk);
            if ($bytesWritten > $maximumBytes || fwrite($output, $chunk) !== strlen($chunk)) {
                failRestore('Die Datenbankdatei im Backup ist zu groß oder konnte nicht geschrieben werden.');
            }
            hash_update($hash, $chunk);
        }
        if ($bytesWritten !== (int) $entry['size'] || !hash_equals(strtolower($expectedHash), hash_final($hash))) {
            failRestore('Die Datenbank-Prüfsumme des Backups stimmt nicht.');
        }
        if (!fflush($output)) {
            failRestore('Die Datenbankdatei kann nicht dauerhaft geschrieben werden.');
        }
        if (function_exists('fsync')) {
            fsync($output);
        }
    } finally {
        fclose($input);
        fclose($output);
    }
}

$dataDirectory = rtrim(getenv('FALKENWARTE_DATA_DIR') ?: '/data', '/');
$requestPath = $dataDirectory.'/restore-request.json';
$resultPath = $dataDirectory.'/restore-result.json';
$requestJson = @file_get_contents($requestPath);
if ($requestJson === false) {
    exit(0);
}

try {
    $request = json_decode($requestJson, true, 32, JSON_THROW_ON_ERROR);
} catch (Throwable) {
    failRestore('Der gespeicherte Wiederherstellungsauftrag ist kein gültiges JSON.');
}
if (!is_array($request)) {
    failRestore('Der gespeicherte Wiederherstellungsauftrag ist ungültig.');
}
foreach (['request_id', 'backup_id', 'database_sha256', 'reason', 'requested_by', 'requested_at'] as $field) {
    if (!isset($request[$field]) || !is_string($request[$field]) || trim($request[$field]) === '') {
        failRestore('Der gespeicherte Wiederherstellungsauftrag ist unvollständig.');
    }
}
foreach (['request_id', 'backup_id'] as $field) {
    if (preg_match('/^[a-f0-9-]{36}$/i', $request[$field]) !== 1) {
        failRestore('Der gespeicherte Wiederherstellungsauftrag enthält eine ungültige ID.');
    }
}
if (preg_match('/^[a-f0-9]{64}$/i', $request['database_sha256']) !== 1) {
    failRestore('Der gespeicherte Wiederherstellungsauftrag enthält eine ungültige Datenbank-Prüfsumme.');
}

if (is_file($resultPath)) {
    try {
        $previousResult = json_decode((string) file_get_contents($resultPath), true, 32, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        failRestore('Ein vorheriges Restore-Ergebnis ist beschädigt.');
    }
    if (!is_array($previousResult) || ($previousResult['request_id'] ?? null) !== $request['request_id']) {
        failRestore('Ein anderes Restore-Ergebnis wartet noch auf den Startabgleich.');
    }
    unlink($requestPath);
    syncPath($dataDirectory);
    exit(0);
}

$backupDirectory = rtrim(getenv('FALKENWARTE_BACKUP_DIR') ?: $dataDirectory.'/backups', '/');
$archivePath = $backupDirectory.'/'.$request['backup_id'].'.zip';
if (!is_file($archivePath) || is_link($archivePath)) {
    failRestore('Das ausgewählte Backuparchiv fehlt oder ist kein regulärer Dateipfad.');
}

$archive = new ZipArchive();
if ($archive->open($archivePath, ZipArchive::RDONLY) !== true) {
    failRestore('Das ausgewählte Backuparchiv kann nicht geöffnet werden.');
}
$temporaryDatabase = $dataDirectory.'/.restore-'.$request['request_id'].'.sqlite.tmp';
try {
    if ($archive->numFiles !== 2) {
        failRestore('Das Backuparchiv enthält unerwartete Einträge.');
    }
    $names = [$archive->getNameIndex(0), $archive->getNameIndex(1)];
    sort($names);
    if ($names !== ['database.sqlite', 'manifest.json']) {
        failRestore('Das Backuparchiv enthält unerwartete Pfade.');
    }
    $manifestBytes = $archive->getFromName('manifest.json');
    if (!is_string($manifestBytes) || strlen($manifestBytes) > MAX_MANIFEST_BYTES) {
        failRestore('Das Backupmanifest ist ungültig oder zu groß.');
    }
    try {
        $manifest = json_decode($manifestBytes, true, 32, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        failRestore('Das Backupmanifest ist kein gültiges JSON.');
    }
    if (!is_array($manifest)) {
        failRestore('Das Backupmanifest ist ungültig.');
    }
    if (!hash_equals(strtolower($request['database_sha256']), strtolower((string) $manifest['database_sha256']))) {
        failRestore('Der angeforderte Datenbank-Prüfwert stimmt nicht mit dem Backup überein.');
    }

    $maximumBytes = max(1048576, (int) (getenv('FALKENWARTE_BACKUP_MAX_BYTES') ?: 5368709120));
    extractDatabase($archive, $temporaryDatabase, (string) $manifest['database_sha256'], $maximumBytes);
    validateManifest($manifest, $temporaryDatabase);
} finally {
    $archive->close();
}

$databasePath = getenv('FALKENWARTE_DB') ?: $dataDirectory.'/falkenwarte.sqlite';
$databaseDirectory = dirname($databasePath);
if (!is_dir($databaseDirectory) || realpath($databaseDirectory) !== $databaseDirectory) {
    unlink($temporaryDatabase);
    failRestore('Das Datenbankverzeichnis ist nicht verfügbar oder verwendet symbolische Links.');
}

$previousDirectory = $dataDirectory.'/restore-previous/'.$request['request_id'];
if (!is_dir($previousDirectory) && !mkdir($previousDirectory, 0700, true) && !is_dir($previousDirectory)) {
    unlink($temporaryDatabase);
    failRestore('Die bisherige Datenbank kann nicht gesichert werden.');
}

if (is_file($databasePath) || is_link($databasePath)) {
    $previousDatabase = $previousDirectory.'/original.sqlite';
    if (is_file($previousDatabase) || is_link($previousDatabase)) {
        $previousDatabase = $previousDirectory.'/retry-'.gmdate('YmdHis').'-'.bin2hex(random_bytes(4)).'.sqlite';
    }
    if (!rename($databasePath, $previousDatabase)) {
        unlink($temporaryDatabase);
        failRestore('Die bisherige Datenbank kann nicht sicher verschoben werden.');
    }
}

foreach (['-wal', '-shm', '-journal'] as $suffix) {
    $sidecar = $databasePath.$suffix;
    if (is_file($sidecar) || is_link($sidecar)) {
        $previousSidecar = $previousDirectory.'/original.sqlite'.$suffix;
        if (is_file($previousSidecar) || is_link($previousSidecar)) {
            $previousSidecar = $previousDirectory.'/retry-'.gmdate('YmdHis').'-'.bin2hex(random_bytes(4)).'.sqlite'.$suffix;
        }
        if (!rename($sidecar, $previousSidecar)) {
            unlink($temporaryDatabase);
            failRestore('Eine SQLite-WAL-Datei kann nicht sicher verschoben werden.');
        }
    }
}

if (!rename($temporaryDatabase, $databasePath)) {
    unlink($temporaryDatabase);
    failRestore('Die geprüfte Datenbank kann nicht eingesetzt werden.');
}
chmod($databasePath, 0600);
syncPath($databaseDirectory);

$completedAt = gmdate('Y-m-d\TH:i:s\Z');
$result = [
    'request_id' => $request['request_id'],
    'backup_id' => $request['backup_id'],
    'reason' => $request['reason'],
    'requested_by' => $request['requested_by'],
    'requested_at' => $request['requested_at'],
    'completed_at' => $completedAt,
    'database_sha256' => strtolower((string) $manifest['database_sha256']),
];
writeMarker($resultPath, $result);
unlink($requestPath);
syncPath($dataDirectory);
