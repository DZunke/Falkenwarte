<?php

declare(strict_types=1);

namespace App\Metrics\Application;

use App\Shared\Application\Actor;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;
use App\Metrics\Domain\MeasurementWindow;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Throwable;

final class MetricsHandler
{
    private const ACTIVE_RUN_STATES = ['queued', 'dispatching', 'running', 'waiting_input', 'auth_blocked', 'reconciling', 'cancel_requested', 'result_reported', 'verifying'];

    public function __construct(private readonly Store $store)
    {
    }

    public function handles(string $op): bool
    {
        return in_array($op, ['dashboard_get', 'metrics_get', 'metrics_rebuild'], true);
    }

    public function handle(string $op, array $p, array $body, Actor $actor): array
    {
        return match ($op) {
            'dashboard_get' => $this->dashboard($p, $actor),
            'metrics_get' => $this->metrics($p, $actor),
            'metrics_rebuild' => $this->rebuild($actor),
            default => throw new Problem(404, 'resource_not_found', 'Metric operation not found.'),
        };
    }

    public function work(string $kind, array $payload): void
    {
        if ($kind !== 'metrics.rebuild') {
            return;
        }

        $computedAt = $this->store->now();
        $projects = $this->store->all('projects');
        $sourceEvents = array_values(array_filter($this->store->all('events'), static fn (array $event): bool => !str_starts_with((string) ($event['event_type'] ?? ''), 'MetricsProjection')));
        $dataThrough = $this->latestTimestamp($sourceEvents, $computedAt);

        foreach ($projects as $project) {
            $projectId = $project['id'];
            foreach ($this->metricValues($projectId, $sourceEvents, $computedAt) as $metric) {
                $this->store->save('metric_projections', [
                    'id' => $projectId.':'.$metric['key'],
                    'project_id' => $projectId,
                    'metric_key' => $metric['key'],
                    'value' => $metric['value'],
                    'unit' => $metric['unit'],
                    'sample_size' => $metric['sample_size'],
                    'provenance' => $metric['provenance'],
                    'quality' => $metric['quality'],
                    'computed_at' => $computedAt,
                    'data_through' => $dataThrough,
                ], 'MetricsProjectionRebuilt');
            }
        }
    }

