<?php

declare(strict_types=1);

namespace App\Access\Infrastructure;

use App\Access\Application\AccessPersistence;
use App\Access\Domain\TechnicalCredential;
use App\Shared\Application\Actor;
use App\Shared\Domain\Problem;

final readonly class TechnicalPrincipalAuthenticator
{
    public function __construct(private AccessPersistence $persistence)
    {
    }

    public function authenticate(string $authorization, string $transport): Actor
    {
        $hash = TechnicalCredential::digestFromHeader($authorization);
        $token = null === $hash ? null : $this->persistence->findTechnicalTokenByHash($hash);

        if (null === $token || !TechnicalCredential::active($token, time())) {
            throw new Problem(401, 'unauthenticated', 'Das technische Token ist ungültig oder abgelaufen.');
        }

        return new Actor(
            $token['principal_id'],
            false,
            $token['project_ids'],
            $token['capabilities'],
            $token['label'],
            $transport,
            true === ($token['all_projects'] ?? false),
        );
    }
}
