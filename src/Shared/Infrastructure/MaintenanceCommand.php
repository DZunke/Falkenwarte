<?php

declare(strict_types=1);

namespace App\Shared\Infrastructure;

use App\Extensions\Application\PluginEventDispatcher;
use App\Extensions\Application\PluginHandler;
use App\Live\Infrastructure\Live;
use App\Orchestration\Application\RunHandler;
use App\Shared\Application\Actor;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Messenger\MessageBusInterface;

#[AsCommand(name: 'app:maintenance', description: 'Dauerhafte Commands zustellen und private UI-Updates veröffentlichen')]
final class MaintenanceCommand extends Command
{
    public function __construct(private readonly DbalStoreAccess $store, private readonly MessageBusInterface $bus, private readonly Live $live, private readonly RunHandler $runs, private readonly PluginEventDispatcher $pluginEvents, private readonly PluginHandler $plugins)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->addOption('once', null, InputOption::VALUE_NONE);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $db = $this->store->db();
        $nextPublish = 0;
        $nextCleanup = 0;
        $nextSchedule = 0;
        $nextPluginDispatch = 0;
        while (true) {
            $db->executeStatement("INSERT INTO runtime_state VALUES ('maintenance',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [time()]);
            $this->store->atomic(function () use ($db) {
                foreach ($db->fetchFirstColumn('SELECT id FROM commands WHERE complete=0 AND dispatched=0 AND due_at<=? ORDER BY rowid LIMIT 50', [time()]) as $id) {
                    $this->bus->dispatch(new Job($id));
                    $db->update('commands', ['dispatched' => 1], ['id' => $id]);
                }
            });
            if (time() >= $nextSchedule) {
                $this->store->context(new Actor('system', false), $this->store->id());
                $this->runs->scheduleDue();
                $nextSchedule = time() + 2;
            }
            if (time() >= $nextPluginDispatch) {
                try {
                    $this->pluginEvents->dispatch();
                    $this->plugins->completeCancellationDrains();
                    $this->plugins->completePendingRemovals();
                } catch (\Throwable $e) {
                    $nextPluginDispatch = time() + 5;
                    $output->writeln('Plugin-Ereignisse warten: '.$e->getMessage());
                }
                if ($nextPluginDispatch <= time()) {
                    $nextPluginDispatch = time() + 2;
                }
            }
            if (time() >= $nextPublish) {
                try {
                    $this->live->publish();
                } catch (\Throwable $e) {
                    $nextPublish = time() + 5;
                    $output->writeln('Mercure wartet: '.$e->getMessage());
                }
            }
            if (time() >= $nextCleanup) {
                $this->pruneExpired();
                $nextCleanup = time() + 300;
            }
            if ($input->getOption('once')) {
                break;
            }
            usleep(200000);
        }

        return Command::SUCCESS;
    }

    private function pruneExpired(): void
    {
        $settings = $this->store->all('settings')[0] ?? [];
        $days = (int) ($settings['api_idempotency_retention_days'] ?? 30);
        $hours = (int) ($settings['ui_event_retention_hours'] ?? 24);
        $this->store->atomic(function () use ($days, $hours) {
            $db = $this->store->db();
            $db->executeStatement('DELETE FROM dedup WHERE created_at<?', [time() - 86400 * $days]);
            $db->executeStatement('DELETE FROM sessions WHERE expires<?', [time()]);
            $db->executeStatement('DELETE FROM login_attempts WHERE until_ts<?', [time()]);
            // Only the replay view expires. Keep domain events and revision history.
            $floor = $db->fetchOne("SELECT MAX(seq) FROM events WHERE published=1 AND change_json IS NOT NULL AND julianday(json_extract(data,'$.occurred_at'))<julianday('now')-?", [$hours / 24]);
            if (null !== $floor && false !== $floor) {
                $db->executeStatement('UPDATE events SET change_json=NULL WHERE published=1 AND seq<=?', [$floor]);
                $db->executeStatement("INSERT INTO runtime_state VALUES ('event_floor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [(string) $floor]);
            }
        });
    }
}