    private function dashboard(array $p, Actor $actor): array
    {
        $projectFilter = isset($p['project_id']) && $p['project_id'] !== '' ? (string) $p['project_id'] : null;
        $projects = $this->visibleProjects($actor, $projectFilter);
        $projectIds = array_column($projects, 'id');
        $tasks = $this->forProjects('tasks', $projectIds);
        $runs = $this->forProjects('runs', $projectIds);
        $events = $this->forEvents($projectIds);
        $now = $this->store->now();
        $window = MeasurementWindow::fromQuery($p, new DateTimeImmutable($now, new DateTimeZone('UTC')));
        $openByProject = [];
        $activeByProject = [];
        $summaries = [];
        $activeRuns = [];

        foreach ($projects as $project) {
            $projectTasks = array_values(array_filter($tasks, static fn (array $task): bool => ($task['project_id'] ?? null) === $project['id']));
            $projectRuns = array_values(array_filter($runs, static fn (array $run): bool => ($run['project_id'] ?? null) === $project['id']));
            $open = count(array_filter($projectTasks, fn (array $task): bool => $this->isOpenTask($task, $project['id'])));
            $active = count(array_filter($projectRuns, static fn (array $run): bool => in_array($run['state'] ?? null, self::ACTIVE_RUN_STATES, true)));
            $openByProject[$project['id']] = $open;
            $activeByProject[$project['id']] = $active;
            $summaries[] = [
                'id' => $project['id'],
                'name' => $project['name'] ?? 'Projekt',
                'slug' => $project['slug'] ?? $this->slug((string) ($project['name'] ?? 'projekt')),
                'icon_key' => $project['icon_key'] ?? $project['icon'] ?? 'folder',
                'color' => $project['color'] ?? '#7C97B6',
                'open_tasks' => $open,
                'active_runs' => $active,
                'updated_at' => $project['updated_at'] ?? $now,
            ];

            foreach ($projectRuns as $run) {
                if (!in_array($run['state'] ?? null, self::ACTIVE_RUN_STATES, true)) {
                    continue;
                }

                $task = $this->store->find('tasks', (string) ($run['task_id'] ?? '')) ?? [];
                $profile = $this->store->find('agent_profiles', (string) ($run['agent_profile_id'] ?? '')) ?? [];
                $activeRuns[] = [
                    'id' => $run['id'],
                    'project_id' => $project['id'],
                    'task_id' => $run['task_id'] ?? '',
                    'task_key' => $task['key'] ?? '',
                    'title' => $task['title'] ?? 'Aufgabe',
                    'agent_profile_name' => $profile['name'] ?? $run['agent_profile_name'] ?? 'Agent',
                    'stage' => $run['stage'] ?? $run['current_stage_id'] ?? '',
                    'state' => $run['state'],
                    'last_observed_at' => $run['last_observed_at'] ?? null,
                ];
            }
        }

        $attention = $this->attentionItems($projectIds);
        $activity = $this->activityItems($events);
        $metrics = $this->metricValues(null, $events, $now, $tasks, $runs, $projectIds, $window);
        $activityEvents = array_values(array_filter($events, fn (array $event): bool => $window->contains($this->eventTime($event))));
        $activity = $this->activityItems($activityEvents);

        return [
            'projects' => array_slice($summaries, 0, 100),
            'attention' => array_slice($attention, 0, 100),
            'active_runs' => array_slice($activeRuns, 0, 100),
            'metrics' => array_slice($metrics, 0, 50),
            'activity' => array_slice($activity, 0, 100),
            'computed_at' => $now,
            'data_through' => $this->latestTimestamp($events, $now),
            'allowed_actions' => [],
        ];
    }

    private function metrics(array $p, Actor $actor): array
    {
        $projectFilter = isset($p['project_id']) && $p['project_id'] !== '' ? (string) $p['project_id'] : null;
        $projects = $this->visibleProjects($actor, $projectFilter);
        $projectIds = array_column($projects, 'id');
        $projectId = $projectFilter;
        $computedAt = $this->store->now();
        $window = MeasurementWindow::fromQuery($p, new DateTimeImmutable($computedAt, new DateTimeZone('UTC')));
        $grain = (string) ($p['grain'] ?? 'day');
        if (!in_array($grain, ['day', 'week', 'month', 'total'], true)) {
            throw new Problem(422, 'validation_failed', 'The metric grain must be day, week, month or total.');
        }

        $events = $this->forEvents($projectIds);
        $dataThrough = $this->latestTimestamp($events, $computedAt);
        $tasks = $this->forProjects('tasks', $projectIds);
        $runs = $this->forProjects('runs', $projectIds);
        $values = $this->metricValues($projectId, $events, $computedAt, $tasks, $runs, $projectIds, $window);
        $keys = $p['metric_keys'] ?? [];
        if (is_string($keys)) {
            $keys = [$keys];
        }
        if (is_array($keys) && $keys !== []) {
            $values = array_values(array_filter($values, static fn (array $metric): bool => in_array($metric['key'], $keys, true)));
        }

        $series = $grain === 'total' ? [] : $this->series($events, $window, $grain, $projectId, $tasks, $runs, $projectIds);

        return [
            'project_id' => $projectId,
            'from' => $window->from->format(DateTimeInterface::ATOM),
            'to' => $window->to->format(DateTimeInterface::ATOM),
            'grain' => $grain,
            'values' => array_slice($values, 0, 50),
            'series' => array_slice($series, 0, 366),
            'computed_at' => $computedAt,
            'data_through' => $dataThrough,
            'excluded_records' => count(array_filter($events, fn (array $event): bool => $this->eventTime($event) === null)),
            'warnings' => [],
        ];
    }

