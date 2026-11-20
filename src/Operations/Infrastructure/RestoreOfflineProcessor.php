<?php

declare(strict_types=1);

namespace App\Operations\Infrastructure;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

final class RestoreOfflineProcessor
{
    private const MAX_MANIFEST_BYTES = 1048576;

    private const COPY_CHUNK_BYTES = 1048576;

    /** @var array<string, mixed>|null */
    private ?array $request = null;

    private ?string $temporaryDatabase = null;

    private bool $canResume = false;

    private bool $exchangeStarted = false;

    public function __construct(
        private readonly string $dataDirectory,
        private readonly string $databasePath,
        private readonly string $backupDirectory,
        private readonly int $backupMaxBytes,
        #[Autowire('%kernel.environment%')]
        private readonly string $appEnvironment,
        #[Autowire('%kernel.project_dir%')]
        private readonly string $projectDirectory,
    ) {
    }

    public function restore(): void
    {
        $this->request = null;
        $this->temporaryDatabase = null;
        $this->canResume = false;
        $this->exchangeStarted = false;

        $dataDirectory = rtrim($this->dataDirectory, '/');
        $requestPath = $dataDirectory.'/restore-request.json';
        $resultPath = $dataDirectory.'/restore-result.json';
        $requestJson = @file_get_contents($requestPath);
        if (false === $requestJson) {
            return;
        }

        try {
            $request = json_decode($requestJson, true, 32, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            $this->failRestore('Der gespeicherte Wiederherstellungsauftrag ist kein gültiges JSON.');
        }
        if (!is_array($request)) {
            $this->failRestore('Der gespeicherte Wiederherstellungsauftrag ist ungültig.');
        }
        foreach (['request_id', 'backup_id', 'database_sha256', 'reason', 'requested_by', 'requested_at'] as $field) {
            if (!isset($request[$field]) || !is_string($request[$field]) || '' === trim($request[$field])) {
                $this->failRestore('Der gespeicherte Wiederherstellungsauftrag ist unvollständig.');
            }
        }
        foreach (['request_id', 'backup_id'] as $field) {
            if (1 !== preg_match('/^[a-f0-9-]{36}$/i', $request[$field])) {
                $this->failRestore('Der gespeicherte Wiederherstellungsauftrag enthält eine ungültige ID.');
            }
        }
        if (isset($request['action_id']) && (!is_string($request['action_id']) || 1 !== preg_match('/^[a-f0-9-]{36}$/i', $request['action_id']))) {
            $this->failRestore('Der gespeicherte Wiederherstellungsauftrag enthält eine ungültige Action-ID.');
        }
        $this->request = $request;
        if (1 !== preg_match('/^[a-f0-9]{64}$/i', $request['database_sha256'])) {
            $this->failRestore('Der gespeicherte Wiederherstellungsauftrag enthält eine ungültige Datenbank-Prüfsumme.');
        }
        $this->canResume = true;

        $failurePath = $dataDirectory.'/restore-failure.json';
        if (is_file($failurePath) || is_link($failurePath)) {
            try {
                $previousFailure = json_decode((string) @file_get_contents($failurePath), true, 32, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                $this->failRestore('Ein vorheriger Restore-Fehlernachweis ist beschädigt.');
            }
            if (!is_array($previousFailure)
                || ($previousFailure['request_id'] ?? null) !== $request['request_id']
                || ($previousFailure['exchange_started'] ?? null) !== false) {
                $this->failRestore('Ein vorheriger Restore-Fehler muss zuerst geprüft werden; der Dienst bleibt gestoppt.');
            }
            if (!unlink($requestPath)) {
                $this->failRestore('Der bereits protokollierte Restore-Auftrag konnte nicht geschlossen werden.');
            }
            $this->syncPath($dataDirectory);

            return;
        }

        if (is_file($resultPath)) {
            try {
                $previousResult = json_decode((string) file_get_contents($resultPath), true, 32, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                $this->failRestore('Ein vorheriges Restore-Ergebnis ist beschädigt.');
            }
            if (!is_array($previousResult) || ($previousResult['request_id'] ?? null) !== $request['request_id']) {
                $this->failRestore('Ein anderes Restore-Ergebnis wartet noch auf den Startabgleich.');
            }
            unlink($requestPath);
            $swapPath = $dataDirectory.'/restore-swap-in-progress.json';
            if (is_file($swapPath) && !unlink($swapPath)) {
                $this->failRestore('Der abgeschlossene Restore-Austauschmarker konnte nicht entfernt werden.');
            }
            $this->syncPath($dataDirectory);

            return;
        }

        $swapPath = $dataDirectory.'/restore-swap-in-progress.json';
        if (is_file($swapPath) || is_link($swapPath)) {
            $this->exchangeStarted = true;
            $this->failRestore('Ein vorheriger Datenbankaustausch wurde unterbrochen; vor dem Neustart sind die Sicherungskopie und der Austauschmarker manuell zu prüfen.');
        }

        $backupDirectory = rtrim($this->backupDirectory, '/');
        $archivePath = $backupDirectory.'/'.$request['backup_id'].'.zip';
        if (!is_file($archivePath) || is_link($archivePath)) {
            $this->failRestore('Das ausgewählte Backuparchiv fehlt oder ist kein regulärer Dateipfad.');
        }

        $archive = new \ZipArchive();
        if (true !== $archive->open($archivePath, \ZipArchive::RDONLY)) {
            $this->failRestore('Das ausgewählte Backuparchiv kann nicht geöffnet werden.');
        }
        $temporaryDatabase = $dataDirectory.'/.restore-'.$request['request_id'].'.sqlite.tmp';
        $this->temporaryDatabase = $temporaryDatabase;
        try {
            if (2 !== $archive->numFiles) {
                $this->failRestore('Das Backuparchiv enthält unerwartete Einträge.');
            }
            $names = [$archive->getNameIndex(0), $archive->getNameIndex(1)];
            sort($names);
            if ($names !== ['database.sqlite', 'manifest.json']) {
                $this->failRestore('Das Backuparchiv enthält unerwartete Pfade.');
            }
            $manifestBytes = $archive->getFromName('manifest.json');
            if (!is_string($manifestBytes) || strlen($manifestBytes) > self::MAX_MANIFEST_BYTES) {
                $this->failRestore('Das Backupmanifest ist ungültig oder zu groß.');
            }
            try {
                $manifest = json_decode($manifestBytes, true, 32, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                $this->failRestore('Das Backupmanifest ist kein gültiges JSON.');
            }
            if (!is_array($manifest)) {
                $this->failRestore('Das Backupmanifest ist ungültig.');
            }
            if (!hash_equals(strtolower($request['database_sha256']), strtolower((string) $manifest['database_sha256']))) {
                $this->failRestore('Der angeforderte Datenbank-Prüfwert stimmt nicht mit dem Backup überein.');
            }

            $maximumBytes = max(1048576, $this->backupMaxBytes);
            $this->extractDatabase($archive, $temporaryDatabase, (string) $manifest['database_sha256'], $maximumBytes);
            $this->validateManifest($manifest, $temporaryDatabase);
        } finally {
            $archive->close();
        }

        $databasePath = $this->databasePath;
        $databaseDirectory = dirname($databasePath);
        if (!is_dir($databaseDirectory) || realpath($databaseDirectory) !== $databaseDirectory) {
            unlink($temporaryDatabase);
            $this->failRestore('Das Datenbankverzeichnis ist nicht verfügbar oder verwendet symbolische Links.');
        }

        $previousDirectory = $dataDirectory.'/restore-previous/'.$request['request_id'];
        if (!is_dir($previousDirectory) && !mkdir($previousDirectory, 0700, true) && !is_dir($previousDirectory)) {
            unlink($temporaryDatabase);
            $this->failRestore('Die bisherige Datenbank kann nicht gesichert werden.');
        }

        $this->writeMarker($swapPath, [
            'request_id' => $request['request_id'],
            'backup_id' => $request['backup_id'],
            'started_at' => gmdate('Y-m-d\TH:i:s\Z'),
            'stage' => 'database_exchange_started',
        ]);
        $this->exchangeStarted = true;

        if (is_file($databasePath) || is_link($databasePath)) {
            $previousDatabase = $previousDirectory.'/original.sqlite';
            if (is_file($previousDatabase) || is_link($previousDatabase)) {
                $previousDatabase = $previousDirectory.'/retry-'.gmdate('YmdHis').'-'.bin2hex(random_bytes(4)).'.sqlite';
            }
            if (!rename($databasePath, $previousDatabase)) {
                unlink($temporaryDatabase);
                $this->failRestore('Die bisherige Datenbank kann nicht sicher verschoben werden.');
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
                    $this->failRestore('Eine SQLite-WAL-Datei kann nicht sicher verschoben werden.');
                }
            }
        }

        if (!rename($temporaryDatabase, $databasePath)) {
            unlink($temporaryDatabase);
            $this->failRestore('Die geprüfte Datenbank kann nicht eingesetzt werden.');
        }
        chmod($databasePath, 0600);
        $this->syncPath($databaseDirectory);

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
        if (is_string($request['action_id'] ?? null)) {
            $result['action_id'] = $request['action_id'];
        }
        $this->writeMarker($resultPath, $result);
        if (is_file($swapPath) && !unlink($swapPath)) {
            $this->failRestore('Der abgeschlossene Restore-Austauschmarker konnte nicht entfernt werden.');
        }
        unlink($requestPath);
        $this->syncPath($dataDirectory);
    }

    private function failRestore(string $message): never
    {
        $request = $this->request;
        $dataDirectory = rtrim($this->dataDirectory, '/');
        if (is_array($request)
            && $this->canResume
            && !$this->exchangeStarted) {
            $temporaryDatabase = $this->temporaryDatabase;
            if (is_string($temporaryDatabase) && is_file($temporaryDatabase) && !is_link($temporaryDatabase)) {
                unlink($temporaryDatabase);
            }

            $failure = [
                'request_id' => $request['request_id'],
                'backup_id' => $request['backup_id'],
                'reason' => $request['reason'],
                'requested_by' => $request['requested_by'],
                'requested_at' => $request['requested_at'],
                'database_sha256' => strtolower((string) $request['database_sha256']),
                'failed_at' => gmdate('Y-m-d\TH:i:s\Z'),
                'failure_message' => mb_substr($message, 0, 500),
                'exchange_started' => false,
            ];
            if (is_string($request['action_id'] ?? null)) {
                $failure['action_id'] = $request['action_id'];
            }
            $failurePath = $dataDirectory.'/restore-failure.json';
            $failureTemporary = $failurePath.'.'.bin2hex(random_bytes(8)).'.tmp';
            $handle = fopen($failureTemporary, 'xb');
            if (false === $handle) {
                throw new OfflineRestoreAbort('Das fehlgeschlagene Restore konnte nicht dauerhaft protokolliert werden; der Dienst bleibt gestoppt.', 1);
            }
            chmod($failureTemporary, 0600);
            try {
                $contents = json_encode($failure, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
                if (fwrite($handle, $contents) !== strlen($contents) || !fflush($handle)) {
                    throw new OfflineRestoreAbort('Das fehlgeschlagene Restore konnte nicht dauerhaft protokolliert werden; der Dienst bleibt gestoppt.', 1);
                }
                if (function_exists('fsync')) {
                    fsync($handle);
                }
            } finally {
                fclose($handle);
            }
            if (is_file($failurePath) || is_link($failurePath) || !rename($failureTemporary, $failurePath)) {
                unlink($failureTemporary);
                throw new OfflineRestoreAbort('Ein vorheriger Restore-Fehler muss zuerst geprüft werden; der Dienst bleibt gestoppt.', 1);
            }
            $requestPath = $dataDirectory.'/restore-request.json';
            if (!unlink($requestPath)) {
                throw new OfflineRestoreAbort('Der fehlgeschlagene Restore-Auftrag konnte nicht geschlossen werden; der Dienst bleibt gestoppt.', 1);
            }
            $this->syncPath($dataDirectory);
            throw new OfflineRestoreAbort($message.PHP_EOL.'Die bisherige Datenbank blieb unverändert; der Wartungsmodus bleibt aktiv.', 0);
        }

        throw new OfflineRestoreAbort($message, 1);
    }

    private function syncPath(string $path): void
    {
        if (!function_exists('fsync')) {
            return;
        }
        $handle = fopen($path, 'r');
        if (false !== $handle) {
            fsync($handle);
            fclose($handle);
        }
    }

    /** @param array<string, mixed> $data */
    private function writeMarker(string $path, array $data): void
    {
        $temporaryPath = $path.'.'.bin2hex(random_bytes(8)).'.tmp';
        $handle = fopen($temporaryPath, 'xb');
        if (false === $handle) {
            $this->failRestore('Restore-Ergebnis kann nicht temporär abgelegt werden.');
        }
        chmod($temporaryPath, 0600);
        try {
            $contents = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            if (fwrite($handle, $contents) !== strlen($contents) || !fflush($handle)) {
                $this->failRestore('Restore-Ergebnis kann nicht dauerhaft geschrieben werden.');
            }
            if (function_exists('fsync')) {
                fsync($handle);
            }
        } finally {
            fclose($handle);
        }

        if (!rename($temporaryPath, $path)) {
            unlink($temporaryPath);
            $this->failRestore('Restore-Ergebnis kann nicht veröffentlicht werden.');
        }
        $this->syncPath(dirname($path));
    }

    /** @param array<string, mixed> $manifest */
    private function validateManifest(array $manifest, string $databasePath): void
    {
        $requiredKeys = ['app_version', 'schema_version', 'plugin_versions', 'database_sha256', 'artifact_count', 'artifact_manifest_sha256'];
        $keys = array_keys($manifest);
        sort($keys);
        sort($requiredKeys);
        if ($keys !== $requiredKeys) {
            $this->failRestore('Das Backupmanifest enthält nicht unterstützte Felder.');
        }
        foreach (['app_version', 'schema_version', 'database_sha256', 'artifact_manifest_sha256'] as $field) {
            if (!is_string($manifest[$field]) || '' === trim($manifest[$field])) {
                $this->failRestore('Das Backupmanifest ist unvollständig.');
            }
        }
        if (1 !== preg_match('/^[a-f0-9]{64}$/i', $manifest['database_sha256']) || 1 !== preg_match('/^[a-f0-9]{64}$/i', $manifest['artifact_manifest_sha256'])) {
            $this->failRestore('Das Backupmanifest enthält eine ungültige Prüfsumme.');
        }
        if (!is_int($manifest['artifact_count']) || 0 !== $manifest['artifact_count']) {
            $this->failRestore('Dieses Image kann die im Backup verzeichneten Dateien nicht wiederherstellen.');
        }
        if (!is_array($manifest['plugin_versions'])) {
            $this->failRestore('Die Pluginversionen im Backupmanifest sind ungültig.');
        }
        $backupPlugins = [];
        foreach ($manifest['plugin_versions'] as $plugin) {
            if (!is_array($plugin)
                || [] !== array_diff(array_keys($plugin), ['plugin_id', 'version'])
                || !is_string($plugin['plugin_id'] ?? null)
                || 1 !== preg_match('/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/D', $plugin['plugin_id'])
                || !is_string($plugin['version'] ?? null)
                || 1 !== preg_match('/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/D', $plugin['version'])
                || isset($backupPlugins[$plugin['plugin_id']])) {
                $this->failRestore('Die Pluginversionen im Backupmanifest sind ungültig.');
            }
            $backupPlugins[$plugin['plugin_id']] = $plugin['version'];
        }

        $installedPlugins = $this->installedPluginManifests();
        foreach ($backupPlugins as $pluginId => $backupVersion) {
            $installed = $installedPlugins[$pluginId] ?? null;
            if (!is_array($installed) || version_compare((string) $installed['version'], $backupVersion, '<')) {
                $this->failRestore(sprintf('Das Plugin "%s" in Version %s wird von diesem Image nicht unterstützt.', $pluginId, $backupVersion));
            }
        }

        $currentVersion = trim((string) @file_get_contents($this->projectDirectory.'/version.txt'));
        if ('' === $currentVersion || version_compare($manifest['app_version'], $currentVersion, '>')) {
            $this->failRestore('Das Backup wurde mit einer neueren, nicht kompatiblen Appversion erstellt.');
        }

        $database = new \SQLite3($databasePath, SQLITE3_OPEN_READONLY);
        try {
            $integrity = $database->querySingle('PRAGMA integrity_check');
            if ('ok' !== $integrity) {
                $this->failRestore('Die Datenbank besteht die SQLite-Integritätsprüfung nicht.');
            }
            $versions = $database->query('SELECT version FROM doctrine_migration_versions ORDER BY version');
            if (false === $versions) {
                $this->failRestore('Der Datenbank-Migrationsstand fehlt.');
            }
            $applicationVersions = [];
            $pluginVersions = [];
            $pluginNamespaces = [];
            foreach ($installedPlugins as $pluginId => $plugin) {
                $namespace = trim((string) ($plugin['migrations']['namespace'] ?? ''), '\\');
                if ('' !== $namespace) {
                    $pluginNamespaces[$namespace.'\\'] = $pluginId;
                }
            }
            $seen = [];
            while ($row = $versions->fetchArray(SQLITE3_ASSOC)) {
                $migration = ltrim((string) ($row['version'] ?? ''), '\\');
                if ('' === $migration || isset($seen[$migration]) || !class_exists($migration)) {
                    $this->failRestore('Das Backup enthält einen Migrationsstand, der in diesem Image nicht unterstützt wird.');
                }
                $seen[$migration] = true;
                if (str_starts_with($migration, 'DoctrineMigrations\\')) {
                    $applicationVersions[] = $migration;
                    continue;
                }
                $matchedPlugin = false;
                foreach ($pluginNamespaces as $namespace => $pluginId) {
                    if (str_starts_with($migration, $namespace)) {
                        $matchedPlugin = true;
                        if (!array_key_exists($pluginId, $backupPlugins)) {
                            $this->failRestore('Ein Pluginmigrationsstand fehlt im Backupmanifest.');
                        }
                        $pluginVersions[$pluginId][] = $migration;
                        break;
                    }
                }
                if (!$matchedPlugin) {
                    $this->failRestore('Das Backup enthält eine Pluginmigration ohne kompatibles Pluginmanifest.');
                }
            }
            $latestApplicationVersion = [] === $applicationVersions ? null : end($applicationVersions);
            if (null === $latestApplicationVersion || $latestApplicationVersion !== $manifest['schema_version']) {
                $this->failRestore('Der Datenbank-Migrationsstand stimmt nicht mit dem Backupmanifest überein.');
            }
            $this->assertMigrationFilesPresent($this->projectDirectory.'/migrations', 'DoctrineMigrations', $applicationVersions, $latestApplicationVersion);
            foreach ($pluginVersions as $pluginId => $applied) {
                $plugin = $installedPlugins[$pluginId];
                $package = (string) ($plugin['backend']['composer_package'] ?? '');
                if (1 !== preg_match('#^[a-z0-9_.-]+/[a-z0-9_.-]+$#D', $package)) {
                    $this->failRestore('Das Backup verweist auf ein Plugin ohne vertrauenswürdigen Paketpfad.');
                }
                $namespace = trim((string) $plugin['migrations']['namespace'], '\\');
                $this->assertMigrationFilesPresent($this->projectDirectory.'/vendor/'.$package.'/src/Migrations', $namespace, $applied, (string) end($applied));
            }
        } finally {
            $database->close();
        }
    }

    /**
     * @param list<string> $applied
     */
    private function assertMigrationFilesPresent(string $directory, string $namespace, array $applied, string $latestApplied): void
    {
        $appliedSet = array_fill_keys($applied, true);
        $expectedPrefix = trim($namespace, '\\').'\\';
        foreach (glob(rtrim($directory, '/').'/*.php') ?: [] as $path) {
            $name = pathinfo($path, PATHINFO_FILENAME);
            if (1 !== preg_match('/^Version\d+$/D', $name)) {
                continue;
            }
            $version = $expectedPrefix.$name;
            if (strcmp($version, $latestApplied) <= 0 && !isset($appliedSet[$version])) {
                $this->failRestore('Der Backup-Migrationsstand ist unvollständig; eine ältere App- oder Pluginmigration fehlt.');
            }
        }
    }

    /** @return array<string, array<string, mixed>> */
    private function installedPluginManifests(): array
    {
        $root = $this->projectDirectory;
        $manifests = [];
        $paths = array_merge(
            glob($root.'/vendor/falkenwarte/*/manifest.json') ?: [],
            glob($root.'/packages/*/manifest.json') ?: [],
        );
        if ('test' === $this->appEnvironment) {
            $paths = array_merge(
                $paths,
                glob($root.'/tests/Fixtures/Plugins/manifest.json') ?: [],
                glob($root.'/tests/Fixtures/Plugins/*/manifest.json') ?: [],
            );
        }
        foreach (array_unique($paths) as $path) {
            if (!is_file($path) || is_link($path)) {
                continue;
            }
            $bytes = @file_get_contents($path);
            if (false === $bytes || strlen($bytes) > self::MAX_MANIFEST_BYTES) {
                continue;
            }
            try {
                $manifest = json_decode($bytes, true, 32, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                continue;
            }
            if (!is_array($manifest)
                || !is_string($manifest['id'] ?? null)
                || !is_string($manifest['version'] ?? null)
                || !is_array($manifest['migrations'] ?? null)) {
                continue;
            }
            $manifests[$manifest['id']] = $manifest;
        }

        return $manifests;
    }

    private function extractDatabase(\ZipArchive $archive, string $temporaryPath, string $expectedHash, int $maximumBytes): void
    {
        $entry = $archive->statName('database.sqlite');
        if (!is_array($entry) || $entry['size'] <= 0 || $entry['size'] > $maximumBytes) {
            $this->failRestore('Die Datenbankdatei im Backup hat eine unzulässige Größe.');
        }

        $input = $archive->getStream('database.sqlite');
        $output = fopen($temporaryPath, 'xb');
        if (false === $input || false === $output) {
            if (is_resource($input)) {
                fclose($input);
            }
            if (is_resource($output)) {
                fclose($output);
            }
            $this->failRestore('Die Datenbankdatei im Backup kann nicht gelesen werden.');
        }

        chmod($temporaryPath, 0600);
        $hash = hash_init('sha256');
        try {
            $bytesWritten = 0;
            while (!feof($input)) {
                $chunk = fread($input, self::COPY_CHUNK_BYTES);
                if (false === $chunk) {
                    $this->failRestore('Die Datenbankdatei im Backup kann nicht vollständig gelesen werden.');
                }
                if ('' === $chunk) {
                    continue;
                }
                $bytesWritten += strlen($chunk);
                if ($bytesWritten > $maximumBytes || fwrite($output, $chunk) !== strlen($chunk)) {
                    $this->failRestore('Die Datenbankdatei im Backup ist zu groß oder konnte nicht geschrieben werden.');
                }
                hash_update($hash, $chunk);
            }
            if ($bytesWritten !== (int) $entry['size'] || !hash_equals(strtolower($expectedHash), hash_final($hash))) {
                $this->failRestore('Die Datenbank-Prüfsumme des Backups stimmt nicht.');
            }
            if (!fflush($output)) {
                $this->failRestore('Die Datenbankdatei kann nicht dauerhaft geschrieben werden.');
            }
            if (function_exists('fsync')) {
                fsync($output);
            }
        } finally {
            fclose($input);
            fclose($output);
        }
    }
}
