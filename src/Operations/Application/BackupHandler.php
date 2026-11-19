<?php

declare(strict_types=1);

namespace App\Operations\Application;

use App\Extensions\Application\PluginManifestReader;
use App\Shared\Application\Actor;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;

final class BackupHandler
{
    public function __construct(public Store $store, private readonly MigrationVersionReader $migrationVersions, private readonly PluginManifestReader $plugins)
    {
    }

    public function handles(string $op): bool
    {
        return in_array($op, ['backups_list', 'backups_create', 'backups_get', 'backup_content_get', 'backups_restore'], true);
    }

    /** @param array<string, mixed> $p @param array<string, mixed> $body @return array<string, mixed> */
    public function handle(string $op, array $p, array $body, Actor $actor): array
    {
        $actor->requireOwner();

        return match ($op) {
            'backups_list' => $this->list($p),
            'backups_create' => $this->create($body),
            'backups_get' => $this->get($this->pathId($p)),
            'backup_content_get' => $this->content($this->pathId($p)),
            'backups_restore' => $this->restore($this->pathId($p), $body, $actor),
            default => throw new Problem(404, 'operation_not_found', 'Unbekannte Betriebsoperation.'),
        };
    }

    /** @param array<string, mixed> $payload */
    public function work(string $kind, array $payload): void
    {
        match ($kind) {
            'backup.create' => $this->createArchive($payload),
            'restore.request' => $this->writeRestoreRequest($payload),
            default => throw new Problem(400, 'operation_not_found', 'Unbekannter Backupauftrag.'),
        };
    }

