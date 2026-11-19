<?php

declare(strict_types=1);

namespace App\Extensions\Domain;

/** State policy shared by HTTP, worker, MCP, and UI contribution gates. */
final readonly class PluginLifecyclePolicy
{
    private const ACTION_STATES = [
        'activate' => ['installed_disabled', 'disabled'],
        'drain' => ['enabled', 'draining'],
        'deactivate' => ['disabled'],
        'configure' => ['installed_disabled', 'disabled', 'enabled'],
    ];

    public function acceptsNewWork(string $state): bool
    {
        return 'enabled' === $state;
    }

    public function allowsDrainCheck(string $state): bool
    {
        return in_array($state, self::ACTION_STATES['drain'], true);
    }

    public function allowsAction(string $action, string $state): bool
    {
        return in_array($state, self::ACTION_STATES[$action] ?? [], true);
    }

    /** @return list<array{action: string, enabled: bool, reason: string|null}> */
    public function allowedActions(string $state): array
    {
        $actions = [];
        foreach (self::ACTION_STATES as $action => $states) {
            $enabled = in_array($state, $states, true);
            $actions[] = [
                'action' => $action,
                'enabled' => $enabled,
                'reason' => $enabled ? null : 'Der aktuelle Pluginstatus erlaubt diese Aktion nicht.',
            ];
        }

        return $actions;
    }
}
