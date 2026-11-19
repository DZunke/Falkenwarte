<?php

declare(strict_types=1);

namespace App\WorkManagement\Domain;

use App\Shared\Domain\Problem;

final class BoardWipPolicy
{
    /** @param list<array<string, mixed>> $boards @param list<array<string, mixed>> $tasks @param array<string, mixed>|null $beforeTask @param array<string, mixed> $changedTask */
    public function assertTaskChangeAllowed(array $boards, array $tasks, ?array $beforeTask, array $changedTask): void
    {
        foreach ($boards as $board) {
            if (!empty($board['archived'])) {
                continue;
            }
            foreach ($board['columns'] as $column) {
                if (null === $column['wip_limit'] || 'block' !== $column['wip_policy']) {
                    continue;
                }
                $before = $this->count($board, $column, $tasks, $beforeTask);
                $after = $this->count($board, $column, $tasks, $changedTask);
                if ($after > $column['wip_limit'] && $after > $before) {
                    throw new Problem(409, 'wip_limit_exceeded', 'Die Änderung würde eine harte WIP-Grenze im Projektboard überschreiten.');
                }
            }
        }
    }

    /** @param list<array<string, mixed>> $tasks @param array<string, mixed> $board */
    public function assertConfigurationAllowed(array $board, array $tasks): void
    {
        if (!empty($board['archived'])) {
            return;
        }
        foreach ($board['columns'] as $column) {
            if (null !== $column['wip_limit'] && 'block' === $column['wip_policy'] && $this->count($board, $column, $tasks) > $column['wip_limit']) {
                throw new Problem(409, 'wip_limit_exceeded', 'Die Boardkonfiguration würde die vorhandene WIP-Grenze überschreiten.');
            }
        }
    }

    /** @param array<string, mixed> $board @param array<string, mixed> $column @param list<array<string, mixed>> $tasks @param array<string, mixed>|null $replacement */
    public function count(array $board, array $column, array $tasks, ?array $replacement = null): int
    {
        if (null !== $replacement) {
            $replaced = false;
            $replacementId = $replacement['id'] ?? null;
            if (is_string($replacementId)) {
                foreach ($tasks as $index => $task) {
                    if (($task['id'] ?? null) === $replacementId) {
                        $tasks[$index] = $replacement;
                        $replaced = true;
                        break;
                    }
                }
            }
            if (!$replaced) {
                $tasks[] = $replacement;
            }
        }

        $count = 0;
        foreach ($tasks as $task) {
            if (in_array($task['status_id'], $column['status_ids'], true) && $this->matchesFilter($task, $board['config']['filter'])) {
                ++$count;
            }
        }

        return $count;
    }

    /** @param array<string, mixed> $task @param array<string, mixed> $filter */
    public function matchesFilter(array $task, array $filter): bool
    {
        if (($filter['status_ids'] ?? []) !== [] && !in_array($task['status_id'], $filter['status_ids'], true)) {
            return false;
        }
        if (($filter['agent_profile_ids'] ?? []) !== [] && !in_array($task['agent_profile_id'], $filter['agent_profile_ids'], true)) {
            return false;
        }
        if (($filter['priorities'] ?? []) !== [] && !in_array($task['priority'], $filter['priorities'], true)) {
            return false;
        }
        if (isset($filter['blocked']) && $task['blocked'] !== $filter['blocked']) {
            return false;
        }
        if (($filter['label_ids'] ?? []) !== [] && [] === array_intersect($filter['label_ids'], $task['label_ids'])) {
            return false;
        }
        if (isset($filter['human_attention_required']) && $task['human_attention']['required'] !== $filter['human_attention_required']) {
            return false;
        }
        if (($filter['intake_outcomes'] ?? []) !== [] && !in_array($task['intake_outcome'], $filter['intake_outcomes'], true)) {
            return false;
        }
        if (isset($filter['query']) && '' !== trim((string) $filter['query']) && !str_contains(mb_strtolower($task['title'].' '.$task['description']), mb_strtolower($filter['query']))) {
            return false;
        }

        return true;
    }
}
