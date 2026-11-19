<?php

declare(strict_types=1);

namespace App\Orchestration\Infrastructure;

use App\AgentCatalog\Application\RunImpactPort;
use App\AgentCatalog\Domain\ConnectionChangeImpact;
use App\Shared\Application\Store;

final class AgentCatalogRunImpactAdapter implements RunImpactPort
{
    private const ACTIVE_RUN_STATES = ['queued', 'dispatching', 'running', 'waiting_input', 'auth_blocked', 'reconciling', 'cancel_requested', 'result_reported', 'verifying'];

    public function __construct(private readonly Store $store)
    {
    }

    public function connectionChanged(string $connectionId, ConnectionChangeImpact $impact, string $reason): void
    {
        foreach ($this->store->all('runs') as $run) {
            if (!in_array($run['state'] ?? null, self::ACTIVE_RUN_STATES, true) || !$this->usesConnection($run, $connectionId)) {
                continue;
            }

            $run['state'] = ConnectionChangeImpact::BLOCK_AUTH === $impact ? 'auth_blocked' : 'reconciling';
            $run['status_reason'] = $reason;
            $this->store->save('runs', $run, ConnectionChangeImpact::BLOCK_AUTH === $impact ? 'run.auth_blocked' : 'run.reconciliation_required');
            if (ConnectionChangeImpact::RECONCILE === $impact) {
                $this->store->enqueue('run.reconcile', ['run_id' => $run['id']]);
            }
        }
    }

    public function projectBindingChanged(string $bindingId, string $reason): void
    {
        foreach ($this->store->all('runs') as $run) {
            if (($run['snapshot']['project_binding_id'] ?? null) !== $bindingId || !in_array($run['state'] ?? null, self::ACTIVE_RUN_STATES, true)) {
                continue;
            }

            $run['state'] = 'reconciling';
            $run['status_reason'] = $reason;
            $this->store->save('runs', $run, 'run.reconciliation_required');
            $this->store->enqueue('run.reconcile', ['run_id' => $run['id']]);
        }
    }

    /** @param array<string, mixed> $run */
    private function usesConnection(array $run, string $connectionId): bool
    {
        foreach (($run['attempts'] ?? []) as $attempt) {
            if (($attempt['connection_id'] ?? null) === $connectionId) {
                return true;
            }
        }

        return false;
    }
}
