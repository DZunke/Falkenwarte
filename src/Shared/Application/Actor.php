<?php

declare(strict_types=1);

namespace App\Shared\Application;

use App\Shared\Domain\Problem;

final readonly class Actor
{
    public function __construct(public string $id, public bool $owner, public array $projects = [], public array $capabilities = [], public string $name = '', public string $transport = 'http')
    {
    }

    public function canProject(string $id): bool
    {
        return $this->owner || in_array($id, $this->projects, true);
    }

    public function requireProject(string $id): void
    {
        if (!$this->canProject($id)) {
            throw new Problem(403, 'forbidden', 'Für dieses Projekt fehlt die Berechtigung.');
        }
    }

    public function requireOwner(): void
    {
        if (!$this->owner) {
            throw new Problem(403, 'forbidden', 'Diese Entscheidung ist dem Eigentümer vorbehalten.');
        }
    }

    public function ref(): array
    {
        return ['kind' => $this->owner ? 'owner' : ('system' === $this->id ? 'system' : 'agent'), 'id' => $this->id] + ('' === $this->name ? [] : ['display_name' => $this->name]);
    }
}
