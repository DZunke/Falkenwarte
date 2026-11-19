<?php

declare(strict_types=1);

namespace App\Orchestration\Domain;

/** Applies the frozen workflow depth limit to an explicitly delegated run. */
final class RunDelegationPolicy
{
    public function childDepth(int $parentDepth, int $maximumDepth): int
    {
        if ($parentDepth < 0 || $maximumDepth < 1) {
            throw new RunDelegationViolation('workflow_definition_invalid', 'Die Delegation benötigt eine gültige Tiefe und Workflowgrenze.');
        }

        $depth = $parentDepth + 1;
        if ($depth > $maximumDepth) {
            throw new RunDelegationViolation('workflow_depth_limit', 'Die konfigurierte maximale Delegationstiefe ist erreicht.');
        }

        return $depth;
    }
}
