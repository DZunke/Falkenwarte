<?php

declare(strict_types=1);

namespace App\Access\Domain;

use App\Shared\Domain\Problem;

/** The plaintext bearer leaves the issuer once. Persist only its digest and scoped principal. */
final readonly class TechnicalCredential
{
    private function __construct(public string $bearer, public string $digest)
    {
    }

    public static function issue(string $expiry, int $now): self
    {
        if (strtotime($expiry) <= $now) {
            throw new Problem(422, 'validation_failed', 'Das Ablaufdatum muss in der Zukunft liegen.');
        }
        $bearer = 'fw_'.bin2hex(random_bytes(32));

        return new self($bearer, hash('sha256', $bearer));
    }

    public static function digestFromHeader(string $header): ?string
    {
        if (!preg_match('/^Bearer (fw_[A-Za-z0-9_-]+)$/D', $header, $matches)) {
            return null;
        }

        return hash('sha256', $matches[1]);
    }

    public static function active(array $metadata, int $now): bool
    {
        return !$metadata['revoked'] && strtotime($metadata['expires_at']) > $now;
    }
}
