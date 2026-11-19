<?php

declare(strict_types=1);

namespace App\Metrics\Application;

use App\Metrics\Domain\MeasurementWindow;
use App\Shared\Application\Actor;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;

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
        if ('metrics.rebuild' !== $kind) {
            return;
        }

        $computedAt = $this->store->now();
        $projects = $this->store->all('projects');
        $sourceEvents = array_values(array_filter($this->store->all('events'), static fn (array $event): bool => !str_starts_with((string) ($event['event_type'] ?? ''), 'MetricsProjection')));
        $dataThrough = $this->latestTimestamp($sourceEvents, $computedAt);

        foreach ($projects as $project) {
            $projectId = $project['id'];
            foreach ($this->metricValues($projectId, $sourceEvents, $computedAt, projectIds: [$projectId]) as $metric) {
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
        $projectFilter = isset($p['project_id']) && '' !== $p['project_id'] ? (string) $p['project_id'] : null;
        $projects = $this->visibleProjects($actor, $projectFilter);
        $projectIds = array_column($projects, 'id');
        $tasks = $this->forProjects('tasks', $projectIds);
        $runs = $this->forProjects('runs', $projectIds);
        $events = $this->forEvents($projectIds);
        $now = $this->store->now();
        $window = MeasurementWindow::fromQuery($p, new \DateTimeImmutable($now, new \DateTimeZone('UTC')));
        $summaries = [];
        $activeRuns = [];

        foreach ($projects as $project) {
            $projectTasks = array_values(array_filter($tasks, static fn (array $task): bool => ($task['project_id'] ?? null) === $project['id']));
            $projectRuns = array_values(array_filter($runs, static fn (array $run): bool => ($run['project_id'] ?? null) === $project['id']));
            $open = count(array_filter($projectTasks, fn (array $task): bool => $this->isOpenTask($task, $project['id'])));
            $active = count(array_filter($projectRuns, static fn (array $run): bool => in_array($run['state'] ?? null, self::ACTIVE_RUN_STATES, true)));
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

        $attention = $this->attentionItems($projectIds, $actor->owner);
        $metrics = $this->metricValues(null, $events, $now, $tasks, $runs, $projectIds, $window, $actor->owner);
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
        $projectFilter = isset($p['project_id']) && '' !== $p['project_id'] ? (string) $p['project_id'] : null;
        $projects = $this->visibleProjects($actor, $projectFilter);
        $projectIds = array_column($projects, 'id');
        $projectId = $projectFilter;
        $computedAt = $this->store->now();
        $window = MeasurementWindow::fromQuery($p, new \DateTimeImmutable($computedAt, new \DateTimeZone('UTC')));
        $grain = (string) ($p['grain'] ?? 'day');
        if (!in_array($grain, ['day', 'week', 'month', 'total'], true)) {
            throw new Problem(422, 'validation_failed', 'The metric grain must be day, week, month or total.');
        }

        $events = $this->forEvents($projectIds);
        $dataThrough = $this->latestTimestamp($events, $computedAt);
        $tasks = $this->forProjects('tasks', $projectIds);
        $runs = $this->forProjects('runs', $projectIds);
        $values = $this->metricValues($projectId, $events, $computedAt, $tasks, $runs, $projectIds, $window, $actor->owner);
        $keys = $p['metric_keys'] ?? [];
        if (is_string($keys)) {
            $keys = [$keys];
        }
        if (is_array($keys) && [] !== $keys) {
            $values = array_values(array_filter($values, static fn (array $metric): bool => in_array($metric['key'], $keys, true)));
        }

        $series = 'total' === $grain ? [] : $this->series($events, $window, $grain, $projectId, $tasks, $runs, $projectIds);

        return [
            'project_id' => $projectId,
            'from' => $window->from->format(\DateTimeInterface::ATOM),
            'to' => $window->to->format(\DateTimeInterface::ATOM),
            'grain' => $grain,
            'values' => array_slice($values, 0, 50),
            'series' => array_slice($series, 0, 366),
            'computed_at' => $computedAt,
            'data_through' => $dataThrough,
            'excluded_records' => count(array_filter($events, fn (array $event): bool => null === $this->eventTime($event))),
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
        if (null !== $projectId) {
            $actor->requireProject($projectId);
            $project = $this->store->find('projects', $projectId);
            if (null === $project) {
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

        usort($items, static function (array $left, array $right): int {
            $time = strcmp((string) ($left['occurred_at'] ?? ''), (string) ($right['occurred_at'] ?? ''));
            if (0 !== $time) {
                return $time;
            }

            $sameAggregate = ($left['aggregate']['id'] ?? null) === ($right['aggregate']['id'] ?? null);
            if ($sameAggregate) {
                return ($left['aggregate_sequence'] ?? 0) <=> ($right['aggregate_sequence'] ?? 0);
            }

            return strcmp((string) ($left['event_id'] ?? ''), (string) ($right['event_id'] ?? ''));
        });

        return $items;
    }

    private function isOpenTask(array $task, string $projectId): bool
    {
        if (is_string($task['status_category'] ?? null)) {
            return !in_array($task['status_category'], ['done', 'cancelled'], true);
        }
        $statusId = $task['status_id'] ?? null;
        if (null === $statusId) {
            return !in_array($task['status'] ?? null, ['done', 'cancelled'], true);
        }

        $status = $this->store->find('statuses', (string) $statusId);
        if (null === $status) {
            $status = $this->store->find('task_statuses', (string) $statusId);
        }
        if (null === $status) {
            foreach ($this->store->all('statuses', $projectId) as $candidate) {
                if (($candidate['id'] ?? null) === $statusId) {
                    $status = $candidate;
                    break;
                }
            }
        }

        return !in_array($status['category'] ?? $status['key'] ?? $status['status'] ?? null, ['done', 'cancelled'], true);
    }

    private function attentionItems(array $projectIds, bool $includeGlobal = true): array
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
            $intakeState = $intake['outcome'] ?? $intake['status'] ?? $task['intake_outcome'] ?? $task['intake_status'] ?? null;
            if (in_array($intakeState, ['needs_information', 'waiting_for_requester'], true)) {
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

        if ($includeGlobal) {
            foreach ($this->store->all('plugins') as $plugin) {
                if (($plugin['state'] ?? null) === 'draining') {
                    $items[] = $this->attention('plugin_drain', null, 'plugin', $plugin, 'Plugin-Deaktivierung läuft', 'Aktive Beiträge und Daten werden weiterhin beobachtet.', $plugin['updated_at'] ?? $now);
                }
            }
        }

        usort($items, static fn (array $left, array $right): int => strcmp($left['since'], $right['since']));

        return $items;
    }

    private function attentionReasonText(string $code): array
    {
        return match ($code) {
            'routing_ambiguous' => ['Workflow auswählen', 'Für diesen Eingang ist keine eindeutige Workflowroute gespeichert.'],
            'classification_unavailable' => ['Einordnung nicht verfügbar', 'Die fachliche Einordnung konnte nicht abgeschlossen werden.'],
            'decision_refused' => ['Einordnung prüfen', 'Die Klassifikation verlangt eine menschliche Entscheidung.'],
            'intake_escalated' => ['Eingang benötigt Entscheidung', 'Der Eingang wurde an den Eigentümer weitergeleitet.'],
            'approval_pending' => ['Freigabe erforderlich', 'Eine menschliche Freigabe steht noch aus.'],
            'agent_question' => ['Rückfrage beantworten', 'Ein Agent wartet auf eine Antwort des Eigentümers.'],
            'run_failed' => ['T3-Auftrag prüfen', 'Ein externer Auftrag wurde als fehlgeschlagen beobachtet.'],
            'auth_required' => ['T3-Zugang prüfen', 'Die Verbindung benötigt eine erneute Authentifizierung.'],
            'reconciliation_required' => ['Abgleich erforderlich', 'Der externe Zustand ist noch nicht sicher bekannt.'],
            'plugin_drain_blocked' => ['Plugin-Deaktivierung blockiert', 'Aktive oder ungeklärte Arbeit verhindert den Abschluss des Drains.'],
            default => ['Mensch erforderlich', 'Für diese Aufgabe wird eine menschliche Entscheidung benötigt.'],
        };
    }

    private function attention(string $kind, ?string $projectId, string $resourceType, array $record, string $title, string $detail, string $since): array
    {
        $task = 'task' === $resourceType ? $record : (isset($record['task_id']) ? $this->store->find('tasks', $record['task_id']) : null);

        return [
            'task_id' => $task['id'] ?? null,
            'task_key' => $task['key'] ?? null,
            'task_title' => $task['title'] ?? null,
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
        foreach (array_reverse($events) as $event) {
            $type = (string) ($event['event_type'] ?? '');
            if ('' === $type || str_starts_with($type, 'MetricsProjection') || str_starts_with($type, 'action.')) {
                continue;
            }
            $aggregate = $event['aggregate'] ?? [];
            $resourceType = (string) ($aggregate['type'] ?? 'task');
            $resourceId = (string) ($aggregate['id'] ?? '');
            $resourceName = $this->resourceDisplayName($resourceType, $resourceId);
            $summary = match ($type) {
                'project.created' => 'Projekt angelegt',
                'project.updated' => 'Projektdaten geändert',
                'project.archived' => 'Projekt archiviert',
                'project.restored' => 'Projekt reaktiviert',
                'task.created', 'work.task_created' => 'Ticket angelegt',
                'task.updated', 'work.task_updated' => 'Ticket bearbeitet',
                'task.moved', 'work.task_moved' => 'Ticket verschoben',
                'task.history_restored' => 'Ticketstand wiederhergestellt',
                'task.criterion_reviewed' => 'Kriterium geprüft',
                'task.criteria_replaced' => 'Kriterien geändert',
                'task.evidence_reported' => 'Nachweis gemeldet',
                'task.labels_set' => 'Ticketlabels geändert',
                'task.link_registered', 'work.link_registered' => 'Link hinzugefügt',
                'task.intake_accepted' => 'Eingang erfasst',
                'task.intake_outcome_changed', 'task.classification_applied' => 'Einordnung aktualisiert',
                'task.intake_owner_decision' => 'Einordnung entschieden',
                'workflow.started' => 'Workflow gestartet',
                'run.result_reported' => 'Agentenergebnis gemeldet',
                default => match ($resourceType) {
                    'task' => 'Ticket geändert',
                    'project' => 'Projekt geändert',
                    'board' => 'Board geändert',
                    'workflow' => 'Workflow geändert',
                    'approval' => 'Freigabe aktualisiert',
                    'run' => 'T3-Auftrag aktualisiert',
                    'label' => 'Label geändert',
                    'plugin' => 'Plugin geändert',
                    default => null,
                },
            };
            if (null === $summary) {
                continue;
            }

            $items[] = [
                'id' => (string) ($event['event_id'] ?? $event['id'] ?? ''),
                'occurred_at' => (string) ($event['occurred_at'] ?? $this->store->now()),
                'actor' => $event['actor'] ?? ['kind' => 'system', 'id' => 'system'],
                'type' => $type,
                'summary' => '' === $resourceName ? $summary : $resourceName.' · '.$summary,
                'resource' => [
                    'resource_type' => $resourceType,
                    'id' => $resourceId,
                    'version' => max(1, (int) ($aggregate['version'] ?? 1)),
                    'url' => '/api/v1/'.str_replace('_', '-', $resourceType).'s/'.rawurlencode($resourceId),
                ],
                'project_id' => $event['project_id'] ?? null,
            ];
            if (100 === count($items)) {
                break;
            }
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
        if (null === $storeType || '' === $id) {
            return '';
        }

        $record = $this->store->find($storeType, $id) ?? [];

        return (string) ($record['title'] ?? $record['name'] ?? '');
    }

    private function metricValues(
        ?string $projectId,
        array $events,
        string $computedAt,
        ?array $tasks = null,
        ?array $runs = null,
        array $projectIds = [],
        ?MeasurementWindow $window = null,
        bool $includeGlobalAttention = false,
    ): array {
        if ([] === $projectIds && null !== $projectId) {
            $projectIds = [$projectId];
        }
        $tasks ??= $this->forProjects('tasks', $projectIds);
        $runs ??= $this->forProjects('runs', $projectIds);
        $open = count(array_filter($tasks, fn (array $task): bool => $this->isOpenTask($task, (string) ($task['project_id'] ?? ''))));
        $active = count(array_filter($runs, static fn (array $run): bool => in_array($run['state'] ?? null, self::ACTIVE_RUN_STATES, true)));
        $attention = $this->attentionItems($projectIds, $includeGlobalAttention);
        $requesterQuestions = count(array_filter($attention, static fn (array $item): bool => 'intake_information' === $item['kind']));
        $humanAttention = count(array_filter($attention, static fn (array $item): bool => 'intake_information' !== $item['kind']));
        $completed = $this->taskCompletionEpisodes($events, $tasks, $window);
        $intakeOutcomes = $this->intakeOutcomes($events, $window);
        $classificationCount = $this->countClassificationRecords($events, $window);
        $routeCorrectionCount = $this->countRoutingCorrections($events, $window);
        $runOutcomes = $this->runOutcomes($events, $window);
        $blockedDurations = $this->durationSamples($events, 'task', 'blocked', static fn (mixed $value): bool => true === $value, $tasks, $window, $computedAt);
        $waitingDurations = $this->durationSamples($events, 'intake', 'waiting_for', static fn (mixed $value): bool => in_array($value, ['requester', 'owner'], true), $this->forProjects('intakes', $projectIds), $window, $computedAt);

        $eligibleRunOutcomes = $runOutcomes['succeeded'] + $runOutcomes['failed'];
        $successRate = 0 === $eligibleRunOutcomes ? null : $runOutcomes['succeeded'] / $eligibleRunOutcomes;

        return [
            $this->metric('open_tasks', 'Offene Tickets', $open, 'count', count($tasks)),
            $this->metric('throughput', 'Abgeschlossene Tickets', $completed['count'], 'count', $completed['count'], 'locally_observed'),
            $this->metric('active_runs', 'Laufende T3-Aufträge', $active, 'count', count($runs)),
            $this->metric('human_attention', 'Menschliche Entscheidungen offen', $humanAttention, 'count', $humanAttention),
            $this->metric('waiting_for_requester', 'Rückfragen an Agents', $requesterQuestions, 'count', $requesterQuestions),
            $this->metric('intake_ready', 'Eingänge fachlich eingeordnet', $intakeOutcomes['ready'], 'count', $intakeOutcomes['ready'], 'locally_observed'),
            $this->metric('intake_needs_information', 'Eingänge mit Rückfrage', $intakeOutcomes['needs_information'], 'count', $intakeOutcomes['needs_information'], 'locally_observed'),
            $this->metric('classification_records', 'Klassifikationen erfasst', $classificationCount, 'count', $classificationCount, 'locally_observed'),
            $this->metric('routing_corrections', 'Korrigierte Routen', $routeCorrectionCount, 'count', $routeCorrectionCount, 'locally_observed'),
            $this->metric('run_success_rate', 'Erfolgsquote abgeschlossener Runs', $successRate, 'ratio', $eligibleRunOutcomes, 'locally_observed', 'measured', 0 === $eligibleRunOutcomes ? 'Für den gewählten Zeitraum liegen keine abgeschlossenen Runs mit Ergebnis vor.' : null),
            $this->metric('run_succeeded', 'Erfolgreich abgeschlossene Runs', $runOutcomes['succeeded'], 'count', $runOutcomes['succeeded'], 'locally_observed'),
            $this->metric('run_failed', 'Fehlgeschlagene Runs', $runOutcomes['failed'], 'count', $runOutcomes['failed'], 'locally_observed'),
            $this->metric('run_cancelled', 'Abgebrochene Runs', $runOutcomes['cancelled'], 'count', $runOutcomes['cancelled'], 'locally_observed'),
            $this->metric('lead_time_seconds', 'Median Lead-Time bis Abschluss', $this->median($completed['lead']), 'seconds', count($completed['lead'])),
            $this->metric('cycle_time_seconds', 'Median Cycle-Time ab Arbeitsbeginn', $this->median($completed['cycle']), 'seconds', count($completed['cycle'])),
            $this->metric('blocked_time_seconds', 'Median Blockadezeit', $this->median($blockedDurations), 'seconds', count($blockedDurations), 'derived', [] === $blockedDurations ? 'unavailable' : 'estimated'),
            $this->metric('waiting_time_seconds', 'Median Wartezeit auf Antwort oder Entscheidung', $this->median($waitingDurations), 'seconds', count($waitingDurations), 'derived', [] === $waitingDurations ? 'unavailable' : 'estimated'),
        ];
    }

    private function series(array $events, MeasurementWindow $window, string $grain, ?string $projectId, array $tasks, array $runs, array $projectIds): array
    {
        $seriesKeys = ['throughput', 'intake_ready', 'intake_needs_information', 'classification_records', 'routing_corrections', 'run_success_rate', 'run_succeeded', 'run_failed', 'run_cancelled', 'lead_time_seconds', 'cycle_time_seconds', 'blocked_time_seconds', 'waiting_time_seconds'];
        $points = [];
        foreach ($window->buckets($grain) as $bucket) {
            $values = $this->metricValues($projectId, $events, $this->store->now(), $tasks, $runs, $projectIds, $bucket);
            $points[] = [
                'period_start' => $bucket->from->format(\DateTimeInterface::ATOM),
                'period_end' => $bucket->to->format(\DateTimeInterface::ATOM),
                'metrics' => array_values(array_filter($values, static fn (array $metric): bool => in_array($metric['key'], $seriesKeys, true))),
            ];
        }

        return $points;
    }

    private function taskCompletionEpisodes(array $events, array $tasks, ?MeasurementWindow $window): array
    {
        $taskById = [];
        foreach ($tasks as $task) {
            if (is_string($task['id'] ?? null)) {
                $taskById[$task['id']] = $task;
            }
        }
        $state = [];
        $leadStarts = [];
        $cycleStarts = [];
        $result = ['count' => 0, 'lead' => [], 'cycle' => []];

        foreach ($events as $event) {
            $aggregate = is_array($event['aggregate'] ?? null) ? $event['aggregate'] : [];
            $taskId = ($aggregate['type'] ?? null) === 'task' ? ($aggregate['id'] ?? null) : null;
            $time = $this->eventTime($event);
            if (!is_string($taskId) || null === $time) {
                continue;
            }
            [$before, $after] = $this->transition($event);
            $data = is_array($event['data'] ?? null) ? $event['data'] : [];
            $beforeCategory = $before['status_category'] ?? $data['from_category'] ?? null;
            $afterCategory = $after['status_category'] ?? $data['to_category'] ?? $data['to'] ?? null;
            $eventType = (string) ($event['event_type'] ?? '');
            if (null === $afterCategory && in_array($eventType, ['task.completed', 'task_completed', 'TaskCompleted'], true)) {
                $afterCategory = 'done';
            }
            $currentCategory = $state[$taskId] ?? $beforeCategory;
            $taskCreated = $this->parseDate($taskById[$taskId]['created_at'] ?? null);

            if (!array_key_exists($taskId, $leadStarts) && 'done' !== $currentCategory) {
                $leadStarts[$taskId] = $taskCreated ?? $time;
            }
            if (in_array($afterCategory, ['active', 'review'], true) && !in_array($currentCategory, ['active', 'review'], true)) {
                $cycleStarts[$taskId] = $time;
                $leadStarts[$taskId] ??= $taskCreated ?? $time;
            }
            if ('done' === $currentCategory && null !== $afterCategory && !in_array($afterCategory, ['done', 'cancelled'], true)) {
                $leadStarts[$taskId] = $time;
                unset($cycleStarts[$taskId]);
            }

            if ('done' === $afterCategory && 'done' !== $currentCategory && (null === $window || $window->contains($time))) {
                ++$result['count'];
                $leadStart = $leadStarts[$taskId];
                if ($time >= $leadStart) {
                    $result['lead'][] = (float) ($time->getTimestamp() - $leadStart->getTimestamp());
                }
                $cycleStart = $cycleStarts[$taskId] ?? null;
                if ($cycleStart instanceof \DateTimeImmutable && $time >= $cycleStart) {
                    $result['cycle'][] = (float) ($time->getTimestamp() - $cycleStart->getTimestamp());
                }
                unset($leadStarts[$taskId], $cycleStarts[$taskId]);
            }

            if (null !== $afterCategory) {
                $state[$taskId] = $afterCategory;
            } elseif (null !== $currentCategory) {
                $state[$taskId] = $currentCategory;
            }
        }

        return $result;
    }

    private function intakeOutcomes(array $events, ?MeasurementWindow $window): array
    {
        $counts = ['ready' => 0, 'needs_information' => 0];
        foreach ($events as $event) {
            $aggregate = is_array($event['aggregate'] ?? null) ? $event['aggregate'] : [];
            if (($aggregate['type'] ?? null) !== 'intake' || !$this->eventWithin($event, $window)) {
                continue;
            }
            [, $after] = $this->transition($event);
            $outcome = $after['outcome'] ?? null;
            if (isset($counts[$outcome])) {
                ++$counts[$outcome];
            }
        }

        return $counts;
    }

    private function countClassificationRecords(array $events, ?MeasurementWindow $window): int
    {
        return count(array_filter($events, fn (array $event): bool => ($event['aggregate']['type'] ?? null) === 'classification'
            && ($event['data']['change'] ?? null) === 'created'
            && $this->eventWithin($event, $window)));
    }

    private function countRoutingCorrections(array $events, ?MeasurementWindow $window): int
    {
        return count(array_filter($events, function (array $event) use ($window): bool {
            $type = strtolower((string) ($event['event_type'] ?? ''));

            return $this->eventWithin($event, $window)
                && (str_contains($type, 'owner_override_recorded') || str_contains($type, 'route_corrected') || str_contains($type, 'routing_corrected'));
        }));
    }

    private function runOutcomes(array $events, ?MeasurementWindow $window): array
    {
        $counts = ['succeeded' => 0, 'failed' => 0, 'cancelled' => 0];
        foreach ($events as $event) {
            $aggregate = is_array($event['aggregate'] ?? null) ? $event['aggregate'] : [];
            if (($aggregate['type'] ?? null) !== 'run' || !$this->eventWithin($event, $window)) {
                continue;
            }
            [$before, $after] = $this->transition($event);
            $state = $after['state'] ?? null;
            if (isset($counts[$state]) && !isset($counts[$before['state'] ?? ''])) {
                ++$counts[$state];
            }
        }

        return $counts;
    }

    private function durationSamples(array $events, string $aggregateType, string $field, callable $isActive, array $records, ?MeasurementWindow $window, string $computedAt): array
    {
        $recordById = [];
        foreach ($records as $record) {
            if (is_string($record['id'] ?? null)) {
                $recordById[$record['id']] = $record;
            }
        }
        $active = [];
        $started = [];
        $intervals = [];
        foreach ($events as $event) {
            $aggregate = is_array($event['aggregate'] ?? null) ? $event['aggregate'] : [];
            $id = ($aggregate['type'] ?? null) === $aggregateType ? ($aggregate['id'] ?? null) : null;
            $time = $this->eventTime($event);
            if (!is_string($id) || null === $time) {
                continue;
            }
            [$before, $after] = $this->transition($event);
            $beforeActive = array_key_exists($id, $active) ? $active[$id] : $isActive($before[$field] ?? null);
            $afterValueExists = array_key_exists($field, $after);
            if (!$afterValueExists) {
                if (!array_key_exists($id, $active) && $beforeActive) {
                    $active[$id] = true;
                    $started[$id] = $this->parseDate($recordById[$id]['created_at'] ?? null) ?? $time;
                }
                continue;
            }
            $afterActive = $isActive($after[$field]);
            if (!$beforeActive && $afterActive) {
                $started[$id] = $time;
            } elseif ($beforeActive && !$afterActive) {
                $start = $started[$id] ?? $this->parseDate($recordById[$id]['created_at'] ?? null);
                if ($start instanceof \DateTimeImmutable && $time >= $start) {
                    $intervals[] = [$start, $time];
                }
                unset($started[$id]);
            }
            $active[$id] = $afterActive;
        }

        $now = $this->parseDate($computedAt) ?? new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $windowEnd = null === $window || $window->to > $now ? $now : $window->to;
        foreach ($active as $id => $isCurrentlyActive) {
            if (!$isCurrentlyActive) {
                continue;
            }
            $start = $started[$id] ?? $this->parseDate($recordById[$id]['created_at'] ?? null);
            if ($start instanceof \DateTimeImmutable && $windowEnd >= $start) {
                $intervals[] = [$start, $windowEnd];
            }
        }

        $durations = [];
        foreach ($intervals as [$start, $end]) {
            if (null !== $window) {
                if ($end <= $window->from || $start >= $window->to) {
                    continue;
                }
                if ($start < $window->from) {
                    $start = $window->from;
                }
                if ($end > $window->to) {
                    $end = $window->to;
                }
                if ($end > $now) {
                    $end = $now;
                }
            }
            if ($end >= $start) {
                $durations[] = (float) ($end->getTimestamp() - $start->getTimestamp());
            }
        }

        return $durations;
    }

    private function transition(array $event): array
    {
        $data = is_array($event['data'] ?? null) ? $event['data'] : [];
        $transition = is_array($data['transition'] ?? null) ? $data['transition'] : [];
        $before = is_array($transition['before'] ?? null) ? $transition['before'] : [];
        $after = is_array($transition['after'] ?? null) ? $transition['after'] : [];
        if (!isset($before['status_category']) && isset($data['from_category'])) {
            $before['status_category'] = $data['from_category'];
        }
        if (!isset($after['status_category']) && isset($data['to_category'])) {
            $after['status_category'] = $data['to_category'];
        }

        return [$before, $after];
    }

    private function eventWithin(array $event, ?MeasurementWindow $window): bool
    {
        return null === $window || $window->contains($this->eventTime($event));
    }

    private function median(array $values): ?float
    {
        if ([] === $values) {
            return null;
        }
        sort($values, SORT_NUMERIC);
        $middle = intdiv(count($values), 2);

        return 1 === count($values) % 2 ? (float) $values[$middle] : ((float) $values[$middle - 1] + (float) $values[$middle]) / 2;
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
            'quality' => null === $value ? 'unavailable' : $quality,
            'reason' => null === $value ? ($reason ?? 'Für diese Kennzahl sind noch keine passenden Beobachtungen vorhanden.') : null,
            'currency' => null,
        ];
    }

    private function eventTime(array $event): ?\DateTimeImmutable
    {
        return $this->parseDate($event['occurred_at'] ?? null);
    }

    private function parseDate(mixed $value): ?\DateTimeImmutable
    {
        if (!is_string($value) || '' === $value) {
            return null;
        }

        try {
            return new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
        } catch (\Throwable) {
            return null;
        }
    }

    private function latestTimestamp(array $events, string $fallback): string
    {
        $latest = null;
        foreach ($events as $event) {
            $timestamp = $event['occurred_at'] ?? null;
            if (is_string($timestamp) && (null === $latest || strcmp($timestamp, $latest) > 0)) {
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
