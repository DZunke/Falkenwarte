<?php

declare(strict_types=1);

namespace App\Classification\Domain;

enum IntakeOutcome: string
{
    case ACCEPTED = 'accepted';
    case READY = 'ready';
    case NEEDS_INFORMATION = 'needs_information';
    case NEEDS_HUMAN_DECISION = 'needs_human_decision';
    case CLASSIFICATION_UNAVAILABLE = 'classification_unavailable';
}