    private function rebuild(Actor $actor): array
    {
        $actor->requireOwner();
        $this->store->enqueue('metrics.rebuild', []);

        return $this->store->accepted();
    }

    private function visibleProjects(Actor $actor, ?string $projectId): array
    {
        if ($projectId !== null) {
            $actor->requireProject($projectId);
            $project = $this->store->find('projects', $projectId);
            if ($project === null) {
                throw new Problem(404, 'resource_not_found', 'The requested project does not exist.');
            }

            return [$project];
        }

        return array_values(array_filter($this->store->all('projects'), static fn (array $project): bool => $actor->canProject((string) $project['id'])));
    }

    private function forProjects(string $type, array $projectIds): array
    {
        $items = [];
        foreach ($projectIds as $projectId) {
            array_push($items, ...$this->store->all($type, (string) $projectId));
        }

        return $items;
    }

    private function forEvents(array $projectIds): array
    {
        $items = [];
        foreach ($projectIds as $projectId) {
            array_push($items, ...$this->store->all('events', (string) $projectId));
        }

        usort($items, static fn (array $left, array $right): int => ($left['aggregate_sequence'] ?? 0) <=> ($right['aggregate_sequence'] ?? 0));

        return $items;
    }

    private function isOpenTask(array $task, string $projectId): bool
    {
        $statusId = $task['status_id'] ?? null;
        if ($statusId === null) {
            return !in_array($task['status'] ?? null, ['done', 'cancelled'], true);
        }

        $status = $this->store->find('statuses', (string) $statusId);
        if ($status === null) {
            $status = $this->store->find('task_statuses', (string) $statusId);
        }
        if ($status === null) {
            foreach ($this->store->all('statuses', $projectId) as $candidate) {
                if (($candidate['id'] ?? null) === $statusId) {
                    $status = $candidate;
                    break;
                }
            }
        }

        return !in_array($status['category'] ?? $status['key'] ?? $status['status'] ?? null, ['done', 'cancelled'], true);
    }

    private function attentionItems(array $projectIds): array
    {
        $items = [];
        $now = $this->store->now();
        foreach ($this->forProjects('tasks', $projectIds) as $task) {
            $intake = $this->store->find('intakes', (string) ($task['intake_id'] ?? ''));
            $human = $task['human_attention'] ?? [];
            $reasons = is_array($human) && is_array($human['reasons'] ?? null) ? $human['reasons'] : [];
            foreach ($reasons as $reason) {
                if (is_string($reason)) {
                    [$title, $detail] = $this->attentionReasonText($reason);
                    $items[] = $this->attention('classification', $task['project_id'] ?? null, 'task', $task, $title, $detail, $task['updated_at'] ?? $now);
                    continue;
                }
                if (!is_array($reason) || ($reason['resolved_at'] ?? null) !== null || ($reason['addressee'] ?? 'owner') !== 'owner') {
                    continue;
                }
                $code = is_string($reason['code'] ?? null) ? $reason['code'] : '';
                [$fallbackTitle, $fallbackDetail] = $this->attentionReasonText($code);
                $items[] = $this->attention('classification', $task['project_id'] ?? null, 'task', $task, $reason['title'] ?? $fallbackTitle, $reason['detail'] ?? $fallbackDetail, $reason['created_at'] ?? $task['updated_at'] ?? $now);
            }
            if (in_array($intake['status'] ?? $task['intake_status'] ?? null, ['needs_information', 'waiting_for_requester'], true)) {
                $items[] = $this->attention('intake_information', $task['project_id'] ?? null, 'task', $task, 'Rückfrage an Agent', 'Ergänzende Angaben werden erwartet.', $intake['updated_at'] ?? $task['updated_at'] ?? $now);
            }
        }

        foreach ($this->forProjects('approvals', $projectIds) as $approval) {
            if (in_array($approval['state'] ?? null, ['pending', 'requested', 'waiting'], true)) {
                $items[] = $this->attention('approval', $approval['project_id'] ?? null, 'approval', $approval, 'Menschliche Entscheidung offen', $approval['reason'] ?? 'Eine Freigabe wird benötigt.', $approval['created_at'] ?? $now);
            }
        }

        foreach ($this->store->all('connections') as $connection) {
            if (in_array($connection['health'] ?? null, ['degraded', 'unreachable', 'incompatible'], true) && ($connection['project_id'] ?? null) !== null && in_array($connection['project_id'], $projectIds, true)) {
                $items[] = $this->attention('auth', $connection['project_id'], 'connection', $connection, 'T3-Verbindung prüfen', $connection['diagnostic'] ?? 'Die Verbindung meldet einen Fehlerzustand.', $connection['updated_at'] ?? $now);
            }
        }

        foreach ($this->store->all('plugins') as $plugin) {
            if (($plugin['state'] ?? null) === 'draining') {
                $items[] = $this->attention('plugin_drain', null, 'plugin', $plugin, 'Plugin-Deaktivierung läuft', 'Aktive Beiträge und Daten werden weiterhin beobachtet.', $plugin['updated_at'] ?? $now);
            }
        }

        usort($items, static fn (array $left, array $right): int => strcmp($left['since'], $right['since']));

        return $items;
    }

