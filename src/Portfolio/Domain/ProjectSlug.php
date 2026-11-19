<?php

declare(strict_types=1);

namespace App\Portfolio\Domain;

use App\Shared\Domain\Problem;

final readonly class ProjectSlug
{
    private function __construct(public string $value)
    {
    }

    public static function fromString(string $value): self
    {
        $slug = strtolower(trim($value));
        if (1 !== preg_match('/^[a-z][a-z0-9-]{1,62}$/D', $slug)) {
            throw new Problem(422, 'validation_failed', 'Der Projektschlüssel muss mit einem Kleinbuchstaben beginnen und darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten.');
        }

        return new self($slug);
    }
}