    /** @param array<string, mixed> $marker */
    public function finalizeRestoredBackup(array $marker): void
    {
        $id = $this->payloadId($marker, 'backup_id');
        $expectedHash = strtolower((string) ($marker['database_sha256'] ?? ''));
        $job = $this->store->find('backups', $id);
        if (null === $job) {
            throw new Problem(409, 'backup_restore_record_missing', 'Der wiederhergestellte Datenbankstand enthält den Backupauftrag nicht.');
        }

        $zip = new \ZipArchive();
        if (true !== $zip->open($this->archivePath($id), \ZipArchive::RDONLY)) {
            throw new Problem(409, 'backup_invalid', 'Das wiederhergestellte Backupmanifest kann nicht gelesen werden.');
        }
        try {
            $bytes = $zip->getFromName('manifest.json');
        } finally {
            $zip->close();
        }
        if (!is_string($bytes) || strlen($bytes) > 1048576) {
            throw new Problem(409, 'backup_invalid', 'Das wiederhergestellte Backupmanifest ist ungültig.');
        }

        try {
            $manifest = json_decode($bytes, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new Problem(409, 'backup_invalid', 'Das wiederhergestellte Backupmanifest ist ungültiges JSON.');
        }
        if (!is_array($manifest)
            || !isset($manifest['database_sha256'])
            || !is_string($manifest['database_sha256'])
            || !hash_equals($expectedHash, strtolower($manifest['database_sha256']))) {
            throw new Problem(409, 'backup_checksum_mismatch', 'Der Restore-Nachweis passt nicht zum gesicherten Datenbankstand.');
        }
        $this->verifyArchive($id, $manifest);

        if (($job['status'] ?? null) === 'ready' && $this->canonicalJson($job['manifest'] ?? []) === $this->canonicalJson($manifest)) {
            return;
        }

        $job['status'] = 'ready';
        $job['manifest'] = $manifest;
        $job['download_url'] = '/api/v1/backups/'.$id.'/content';
        $job['error'] = null;
        $this->store->save('backups', $job, 'backup.restore_finalized');
    }

    /** @param array<string, mixed> $marker */
    public function finalizeFailedRestore(array $marker): void
    {
        $id = $this->payloadId($marker, 'backup_id');
        $requestId = $this->payloadId($marker, 'request_id');
        $job = $this->store->find('backups', $id);
        if (null === $job) {
            throw new Problem(409, 'backup_restore_record_missing', 'Der fehlgeschlagene Wiederherstellungsauftrag ist in der Datenbank nicht vorhanden.');
        }
        if (($job['restore_request_id'] ?? null) !== $requestId) {
            throw new Problem(409, 'backup_restore_request_mismatch', 'Der Fehlernachweis passt nicht zum angeforderten Wiederherstellungsauftrag.');
        }
        if (($job['status'] ?? null) === 'failed' && is_string($job['error'] ?? null)) {
            return;
        }
        if (($job['status'] ?? null) !== 'restoring') {
            throw new Problem(409, 'backup_restore_state_invalid', 'Der Wiederherstellungsauftrag kann nicht als fehlgeschlagen abgeschlossen werden.');
        }

        $job['status'] = 'failed';
        $job['error'] = mb_substr(trim((string) ($marker['failure_message'] ?? 'Die Wiederherstellung wurde vor dem Datenbankaustausch abgebrochen.')), 0, 300);
        $this->store->save('backups', $job, 'backup.restore_failed');
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function list(array $p): array
    {
        $jobs = array_map(fn (array $job): array => $this->view($job), $this->store->all('backups'));
        usort($jobs, static fn (array $left, array $right): int => strcmp($right['created_at'], $left['created_at']));

        return $this->store->page($jobs, $p);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function create(array $body): array
    {
        $job = $this->store->save('backups', [
            'status' => 'queued',
            'manifest' => null,
            'download_url' => null,
            'error' => null,
            'include_artifacts' => (bool) ($body['include_artifacts'] ?? false),
        ], 'backup.queued');
        $this->store->enqueue('backup.create', ['backup_id' => $job['id']]);

        return $this->store->accepted(['resource_type' => 'backup', 'id' => $job['id'], 'version' => $job['version']]);
    }

    /** @return array<string, mixed> */
    private function get(string $id): array
    {
        return $this->view($this->store->get('backups', $id));
    }

    /** @return array<string, mixed> */
    private function content(string $id): array
    {
        $job = $this->store->get('backups', $id);
        if (($job['status'] ?? null) !== 'ready') {
            throw new Problem(409, 'backup_not_ready', 'Das Backup ist noch nicht zum Herunterladen bereit.');
        }

        $path = $this->archivePath($id);
        if (!is_file($path)) {
            throw new Problem(404, 'resource_not_found', 'Die Backupdatei wurde nicht gefunden.');
        }

        return ['_file' => $path, '_filename' => 'falkenwarte-backup-'.$id.'.zip', '_content_type' => 'application/zip'];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function restore(string $id, array $body, Actor $actor): array
    {
        $job = $this->store->get('backups', $id);
        if (!in_array($job['status'] ?? null, ['ready', 'failed'], true) || !is_array($job['manifest'] ?? null)) {
            throw new Problem(409, 'backup_not_ready', 'Nur ein geprüftes, fertiges Backup kann wiederhergestellt werden.');
        }

        $expectedHash = strtolower((string) ($body['database_sha256'] ?? ''));
        $actualHash = strtolower((string) ($job['manifest']['database_sha256'] ?? ''));
        if ('' === $expectedHash || !hash_equals($actualHash, $expectedHash)) {
            throw new Problem(409, 'backup_checksum_mismatch', 'Der bestätigte Datenbank-Prüfwert stimmt nicht mit dem Backup überein.');
        }

        $this->verifyArchive($id, $job['manifest']);

        if (is_file($this->restoreRequestPath())) {
            throw new Problem(409, 'restore_already_pending', 'Eine Wiederherstellung wartet bereits auf den Wartungsmodus.');
        }

        $requestId = $this->store->id();
        $requestedAt = $this->store->now();
        $job['status'] = 'restoring';
        $job['error'] = null;
        $job['restore_request_id'] = $requestId;
        $job['restore_reason'] = trim((string) ($body['reason'] ?? ''));
        $job = $this->store->save('backups', $job, 'backup.restore_requested');

        $this->store->enqueue('restore.request', [
            'request_id' => $requestId,
            'backup_id' => $id,
            'database_sha256' => $actualHash,
            'reason' => $job['restore_reason'],
            'requested_by' => $actor->id,
            'requested_at' => $requestedAt,
        ]);

        return $this->store->accepted(['resource_type' => 'backup', 'id' => $id, 'version' => $job['version']]);
    }

    /** @param array<string, mixed> $payload */
    private function createArchive(array $payload): void
    {
        $id = $this->payloadId($payload, 'backup_id');
        $job = $this->store->find('backups', $id);
        if (null === $job || in_array($job['status'] ?? '', ['ready', 'failed'], true)) {
            return;
        }

        $job['status'] = 'running';
        $job['error'] = null;
        $this->store->save('backups', $job, 'backup.started');

        $temporaryDirectory = null;
        $temporaryArchive = $this->archivePath($id).'.tmp';
        try {
            if (!class_exists(\ZipArchive::class)) {
                throw new Problem(503, 'backup_unavailable', 'Die ZIP-Erweiterung ist im Laufzeitimage nicht verfügbar.');
            }

            $directory = $this->backupDirectory();
            $temporaryDirectory = $directory.'/work-'.$id.'-'.bin2hex(random_bytes(8));
            if (!mkdir($temporaryDirectory, 0700)) {
                throw new Problem(503, 'backup_unavailable', 'Das temporäre Backupverzeichnis kann nicht angelegt werden.');
            }

            $databaseFile = $temporaryDirectory.'/database.sqlite';
            $this->copyDatabase($databaseFile);
            $databaseHash = hash_file('sha256', $databaseFile);
            if (!is_string($databaseHash)) {
                throw new Problem(503, 'backup_unavailable', 'Die Datenbank-Prüfsumme kann nicht erstellt werden.');
            }

            $manifest = $this->manifest($databaseHash);
            $manifestFile = $temporaryDirectory.'/manifest.json';
            file_put_contents($manifestFile, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), LOCK_EX);
            chmod($manifestFile, 0600);

            $zip = new \ZipArchive();
            if (true !== $zip->open($temporaryArchive, \ZipArchive::CREATE | \ZipArchive::OVERWRITE)) {
                throw new Problem(503, 'backup_unavailable', 'Das Backuparchiv kann nicht erstellt werden.');
            }
            $zip->addFile($databaseFile, 'database.sqlite');
            $zip->addFile($manifestFile, 'manifest.json');
            if (!$zip->close()) {
                throw new Problem(503, 'backup_unavailable', 'Das Backuparchiv kann nicht abgeschlossen werden.');
            }

            chmod($temporaryArchive, 0600);
            $this->syncFile($temporaryArchive);
            if (!rename($temporaryArchive, $this->archivePath($id))) {
                throw new Problem(503, 'backup_unavailable', 'Das Backuparchiv kann nicht dauerhaft abgelegt werden.');
            }
            $this->syncDirectory($directory);

            $job = $this->store->get('backups', $id);
            $job['status'] = 'ready';
            $job['manifest'] = $manifest;
            $job['download_url'] = '/api/v1/backups/'.$id.'/content';
            $job['error'] = null;
            $this->store->save('backups', $job, 'backup.ready');
        } catch (\Throwable $error) {
            if (is_file($temporaryArchive)) {
                unlink($temporaryArchive);
            }
            $job = $this->store->find('backups', $id);
            if (null !== $job && ($job['status'] ?? '') !== 'ready') {
                $job['status'] = 'failed';
                $job['error'] = mb_substr($error instanceof Problem ? $error->getMessage() : 'Die Sicherung konnte nicht erstellt werden.', 0, 300);
                $this->store->save('backups', $job, 'backup.failed');
            }
        } finally {
            if (null !== $temporaryDirectory && is_dir($temporaryDirectory)) {
                foreach (glob($temporaryDirectory.'/*') ?: [] as $file) {
                    if (is_file($file)) {
                        unlink($file);
                    }
                }
                rmdir($temporaryDirectory);
            }
        }
    }

    /** @param array<string, mixed> $payload */
    private function writeRestoreRequest(array $payload): void
    {
        $requestId = $this->payloadId($payload, 'request_id');
        $backupId = $this->payloadId($payload, 'backup_id');
        $job = $this->store->get('backups', $backupId);
        if (($job['status'] ?? null) !== 'restoring' || ($job['restore_request_id'] ?? null) !== $requestId) {
            return;
        }

        $manifest = $job['manifest'] ?? null;
        if (!is_array($manifest)) {
            throw new Problem(409, 'backup_not_ready', 'Das Wiederherstellungsmanifest fehlt.');
        }
        $this->verifyArchive($backupId, $manifest);

        $request = [
            'request_id' => $requestId,
            'backup_id' => $backupId,
            'database_sha256' => $manifest['database_sha256'],
            'reason' => (string) ($payload['reason'] ?? ''),
            'requested_by' => (string) ($payload['requested_by'] ?? ''),
            'requested_at' => (string) ($payload['requested_at'] ?? ''),
        ];

        $this->writeJsonAtomically($this->restoreRequestPath(), $request);
    }

    /** @param array<string, mixed> $manifest */
    private function verifyArchive(string $id, array $manifest): void
    {
        $path = $this->archivePath($id);
        $zip = new \ZipArchive();
        if (true !== $zip->open($path, \ZipArchive::RDONLY)) {
            throw new Problem(409, 'backup_invalid', 'Das Backuparchiv kann nicht geöffnet werden.');
        }

        try {
            if (2 !== $zip->numFiles || false === $zip->locateName('database.sqlite') || false === $zip->locateName('manifest.json')) {
                throw new Problem(409, 'backup_invalid', 'Das Backuparchiv enthält unerwartete Dateien.');
            }

            $manifestBytes = $zip->getFromName('manifest.json');
            if (!is_string($manifestBytes) || strlen($manifestBytes) > 1048576) {
                throw new Problem(409, 'backup_invalid', 'Der Inhalt des Backuparchivs ist unvollständig.');
            }

            $embeddedManifest = json_decode($manifestBytes, true, 32, JSON_THROW_ON_ERROR);
            if (!is_array($embeddedManifest) || $this->canonicalJson($embeddedManifest) !== $this->canonicalJson($manifest)) {
                throw new Problem(409, 'backup_invalid', 'Das eingebettete Backupmanifest stimmt nicht überein.');
            }

            $databaseEntry = $zip->statName('database.sqlite');
            $maxBytes = max(1048576, (int) (getenv('FALKENWARTE_BACKUP_MAX_BYTES') ?: 5368709120));
            if (!is_array($databaseEntry) || $databaseEntry['size'] <= 0 || (int) $databaseEntry['size'] > $maxBytes) {
                throw new Problem(413, 'backup_invalid', 'Die gesicherte Datenbank hat eine unzulässige Größe.');
            }

            $temporaryDatabase = $this->backupDirectory().'/verify-'.bin2hex(random_bytes(8)).'.sqlite';
            $input = $zip->getStream('database.sqlite');
            $output = fopen($temporaryDatabase, 'xb');
            if (false === $input || false === $output) {
                if (is_resource($input)) {
                    fclose($input);
                }
                if (is_resource($output)) {
                    fclose($output);
                }
                throw new Problem(503, 'backup_unavailable', 'Die Datenbank kann nicht zur Prüfung abgelegt werden.');
            }

            $hash = hash_init('sha256');
            try {
                chmod($temporaryDatabase, 0600);
                while (!feof($input)) {
                    $chunk = fread($input, 1048576);
                    if (false === $chunk) {
                        throw new Problem(409, 'backup_invalid', 'Die Datenbank im Backup kann nicht gelesen werden.');
                    }
                    if ('' === $chunk) {
                        continue;
                    }
                    hash_update($hash, $chunk);
                    if (fwrite($output, $chunk) !== strlen($chunk)) {
                        throw new Problem(503, 'backup_unavailable', 'Die Datenbank kann nicht zur Prüfung abgelegt werden.');
                    }
                }
                fflush($output);
                if (!hash_equals((string) $manifest['database_sha256'], hash_final($hash))) {
                    throw new Problem(409, 'backup_checksum_mismatch', 'Die gesicherte Datenbank-Prüfsumme stimmt nicht.');
                }
                $this->assertDatabaseHealthy($temporaryDatabase);
            } finally {
                fclose($input);
                fclose($output);
                unlink($temporaryDatabase);
            }
        } catch (\JsonException) {
            throw new Problem(409, 'backup_invalid', 'Das eingebettete Backupmanifest ist ungültig.');
        } finally {
            $zip->close();
        }
    }

    /** @return array<string, mixed> */
    private function manifest(string $databaseHash): array
    {
        $plugins = array_map(static fn (array $manifest): array => [
            'plugin_id' => (string) ($manifest['id'] ?? ''),
            'version' => (string) ($manifest['version'] ?? ''),
        ], $this->plugins->manifests());
        $plugins = array_values(array_filter($plugins, static fn (array $plugin): bool => '' !== $plugin['plugin_id'] && '' !== $plugin['version']));
        usort($plugins, static fn (array $left, array $right): int => strcmp($left['plugin_id'], $right['plugin_id']));

        $artifactManifestHash = hash('sha256', '[]');

        return [
            'app_version' => trim((string) @file_get_contents(dirname(__DIR__, 3).'/version.txt')) ?: '0.1.0',
            'schema_version' => $this->schemaVersion(),
            'plugin_versions' => $plugins,
            'database_sha256' => $databaseHash,
            'artifact_count' => 0,
            'artifact_manifest_sha256' => $artifactManifestHash,
        ];
    }

    private function copyDatabase(string $destination): void
    {
        $databasePath = getenv('FALKENWARTE_DB') ?: '/data/falkenwarte.sqlite';
        if (!is_file($databasePath)) {
            throw new Problem(503, 'backup_unavailable', 'Die Falkenwarte-Datenbank wurde nicht gefunden.');
        }

        $source = new \SQLite3($databasePath, SQLITE3_OPEN_READONLY);
        $target = new \SQLite3($destination, SQLITE3_OPEN_READWRITE | SQLITE3_OPEN_CREATE);
        try {
            if (!$source->backup($target)) {
                throw new Problem(503, 'backup_unavailable', 'Die konsistente SQLite-Sicherung ist fehlgeschlagen.');
            }
            $this->assertDatabaseHealthy($destination);
        } finally {
            $source->close();
            $target->close();
        }
        chmod($destination, 0600);
    }

    private function assertDatabaseHealthy(string $path): void
    {
        $database = new \SQLite3($path, SQLITE3_OPEN_READONLY);
        try {
            $result = $database->querySingle('PRAGMA integrity_check');
            if ('ok' !== $result) {
                throw new Problem(409, 'backup_invalid', 'Die gesicherte Datenbank besteht die SQLite-Integritätsprüfung nicht.');
            }
        } finally {
            $database->close();
        }
    }

    private function schemaVersion(): string
    {
        try {
            $version = $this->migrationVersions->latestVersion();
        } catch (\Throwable) {
            throw new Problem(503, 'backup_unavailable', 'Der Datenbank-Migrationsstand kann nicht gelesen werden.');
        }
        if ('' === $version) {
            throw new Problem(503, 'backup_unavailable', 'Die Datenbank enthält keine ausgeführten Migrationen.');
        }

        return $version;
    }

    /** @return array<string, mixed> */
    private function view(array $job): array
    {
        return [
            'id' => $job['id'],
            'version' => $job['version'],
            'created_at' => $job['created_at'],
            'updated_at' => $job['updated_at'],
            'allowed_actions' => [],
            'status' => $job['status'],
            'manifest' => $job['manifest'] ?? null,
            'download_url' => $job['download_url'] ?? null,
            'error' => $job['error'] ?? null,
        ];
    }

    private function backupDirectory(): string
    {
        $directory = getenv('FALKENWARTE_BACKUP_DIR') ?: '/data/backups';
        if (!str_starts_with($directory, '/')) {
            throw new Problem(503, 'backup_unavailable', 'Das Backupziel muss ein absoluter Pfad sein.');
        }
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new Problem(503, 'backup_unavailable', 'Das Backupziel kann nicht angelegt werden.');
        }
        chmod($directory, 0700);
        $resolved = realpath($directory);
        if (false === $resolved || $resolved !== rtrim($directory, '/')) {
            throw new Problem(503, 'backup_unavailable', 'Das Backupziel darf keine symbolischen Links verwenden.');
        }

        return $resolved;
    }

    private function archivePath(string $id): string
    {
        if (1 !== preg_match('/^[a-f0-9-]{36}$/i', $id)) {
            throw new Problem(400, 'validation_failed', 'Die Backup-ID ist ungültig.');
        }

        return $this->backupDirectory().'/'.$id.'.zip';
    }

    private function restoreRequestPath(): string
    {
        $path = (getenv('FALKENWARTE_DATA_DIR') ?: '/data').'/restore-request.json';
        $directory = dirname($path);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new Problem(503, 'restore_unavailable', 'Der Wiederherstellungsordner kann nicht angelegt werden.');
        }

        return $path;
    }

    /** @param array<string, mixed> $data */
    private function writeJsonAtomically(string $path, array $data): void
    {
        if (is_file($path)) {
            $existing = json_decode((string) file_get_contents($path), true);
            if (($existing['request_id'] ?? null) === ($data['request_id'] ?? null)) {
                return;
            }
            throw new Problem(409, 'restore_already_pending', 'Eine Wiederherstellung wartet bereits auf den Wartungsmodus.');
        }

        $temporary = $path.'.'.bin2hex(random_bytes(8)).'.tmp';
        $handle = fopen($temporary, 'xb');
        if (false === $handle) {
            throw new Problem(503, 'restore_unavailable', 'Der Wiederherstellungsauftrag kann nicht gespeichert werden.');
        }

        try {
            chmod($temporary, 0600);
            $contents = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            if (fwrite($handle, $contents) !== strlen($contents) || !fflush($handle)) {
                throw new Problem(503, 'restore_unavailable', 'Der Wiederherstellungsauftrag kann nicht dauerhaft geschrieben werden.');
            }
            if (function_exists('fsync')) {
                fsync($handle);
            }
        } finally {
            fclose($handle);
        }

        if (!rename($temporary, $path)) {
            unlink($temporary);
            throw new Problem(503, 'restore_unavailable', 'Der Wiederherstellungsauftrag kann nicht veröffentlicht werden.');
        }
        $this->syncDirectory(dirname($path));
    }

    private function syncFile(string $path): void
    {
        $handle = fopen($path, 'rb');
        if (false !== $handle) {
            if (function_exists('fsync')) {
                fsync($handle);
            }
            fclose($handle);
        }
    }

    private function syncDirectory(string $directory): void
    {
        if (!function_exists('fsync')) {
            return;
        }
        $handle = fopen($directory, 'r');
        if (false !== $handle) {
            fsync($handle);
            fclose($handle);
        }
    }

    /** @param array<mixed> $value */
    private function canonicalJson(array $value): string
    {
        $sort = function (array $input) use (&$sort): array {
            foreach ($input as $key => $item) {
                if (is_array($item)) {
                    $input[$key] = $sort($item);
                }
            }
            if (!array_is_list($input)) {
                ksort($input);
            }

            return $input;
        };

        return json_encode($sort($value), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function pathId(array $p): string
    {
        $id = $p['backup_id'] ?? null;
        if (!is_string($id) || '' === $id) {
            throw new Problem(400, 'validation_failed', 'Backup-ID fehlt.');
        }

        return $id;
    }

    /** @param array<string, mixed> $payload */
    private function payloadId(array $payload, string $key): string
    {
        $id = $payload[$key] ?? null;
        if (!is_string($id) || '' === $id) {
            throw new Problem(400, 'validation_failed', 'Backupauftrag ist ungültig.');
        }

        return $id;
    }
}
