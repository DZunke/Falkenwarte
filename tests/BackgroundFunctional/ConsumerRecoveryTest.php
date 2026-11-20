<?php

declare(strict_types=1);

namespace App\BackgroundFunctional;

use App\Kernel;
use App\Shared\Application\Store;
use App\Shared\Infrastructure\Job;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Process\Process;

/** Exercises the real Doctrine transport, worker process, command and Inbox at the crash boundary. */
final class ConsumerRecoveryTest extends TestCase
{
    public function testLocalEffectAndInboxSurviveWorkerRedeliveryTogether(): void
    {
        $root = dirname(__DIR__, 2);
        $dir = sys_get_temp_dir().'/falkenwarte-worker-'.bin2hex(random_bytes(8));
        mkdir($dir, 0700);
        $previousEnvironmentValue = $_ENV['FALKENWARTE_DB'] ?? null;
        $_ENV['FALKENWARTE_DB'] = $dir.'/worker.sqlite';
        $env = ['APP_ENV' => 'test', 'FALKENWARTE_DB' => $dir.'/worker.sqlite'];
        $kernel = new Kernel('test', true);
        try {
            $migration = new Process([PHP_BINARY, 'bin/console', 'doctrine:migrations:migrate', '--no-interaction'], $root, $env);
            $migration->mustRun();
            $kernel->boot();
            $services = $kernel->getContainer()->get('test.service_container');
            $store = $services->get(Store::class);
            $bus = $services->get(MessageBusInterface::class);
            $plugin = 'falkenwarte.link-notes';
            $store->save('plugins', ['id' => $plugin, 'state' => 'enabling'], 'plugin.activation_requested');
            $id = $store->enqueue('plugin.activate', ['plugin_id' => $plugin]);
            // Two deliveries of one durable command are possible after a worker dies before ACK.
            $bus->dispatch(new Job($id));
            $bus->dispatch(new Job($id));
            $consume = [PHP_BINARY, 'bin/console', 'messenger:consume', 'async', '--limit=1', '--time-limit=8', '--no-interaction'];
            $killed = new Process($consume, $root, $env + ['FALKENWARTE_TEST_STOP_BEFORE_INBOX' => $id]);
            self::assertSame(92, $killed->run(), $killed->getErrorOutput());
            self::assertSame('enabling', $store->get('plugins', $plugin)['state']);
            self::assertFalse($store->db()->fetchOne('SELECT 1 FROM inbox WHERE command_id=?', [$id]));
            (new Process($consume, $root, $env))->mustRun();
            $state = $store->get('plugins', $plugin);
            self::assertSame('enabled', $state['state']);
            self::assertSame(2, $state['version']);
            self::assertEquals(1, $store->db()->fetchOne('SELECT count(*) FROM inbox WHERE command_id=?', [$id]));
            $bus->dispatch(new Job($id));
            (new Process($consume, $root, $env))->mustRun();
            self::assertSame($state, $store->get('plugins', $plugin));
        } finally {
            $kernel->shutdown();
            if (null === $previousEnvironmentValue) {
                unset($_ENV['FALKENWARTE_DB']);
            } else {
                $_ENV['FALKENWARTE_DB'] = $previousEnvironmentValue;
            }
            (new Filesystem())->remove($dir);
        }
    }
}