    private function attention(string $kind, ?string $projectId, string $resourceType, array $record, string $title, string $detail, string $since): array
    {
        return [
            'kind' => $kind,
            'project_id' => $projectId,
            'resource' => [
                'resource_type' => $resourceType,
                'id' => (string) ($record['id'] ?? ''),
                'version' => max(1, (int) ($record['version'] ?? 1)),
                'url' => '/api/v1/'.str_replace('_', '-', $resourceType).'s/'.rawurlencode((string) ($record['id'] ?? '')),
            ],
            'title' => mb_substr($title, 0, 300),
            'detail' => mb_substr($detail, 0, 2000),
            'since' => $since,
            'allowed_actions' => [],
        ];
    }

    private function activityItems(array $events): array
    {
        $items = [];
        foreach (array_slice($events, -100) as $event) {
            $type = (string) ($event['event_type'] ?? '');
            if ($type === '' || str_starts_with($type, 'MetricsProjection')) {
                continue;
            }
            $aggregate = $event['aggregate'] ?? [];
            $resourceType = (string) ($aggregate['type'] ?? 'task');
            $resourceId = (string) ($aggregate['id'] ?? '');
            $data = $event['data'] ?? [];
            $resourceName = $this->resourceDisplayName($resourceType, $resourceId);

            $items[] = [
                'id' => (string) ($event['event_id'] ?? $event['id'] ?? ''),
                'occurred_at' => (string) ($event['occurred_at'] ?? $this->store->now()),
                'actor' => $event['actor'] ?? ['kind' => 'system', 'id' => 'system'],
                'type' => $type,
                'summary' => $resourceName === '' ? $type : $resourceName.' · '.$type,
                'resource' => [
                    'resource_type' => $resourceType,
                    'id' => $resourceId,
                    'version' => max(1, (int) ($aggregate['version'] ?? 1)),
                    'url' => '/api/v1/'.str_replace('_', '-', $resourceType).'s/'.rawurlencode($resourceId),
                ],
                'project_id' => $event['project_id'] ?? null,
            ];
        }

        usort($items, static fn (array $left, array $right): int => strcmp($right['occurred_at'], $left['occurred_at']));

        return $items;
    }

    private function resourceDisplayName(string $type, string $id): string
    {
        $storeType = match ($type) {
            'project' => 'projects',
            'task' => 'tasks',
            'run' => 'runs',
            'approval' => 'approvals',
            'workflow' => 'workflows',
            'plugin' => 'plugins',
            default => null,
        };
        if ($storeType === null || $id === '') {
            return '';
        }

        $record = $this->store->find($storeType, $id) ?? [];

        return (string) ($record['title'] ?? $record['name'] ?? '');
    }

