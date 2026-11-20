<?php

declare(strict_types=1);

namespace App\Operations\Presentation;

use App\Operations\Infrastructure\OfflineRestoreAbort;
use App\Operations\Infrastructure\RestoreOfflineProcessor;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:restore:offline', description: 'Prüft und aktiviert einen angeforderten Datenbankstand.')]
final class RestoreOfflineCommand extends Command
{
    public function __construct(private readonly RestoreOfflineProcessor $restore)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        try {
            $this->restore->restore();
        } catch (OfflineRestoreAbort $abort) {
            $errorOutput = $output instanceof ConsoleOutputInterface ? $output->getErrorOutput() : $output;
            $errorOutput->writeln($abort->getMessage());

            return $abort->exitStatus;
        }

        return Command::SUCCESS;
    }
}
