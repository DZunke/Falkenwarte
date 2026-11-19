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
        $markerPath = $dataDirectory.'/restore-result.json';
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
}