    private function summaryMetrics(array $tasks, array $runs, array $projectIds, ?DateTimeImmutable $from = null, ?DateTimeImmutable $to = null): array
    {
        $allEvents = $this->forEvents($projectIds);
        if ($from !== null && $to !== null) {
            $allEvents = array_values(array_filter($allEvents, fn (array $event): bool => $this->inRange($this->eventTime($event), $from, $to)));
        }
        $open = count(array_filter($tasks, fn (array $task): bool => $this->isOpenTask($task, (string) ($task['project_id'] ?? ''))));
        $active = count(array_filter($runs, static fn (array $run): bool => in_array($run['state'] ?? null, self::ACTIVE_RUN_STATES, true)));
        $done = count(array_filter($allEvents, static fn (array $event): bool => in_array($event['event_type'] ?? null, ['TaskMoved', 'TaskCompleted'], true) && (($event['data']['to_category'] ?? $event['data']['to'] ?? null) === 'done')));
        $humanAttention = count(array_filter($this->attentionItems($projectIds), static fn (array $item): bool => $item['kind'] !== 'intake_information'));
        $agentQuestions = count(array_filter($this->attentionItems($projectIds), static fn (array $item): bool => $item['kind'] === 'intake_information'));
        $intakes = array_values(array_filter($this->forProjects('intakes', $projectIds), fn (array $intake): bool => $this->inRange($this->parseDate($intake['created_at'] ?? null), $from, $to)));
        $runReports = array_values(array_filter($this->forProjects('runs', $projectIds), static fn (array $run): bool => in_array($run['state'] ?? null, ['succeeded', 'failed', 'cancelled'], true)));
        $metrics = [
            $this->metric('open_tasks', 'Offene Tickets', $open, 'count', count($tasks)),
            $this->metric('throughput', 'Abgeschlossene Tickets', $done, 'count', $done),
            $this->metric('active_runs', 'Laufende T3-Aufträge', $active, 'count', count($runs)),
            $this->metric('human_attention', 'Menschliche Entscheidungen offen', $humanAttention, 'count', $humanAttention),
            $this->metric('waiting_for_requester', 'Rückfragen an Agents', $agentQuestions, 'count', $agentQuestions),
            $this->metric('intake_received', 'Eingänge im Zeitraum', count($intakes), 'count', count($intakes)),
            $this->metric('run_success_reports', 'Erfolgreich gemeldete T3-Aufträge', count(array_filter($runReports, static fn (array $run): bool => ($run['state'] ?? null) === 'succeeded')), 'count', count($runReports)),
            $this->metric('run_failed_reports', 'Fehlgeschlagene T3-Aufträge', count(array_filter($runReports, static fn (array $run): bool => ($run['state'] ?? null) === 'failed')), 'count', count($runReports)),
        ];

        return $metrics;
    }

