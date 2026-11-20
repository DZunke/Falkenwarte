<?php

declare(strict_types=1);

namespace App\Automation\Infrastructure;

use App\Automation\Application\WorkflowTransitionSelector;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;
use Symfony\Component\Workflow\Definition;
use Symfony\Component\Workflow\MarkingStore\MethodMarkingStore;
use Symfony\Component\Workflow\StateMachine;
use Symfony\Component\Workflow\Transition;

/** Applies Symfony Workflow's state machine rules to the saved route definition. */
#[AsAlias(WorkflowTransitionSelector::class)]
final readonly class SymfonyWorkflowTransitionSelector implements WorkflowTransitionSelector
{
    /**
     * @param list<array<string, mixed>> $transitions
     *
     * @return array<string, mixed>|null
     */
    public function select(array $transitions, string $fromStageId, string $outcome): ?array
    {
        $places = [$fromStageId => $fromStageId];
        $workflowTransitions = [];
        $originalTransitions = new \SplObjectStorage();

        foreach ($transitions as $transition) {
            $source = $transition['from_stage_id'] ?? null;
            $transitionOutcome = $transition['on'] ?? null;

            if (!is_string($source) || !is_string($transitionOutcome)) {
                continue;
            }

            $target = $transition['to_stage_id'] ?? null;
            $target = is_string($target) ? $target : $source;
            $places[$source] = $source;
            $places[$target] = $target;
            $workflowTransition = new Transition($transitionOutcome, $source, $target);
            $workflowTransitions[] = $workflowTransition;
            $originalTransitions[$workflowTransition] = $transition;
        }

        $definition = new Definition(array_values($places), $workflowTransitions, $fromStageId);
        $workflow = new StateMachine($definition, new MethodMarkingStore(singleState: true), eventsToDispatch: []);
        $subject = new class($fromStageId) {
            public function __construct(public string $marking)
            {
            }
        };

        foreach ($workflow->getEnabledTransitions($subject) as $enabledTransition) {
            if ($enabledTransition->getName() === $outcome) {
                return $originalTransitions[$enabledTransition];
            }
        }

        return null;
    }
}
