<?php

declare(strict_types=1);

namespace App\Operations\Presentation;

use App\Operations\Application\BackupHandler;
use App\Orchestration\Application\RunHandler;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:restore:finalize', description: 'Schließt den Wiederherstellungsabgleich ab.')]
final class RestoreFinalizeCommand extends Command
{
    public function __construct(private readonly BackupHandler $backups, private readonly RunHandler $runs)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $dataDirectory = rtrim(getenv('FALKENWARTE_DATA_DIR') ?: '/data', '/');
        $failurePath = $dataDirectory.'/restore-failure.json';
        $markerPath = $dataDirectory.'/restore-result.json';
        if (is_file($failurePath)) {
            if (is_file($markerPath)) {
                throw new \RuntimeException('Ein Restore meldet gleichzeitig Erfolg und Fehler; der Datenbankstand muss manuell geprüft werden.');
            }
            $contents = file_get_contents($failurePath);
            if (false === $contents) {
                throw new \RuntimeException('Der Restore-Fehlernachweis kann nicht gelesen werden.');
            }
            $marker = json_decode($contents, true, 32, JSON_THROW_ON_ERROR);
            $this->validateFailureMarker($marker);
            $this->backups->finalizeFailedRestore($marker);

            $failedDirectory = $dataDirectory.'/restore-failed';
            if (!is_dir($failedDirectory) && !mkdir($failedDirectory, 0700, true) && !is_dir($failedDirectory)) {
                throw new \RuntimeException('Der Restore-Fehlernachweis kann nicht dauerhaft abgelegt werden.');
            }
            chmod($failedDirectory, 0700);
            $failedPath = $failedDirectory.'/'.$marker['request_id'].'.json';
            if (is_file($failedPath) || is_link($failedPath) || !rename($failurePath, $failedPath)) {
                throw new \RuntimeException('Der Restore-Fehlernachweis konnte nicht abgeschlossen werden.');
            }
            $output->writeln('Restore vor dem Datenbankaustausch abgebrochen; die bisherige Datenbank blieb erhalten und der Wartungsmodus bleibt aktiv.');

            return Command::SUCCESS;
        }
        if (!is_file($markerPath)) {
            return Command::SUCCESS;
        }

        $contents = file_get_contents($markerPath);
        if (false === $contents) {
            throw new \RuntimeException('Der Wiederherstellungsnachweis kann nicht gelesen werden.');
        }

        $marker = json_decode($contents, true, 32, JSON_THROW_ON_ERROR);
        $this->validateMarker($marker);

        $this->backups->finalizeRestoredBackup($marker);
        $this->runs->work('run.restore_inventory', $marker);

        $swapPath = $dataDirectory.'/restore-swap-in-progress.json';
        if (is_file($swapPath) && !unlink($swapPath)) {
            throw new \RuntimeException('Der abgeschlossene Restore-Austauschmarker konnte nicht entfernt werden.');
        }

        $completedDirectory = $dataDirectory.'/restore-completed';
        if (!is_dir($completedDirectory) && !mkdir($completedDirectory, 0700, true) && !is_dir($completedDirectory)) {
            throw new \RuntimeException('Der abgeschlossene Wiederherstellungsnachweis kann nicht abgelegt werden.');
        }

        $completedPath = $completedDirectory.'/'.$marker['request_id'].'.json';
        if (!rename($markerPath, $completedPath)) {
            throw new \RuntimeException('Der Wiederherstellungsnachweis konnte nicht abgeschlossen werden.');
        }

        $output->writeln('Wiederherstellung wurde erfasst. Offene T3-Aufträge bleiben bis zur Klärung gesperrt.');

        return Command::SUCCESS;
    }

    private function validateMarker(mixed $marker): void
    {
        if (!is_array($marker)) {
            throw new \RuntimeException('Der Wiederherstellungsnachweis ist ungültig.');
        }

        foreach (['request_id', 'backup_id', 'reason', 'requested_by', 'requested_at', 'completed_at', 'database_sha256'] as $field) {
            if (!isset($marker[$field]) || !is_string($marker[$field]) || '' === trim($marker[$field])) {
                throw new \RuntimeException('Der Wiederherstellungsnachweis ist unvollständig.');
            }
        }

        if (1 !== preg_match('/^[a-f0-9]{64}$/i', $marker['database_sha256'])) {
            throw new \RuntimeException('Der Datenbank-Prüfwert im Wiederherstellungsnachweis ist ungültig.');
        }
    }

    private function validateFailureMarker(mixed $marker): void
    {
        if (!is_array($marker)) {
            throw new \RuntimeException('Der Restore-Fehlernachweis ist ungültig.');
        }

        foreach (['request_id', 'backup_id', 'reason', 'requested_by', 'requested_at', 'failed_at', 'failure_message', 'database_sha256'] as $field) {
            if (!isset($marker[$field]) || !is_string($marker[$field]) || '' === trim($marker[$field])) {
                throw new \RuntimeException('Der Restore-Fehlernachweis ist unvollständig.');
            }
        }
        if (1 !== preg_match('/^[a-f0-9-]{36}$/i', $marker['request_id'])
            || 1 !== preg_match('/^[a-f0-9-]{36}$/i', $marker['backup_id'])
            || 1 !== preg_match('/^[a-f0-9]{64}$/i', $marker['database_sha256'])
            || ($marker['exchange_started'] ?? null) !== false) {
            throw new \RuntimeException('Der Restore-Fehlernachweis enthält ungültige Identitäten oder einen unklaren Austauschstatus.');
        }
    }
}
