<?php

declare(strict_types=1);

namespace App\Portfolio\Application;

use App\Extensions\Application\PluginAvailability;
use App\Portfolio\Domain\CustomFieldPolicy;
use App\Portfolio\Domain\ProjectSlug;
use App\Shared\Application\Actor;
use App\Shared\Application\OperationHandler;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;

final class PortfolioHandler implements OperationHandler
{
    private const DEFAULT_STATUSES = [
        ['name' => 'Backlog', 'category' => 'backlog', 'color' => '#64748B', 'is_default' => true],
        ['name' => 'Bereit', 'category' => 'ready', 'color' => '#0EA5E9', 'is_default' => false],
        ['name' => 'In Arbeit', 'category' => 'active', 'color' => '#8B5CF6', 'is_default' => false],
        ['name' => 'Review', 'category' => 'review', 'color' => '#F59E0B', 'is_default' => false],
        ['name' => 'Erledigt', 'category' => 'done', 'color' => '#10B981', 'is_default' => false],
        ['name' => 'Abgebrochen', 'category' => 'cancelled', 'color' => '#64748B', 'is_default' => false],
    ];

    public function __construct(public Store $store, private readonly CustomFieldPolicy $customFieldPolicy, private readonly PluginAvailability $plugins)
    {
    }

    public function handles(string $op): bool
    {
        return in_array($op, [
            'projects_list', 'projects_get', 'projects_create', 'projects_update', 'projects_archive',
            'custom_fields_list', 'custom_fields_create', 'custom_fields_update',
        ], true);
    }

