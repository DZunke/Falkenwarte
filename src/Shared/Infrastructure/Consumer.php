<?php

declare(strict_types=1);

namespace App\Shared\Infrastructure;

use App\AgentCatalog\Application\AgentCatalogHandler;
use App\Classification\Application\IntakeHandler;
use App\Extensions\Application\PluginHandler;
use App\Metrics\Application\MetricsHandler;
use App\Operations\Application\BackupHandler;
use App\Operations\Application\JournalHandler;
use App\Orchestration\Application\RunHandler;
use App\Shared\Application\Actor;
use Psr\Container\ContainerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\DependencyInjection\Attribute\AutowireLocator;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\Event\WorkerRunningEvent;

#[AsMessageHandler]
final readonly class Consumer
{
    public function __construct(
        private DbalStoreAccess $store,
        #[AutowireLocator([
            'intake' => IntakeHandler::class,
            'connection' => AgentCatalogHandler::class,
            'recovery' => RunHandler::class,
            'run' => RunHandler::class,
            'workflow' => RunHandler::class,
            'plugin' => PluginHandler::class,
            'metrics' => MetricsHandler::class,
            'export' => JournalHandler::class,
            'backup' => BackupHandler::class,
            'restore' => BackupHandler::class,
        ])]
        private ContainerInterface $workers,
        #[Autowire('%kernel.environment%')]
        private string $appEnvironment,
        #[Autowire('%env(FALKENWARTE_TEST_STOP_BEFORE_INBOX)%')]
        private string $stopBeforeInboxCommandId,
    ) {
    }

    #[AsEventListener]
    public function heartbeat(WorkerRunningEvent $event): void
    {
        $this->store->db()->executeStatement("INSERT INTO runtime_state VALUES ('worker',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [time()]);
    }

    public function __invoke(Job $job): void
    {
        $db = $this->store->db();
        $command = $db->fetchAssociative('SELECT * FROM commands WHERE id=?', [$job->id]);
        if (!$command || $command['complete'] || $db->fetchOne('SELECT 1 FROM inbox WHERE command_id=?', [$job->id])) {
            return;
        }
        $this->store->context(new Actor('system', false), $command['action_id']);
        $kind = $command['kind'];
        $worker = strtok($kind, '.') ?: '';
        $handler = $this->workers->has($worker) ? $this->workers->get($worker) : null;
        try {
            if (null === $handler) {
                throw new \LogicException('Unbekannter Hintergrundauftrag '.$kind);
            }
            $payload = json_decode($command['payload'], true, flags: JSON_THROW_ON_ERROR);
            $payload['__command_id'] = $job->id;
            $acknowledge = function () use ($db, $command): void {
                if ('test' === $this->appEnvironment && $this->stopBeforeInboxCommandId === $command['id']) {
                    // Process-level fault injection for the isolated Messenger recovery fixture.
                    exit(92);
                }
                $db->executeStatement('INSERT OR IGNORE INTO inbox VALUES (?,?)', [$command['id'], $this->store->now()]);
                $db->update('commands', ['complete' => 1], ['id' => $command['id']]);
                $this->finish($command, null);
            };
            if (in_array($worker, ['plugin', 'metrics'], true)) {
                $this->store->atomic(function () use ($handler, $kind, $payload, $acknowledge, $db, $command) {
                    if ($db->fetchOne('SELECT 1 FROM inbox WHERE command_id=?', [$command['id']])) {
                        return;
                    }
                    $handler->work($kind, $payload);
                    $acknowledge();
                });
            } else {
                // External dispatch and observation must not hold the SQLite writer.
                $handler->work($kind, $payload);
                $this->store->atomic($acknowledge);
            }
        } catch (\Throwable $e) {
            // Retain the durable command until its bounded retry or terminal failure is recorded.
            error_log('Falkenwarte job '.$kind.' failed: '.$e::class);
            $this->store->atomic(function () use ($db, $command, $e) {
                $attempt = (int) $command['attempts'] + 1;
                $db->update('commands', ['attempts' => $attempt, 'dispatched' => 0, 'complete' => $attempt >= 3 ? 1 : 0, 'due_at' => time() + 2 ** $attempt, 'error' => $e::class], ['id' => $command['id']]);
                if ($attempt >= 3) {
                    $this->finish($command, $e);
                }
            });
        }
    }

    private function finish(array $command, ?\Throwable $failure): void
    {
        $db = $this->store->db();
        $action = $this->store->find('actions', $command['action_id']);
        if (!$action || 'failed' === $action['status'] || (null === $failure && $db->fetchOne('SELECT count(*) FROM commands WHERE action_id=? AND complete=0', [$action['id']]))) {
            return;
        }
        $action['status'] = $failure ? 'failed' : 'succeeded';
        $action['finished_at'] = $this->store->now();
        if ($failure) {
            $action['error'] = ['type' => 'urn:falkenwarte:problem:job_failed', 'title' => 'Hintergrundauftrag fehlgeschlagen', 'status' => 503, 'code' => 'job_failed', 'trace_id' => $command['id']];
        }
        $this->store->save('actions', $action, 'action.'.$action['status']);
    }
}
