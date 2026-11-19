<?php

declare(strict_types=1);

namespace App\AgentCatalog\Application;

interface AgentCatalogOAuthClient
{
    /** @return array{issuer: string, authorization_server: string, token_endpoint: string, client_id: string, authorization_url: string} */
    public function begin(string $canonicalUrl, string $callbackUrl, string $resourceUrl, string $state, string $codeChallenge): array;

    /** @return array<string, mixed> */
    public function exchange(string $tokenEndpoint, string $code, string $callbackUrl, string $clientId, string $codeVerifier, string $resourceUrl): array;
}