    /** @param array<string, mixed> $p @param array<string, mixed> $body @return array<string, mixed> */
    public function handle(string $op, array $p, array $body, Actor $actor): array
    {
        return match ($op) {
            'projects_list' => $this->listProjects($p, $actor),
            'projects_get' => $this->getProject($this->pathId($p, 'project_id'), $actor),
            'projects_create' => $this->createProject($body),
            'projects_update' => $this->updateProject($this->pathId($p, 'project_id'), $body, $actor),
            'projects_archive' => $this->archiveProject($this->pathId($p, 'project_id'), $body, $actor),
            'custom_fields_list' => $this->listCustomFields($this->pathId($p, 'project_id'), $p, $actor),
            'custom_fields_create' => $this->createCustomField($this->pathId($p, 'project_id'), $body, $actor),
            'custom_fields_update' => $this->updateCustomField($this->pathId($p, 'project_id'), $this->pathId($p, 'field_id'), $body, $actor),
            default => throw new Problem(404, 'operation_not_found', 'Unbekannte Portfolio-Operation.'),
        };
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listProjects(array $p, Actor $actor): array
    {
        $projects = array_values(array_filter($this->store->all('projects'), static fn (array $project): bool => $actor->canProject($project['id'])));
        $query = mb_strtolower(trim((string) ($p['q'] ?? '')));
        if (isset($p['archived'])) {
            $archived = filter_var($p['archived'], FILTER_VALIDATE_BOOLEAN);
            $projects = array_values(array_filter($projects, static fn (array $project): bool => $project['archived'] === $archived));
        }
        if ('' !== $query) {
            $projects = array_values(array_filter($projects, static fn (array $project): bool => str_contains(mb_strtolower($project['name'].' '.$project['slug'].' '.$project['description']), $query)
            ));
        }

        $sort = $p['sort'] ?? 'name';
        usort($projects, static function (array $left, array $right) use ($sort): int {
            $field = in_array($sort, ['updated_at', 'created_at'], true) ? $sort : 'name';

            return strcasecmp((string) ($left[$field] ?? ''), (string) ($right[$field] ?? ''));
        });

        $projects = array_map(fn (array $project): array => $this->withCounts($project), $projects);

        return $this->store->page($projects, $p);
    }

    /** @return array<string, mixed> */
    private function getProject(string $id, Actor $actor): array
    {
        $actor->requireProject($id);

        return $this->withCounts($this->project($id));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function createProject(array $body): array
    {
        $slug = ProjectSlug::fromString((string) ($body['slug'] ?? ''))->value;
        if (null !== $this->findBySlug($slug)) {
            throw new Problem(409, 'slug_conflict', 'Dieser Projektschlüssel ist bereits vergeben.');
        }

        $project = $this->store->save('projects', [
            'slug' => $slug,
            'name' => trim((string) $body['name']),
            'description' => (string) ($body['description'] ?? ''),
            'icon_key' => (string) $body['icon_key'],
            'color' => strtoupper((string) $body['color']),
            'archived' => false,
            'completion_policy' => $body['completion_policy'] ?? [
                'required_evidence_kinds' => [],
                'require_human_approval' => false,
                'require_review' => false,
                'require_human_confirmed_criteria' => true,
            ],
            'active_binding_id' => null,
        ], 'project.created');

        foreach (self::DEFAULT_STATUSES as $position => $status) {
            $this->store->save('statuses', [
                'project_id' => $project['id'],
                'name' => $status['name'],
                'category' => $status['category'],
                'color' => $status['color'],
                'position' => $position,
                'is_default' => $status['is_default'],
            ], 'task_status.created');
        }

        return $this->withCounts($project);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function updateProject(string $id, array $body, Actor $actor): array
    {
        $actor->requireProject($id);
        $project = $this->project($id);
        $project = $this->apply($project, $body, ['name', 'description', 'icon_key', 'color', 'completion_policy']);
        if (isset($project['color'])) {
            $project['color'] = strtoupper((string) $project['color']);
        }

        return $this->withCounts($this->store->save('projects', $project, 'project.updated'));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function archiveProject(string $id, array $body, Actor $actor): array
    {
        $actor->requireProject($id);
        $project = $this->project($id);
        $project['archived'] = (bool) $body['archived'];

        return $this->withCounts($this->store->save('projects', $project, $project['archived'] ? 'project.archived' : 'project.reactivated'));
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listCustomFields(string $projectId, array $p, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $fields = $this->store->all('custom_fields', $projectId);
        foreach ($fields as &$field) {
            if (isset($field['plugin_id']) && !$this->plugins->enabled($field['plugin_id'])) {
                $field['active'] = false;
            }
        }
        unset($field);
        usort($fields, static fn (array $a, array $b): int => strcasecmp($a['label'], $b['label']));

        return $this->store->page($fields, $p);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function createCustomField(string $projectId, array $body, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $pluginId = $body['plugin_id'] ?? null;
        if (null !== $pluginId) {
            $actor->requireOwner();
            if (!$this->plugins->enabled($pluginId) || !str_starts_with($body['key'], $pluginId.'.')) {
                throw new Problem(422, 'validation_failed', 'Ein Pluginfeld benötigt eine aktive Erweiterung und einen Schlüssel in deren Namensraum.');
            }
        }
        foreach ($this->store->all('custom_fields', $projectId) as $definition) {
            if ($definition['key'] === $body['key']) {
                throw new Problem(409, 'custom_field_key_conflict', 'Dieser Zusatzfeldschlüssel ist bereits vergeben.');
            }
        }

        return $this->store->save('custom_fields', [
            'project_id' => $projectId,
            'key' => $body['key'],
            'label' => trim($body['label']),
            'value_type' => $body['value_type'],
            'required' => (bool) $body['required'],
            'choices' => $body['choices'] ?? [],
            'plugin_id' => $pluginId,
            'active' => (bool) $body['active'],
        ], 'custom_field.created');
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function updateCustomField(string $projectId, string $fieldId, array $body, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $field = $this->store->find('custom_fields', $fieldId);
        if (null === $field || $field['project_id'] !== $projectId) {
            throw new Problem(404, 'resource_not_found', 'Zusatzfeld wurde nicht gefunden.');
        }
        $this->customFieldPolicy->assertUpdateAllowed($field, $body, $this->store->all('tasks', $projectId));
        foreach (['label', 'value_type', 'required', 'choices', 'active'] as $key) {
            if (array_key_exists($key, $body)) {
                $field[$key] = $body[$key];
            }
        }

        return $this->store->save('custom_fields', $field, 'custom_field.updated');
    }

    /** @param array<string, mixed> $project @return array<string, mixed> */
    private function withCounts(array $project): array
    {
        $tasks = $this->store->all('tasks', $project['id']);
        $project['open_task_count'] = count(array_filter($tasks, static fn (array $task): bool => !in_array($task['status_category'], ['done', 'cancelled'], true)));
        $project['active_run_count'] = count(array_filter($this->store->all('runs', $project['id']), static fn (array $run): bool => in_array($run['state'] ?? '', ['queued', 'dispatching', 'running', 'waiting_input', 'auth_blocked', 'reconciling', 'cancel_requested'], true)));
        $project['allowed_actions'] = [];

        return $project;
    }

    /** @return array<string, mixed> */
    private function project(string $id): array
    {
        $project = $this->store->find('projects', $id);
        if (null === $project) {
            throw new Problem(404, 'resource_not_found', 'Projekt wurde nicht gefunden.');
        }

        return $project;
    }

    /** @return array<string, mixed>|null */
    private function findBySlug(string $slug): ?array
    {
        foreach ($this->store->all('projects') as $project) {
            if ($project['slug'] === $slug) {
                return $project;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $record @param array<string, mixed> $fields @param list<string> $allowed @return array<string, mixed> */
    private function apply(array $record, array $fields, array $allowed): array
    {
        foreach ($allowed as $field) {
            if (array_key_exists($field, $fields)) {
                $record[$field] = $fields[$field];
            }
        }

        return $record;
    }

    /** @param array<string, mixed> $p */
    private function pathId(array $p, string $key): string
    {
        $value = $p[$key] ?? null;
        if (!is_string($value) || '' === $value) {
            throw new Problem(400, 'validation_failed', 'Pfad-ID fehlt.');
        }

        return $value;
    }
}
