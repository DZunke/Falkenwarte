<?php

declare(strict_types=1);

namespace App\WorkManagement\Domain;

use App\Shared\Domain\Problem;

final class TaskLinkPolicy
{
    public function validateUrl(string $url): string
    {
        $url = trim($url);
        $parts = parse_url($url);
        if (false === $parts || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true) || !isset($parts['host']) || isset($parts['user']) || isset($parts['pass']) || 1 === preg_match('/[\x00-\x20\x7f]/', $url) || strlen($url) > 4000) {
            throw new Problem(422, 'validation_failed', 'Links müssen gültige HTTP- oder HTTPS-Referenzen ohne Zugangsdaten sein.');
        }

        return $url;
    }
}
