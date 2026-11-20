<?php

declare(strict_types=1);

namespace App\Automation\Application;

use App\Automation\Domain\WorkflowDefinitionPolicy;
use App\Automation\Domain\WorkflowDefinitionViolation;
use App\Shared\Domain\Problem;

final readonly class WorkflowPolicyService implements WorkflowPolicy
{
    public function __construct(
        private WorkflowDefinitionPolicy $definitions,
        private WorkflowTransitionSelector $transitions,
    ) {
    }

    /** @param array<string, mixed> $definition */
    public function validateDefinition(array $definition): void
    {
        try {
            $this->definitions->validate($definition);
        } catch (WorkflowDefinitionViolation $violation) {
            throw new Problem(422, $violation->problemCode, $violation->getMessage());
        }
    }

    /**
     * @param list<array<string, mixed>> $transitions
     *
     * @return array<string, mixed>|null
     */
    public function selectTransition(array $transitions, string $fromStageId, string $outcome, ?string $routeLabelId = null): ?array
    {
        return $this->transitions->select($transitions, $fromStageId, $outcome, $routeLabelId);
    }
}