    private function metricValues(?string $projectId, array $events, string $computedAt, ?array $tasks = null, ?array $runs = null): array
    {
        $projectIds = $projectId === null ? array_column($this->store->all('projects'), 'id') : [$projectId];
        $tasks ??= $this->forProjects('tasks', $projectIds);
        $runs ??= $this->forProjects('runs', $projectIds);
        $open = count(array_filter($tasks, fn (array $task): bool => $this->isOpenTask($task, (string) ($task['project_id'] ?? ''))));
        $active = count(array_filter($runs, static fn (array $run): bool => in_array($run['state'] ?? null, self::ACTIVE_RUN_STATES, true)));
        $done = count(array_filter($events, static fn (array $event): bool => in_array($event['event_type'] ?? null, ['TaskMoved', 'TaskCompleted'], true) && (($event['data']['to_category'] ?? $event['data']['to'] ?? null) === 'done')));
        $attention = $this->attentionItems($projectIds);
        $intakes = $this->forProjects('intakes', $projectIds);
        $classifications = array_filter($events, static fn (array $event): bool => ($event['event_type'] ?? null) === 'TicketClassified');
        $routeCorrections = array_filter($events, static fn (array $event): bool => in_array($event['event_type'] ?? null, ['WorkflowRouteCorrected', 'RoutingCorrected'], true));
        $terminalRuns = array_values(array_filter($runs, static fn (array $run): bool => in_array($run['state'] ?? null, ['succeeded', 'failed', 'cancelled'], true)));

        return [
            $this->metric('open_tasks', 'Offene Tickets', $open, 'count', count($tasks)),
            $this->metric('throughput', 'Abgeschlossene Tickets', $done, 'count', $done),
            $this->metric('active_runs', 'Laufende T3-Aufträge', $active, 'count', count($runs)),
            $this->metric('human_attention', 'Menschliche Entscheidungen offen', count(array_filter($attention, static fn (array $item): bool => $item['kind'] !== 'intake_information')), 'count', count($attention)),
            $this->metric('waiting_for_requester', 'Rückfragen an Agents', count(array_filter($attention, static fn (array $item): bool => $item['kind'] === 'intake_information')), 'count', count($attention)),
            $this->metric('intake_ready', 'Eingänge fachlich eingeordnet', count(array_filter($intakes, static fn (array $intake): bool => ($intake['status'] ?? $intake['outcome'] ?? null) === 'ready')), 'count', count($intakes)),
            $this->metric('intake_needs_information', 'Eingänge mit Rückfrage', count(array_filter($intakes, static fn (array $intake): bool => ($intake['status'] ?? $intake['outcome'] ?? null) === 'needs_information')), 'count', count($intakes)),
            $this->metric('classification_records', 'Angewandte Einordnungen', count($classifications), 'count', count($classifications)),
            $this->metric('routing_corrections', 'Korrigierte Routen', count($routeCorrections), 'count', count($routeCorrections)),
            $this->metric('run_success_rate', 'Erfolgreich gemeldete Runs', $terminalRuns === [] ? null : count(array_filter($terminalRuns, static fn (array $run): bool => ($run['state'] ?? null) === 'succeeded')) / count($terminalRuns), 'ratio', count($terminalRuns), 'derived', $terminalRuns === [] ? 'unavailable' : 'measured', $terminalRuns === [] ? 'Für den gewählten Zeitraum liegen keine abgeschlossenen Runs vor.' : null),
            $this->metric('lead_time_seconds', 'Lead-Time bis zum Abschluss', $this->averageDuration($events, 'TicketRegistered', ['TaskMoved', 'TaskCompleted'], 'done'), 'seconds', count($events), 'derived', 'estimated', null),
            $this->metric('cycle_time_seconds', 'Cycle-Time ab Arbeitsbeginn', $this->averageDuration($events, 'TaskMoved', ['TaskMoved', 'TaskCompleted'], 'done', 'active'), 'seconds', count($events), 'derived', 'estimated', null),
        ];
    }

    private function series(array $events, DateTimeImmutable $from, DateTimeImmutable $to, string $grain, ?string $projectId, array $tasks, array $runs): array
    {
        $interval = match ($grain) {
            'week' => 'P7D',
            'month' => 'P1M',
            default => 'P1D',
        };
        $start = $from;
        $points = [];
        $count = 0;

        while ($start <= $to && $count < 366) {
            $end = min($start->add(new DateInterval($interval)), $to->add(new DateInterval('PT1S')));
            $bucketEvents = array_values(array_filter($events, fn (array $event): bool => ($date = $this->eventTime($event)) !== null && $date >= $start && $date < $end));
            $points[] = [
                'period_start' => $start->format(DateTimeInterface::ATOM),
                'period_end' => $end->format(DateTimeInterface::ATOM),
                'metrics' => $this->metricValues($projectId, $bucketEvents, $this->store->now(), $tasks, $runs),
            ];
            $start = $end;
            $count++;
        }

        return $points;
    }

