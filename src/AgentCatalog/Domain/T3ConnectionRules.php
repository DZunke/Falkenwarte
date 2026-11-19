<?php

declare(strict_types=1);

namespace App\AgentCatalog\Domain;

use App\Shared\Domain\Problem;

final class T3ConnectionRules
{
    public function canonicalEndpoint(string $url, bool $testEnvironment): string
    {
        $url = rtrim(trim($url), '/');
        $parts = parse_url($url);
        $scheme = $parts['scheme'] ?? null;
        $host = $parts['host'] ?? null;
        $isSecure = 'https' === $scheme;
        $isTestMock = $testEnvironment && 'http' === $scheme && 't3-mock' === $host;

        if ((!$isSecure && !$isTestMock) || !is_string($host) || '' === $host || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
            throw new Problem(422, 'validation_failed', 'Die T3-Adresse muss eine kanonische HTTPS-URL ohne Zugangsdaten oder Query sein.');
        }

        return $url;
    }

    public function permitsOAuthCallback(string $url): bool
    {
        if ('https' === parse_url($url, PHP_URL_SCHEME) && is_string(parse_url($url, PHP_URL_HOST))) {
            return true;
        }

        return 1 === preg_match('#^http://127\\.0\\.0\\.1(?::[0-9]+)?/#', $url);
    }
}