    private function averageDuration(array $events, string $startType, array $endTypes, ?string $endCategory = null, ?string $startCategory = null): ?float
    {
        $byAggregate = [];
        foreach ($events as $event) {
            $aggregate = $event['aggregate'] ?? [];
            if (($aggregate['type'] ?? null) !== 'task' || !isset($aggregate['id'])) {
                continue;
            }
            $time = $this->eventTime($event);
            if ($time === null) {
                continue;
            }
            $data = $event['data'] ?? [];
            $eventType = $event['event_type'] ?? null;
            $category = $data['to_category'] ?? $data['to'] ?? null;
            if ($eventType === $startType && ($startCategory === null || ($data['to_category'] ?? $data['to'] ?? null) === $startCategory)) {
                $byAggregate[$aggregate['id']]['start'] ??= $time;
            }
            if (in_array($eventType, $endTypes, true) && ($endCategory === null || $category === $endCategory)) {
                $byAggregate[$aggregate['id']]['end'] = $time;
            }
        }

        $durations = [];
        foreach ($byAggregate as $episode) {
            if (!isset($episode['start'], $episode['end']) || $episode['end'] < $episode['start']) {
                continue;
            }
            $durations[] = (float) ($episode['end']->getTimestamp() - $episode['start']->getTimestamp());
        }

        return $durations === [] ? null : array_sum($durations) / count($durations);
    }

    private function metric(string $key, string $label, float|int|null $value, string $unit, int $sampleSize, string $provenance = 'derived', string $quality = 'measured', ?string $reason = null): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'value' => $value,
            'unit' => $unit,
            'sample_size' => max(0, $sampleSize),
            'provenance' => $provenance,
            'quality' => $value === null ? 'unavailable' : $quality,
            'reason' => $value === null ? ($reason ?? 'Für diese Kennzahl sind noch keine passenden Beobachtungen vorhanden.') : null,
            'currency' => null,
        ];
    }

    private function dateRange(array $p): array
    {
        $now = new DateTimeImmutable($this->store->now(), new DateTimeZone('UTC'));
        try {
            $from = isset($p['from']) && $p['from'] !== '' ? new DateTimeImmutable((string) $p['from']) : $now->sub(new DateInterval('P30D'));
            $to = isset($p['to']) && $p['to'] !== '' ? new DateTimeImmutable((string) $p['to']) : $now;
        } catch (Throwable) {
            throw new Problem(422, 'validation_failed', 'Metric dates must be valid date-time values.');
        }
        if ($from > $to) {
            throw new Problem(422, 'validation_failed', 'The start date must be earlier than or equal to the end date.');
        }

        return [$from->setTimezone(new DateTimeZone('UTC')), $to->setTimezone(new DateTimeZone('UTC'))];
    }

    private function inRange(?DateTimeImmutable $date, ?DateTimeImmutable $from, ?DateTimeImmutable $to): bool
    {
        if ($date === null) {
            return false;
        }

        return ($from === null || $date >= $from) && ($to === null || $date <= $to);
    }

    private function eventTime(array $event): ?DateTimeImmutable
    {
        return $this->parseDate($event['occurred_at'] ?? null);
    }

    private function parseDate(mixed $value): ?DateTimeImmutable
    {
        if (!is_string($value) || $value === '') {
            return null;
        }

        try {
            return new DateTimeImmutable($value, new DateTimeZone('UTC'));
        } catch (Throwable) {
            return null;
        }
    }

    private function latestTimestamp(array $events, string $fallback): string
    {
        $latest = null;
        foreach ($events as $event) {
            $timestamp = $event['occurred_at'] ?? null;
            if (is_string($timestamp) && ($latest === null || strcmp($timestamp, $latest) > 0)) {
                $latest = $timestamp;
            }
        }

        return $latest ?? $fallback;
    }

    private function slug(string $name): string
    {
        $slug = preg_replace('/[^a-z0-9]+/', '-', strtolower(trim($name))) ?? 'projekt';

        return trim($slug, '-') ?: 'projekt';
    }
}
