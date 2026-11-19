<?php

declare(strict_types=1);

namespace App\Orchestration\Infrastructure;

use App\Orchestration\Application\T3OAuthClient;
use App\Orchestration\Application\T3BridgeException;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Throwable;

final class T3OAuthAuthenticator implements T3OAuthClient
{
    public function __construct(private readonly HttpClientInterface $http)
    {
    }

    public function begin(string $canonicalUrl, string $callbackUrl, string $resourceUrl, string $state, string $codeChallenge): array
    {
        $metadata = $this->getJson(rtrim($canonicalUrl, '/').'/.well-known/oauth-protected-resource/mcp');
        $issuer = (string) ($metadata['issuer'] ?? ($metadata['authorization_servers'][0] ?? $canonicalUrl));
        $authorizationServer = (string) ($metadata['authorization_server'] ?? ($metadata['authorization_servers'][0] ?? $issuer));
        $serverMetadata = $metadata;
        if (!isset($serverMetadata['authorization_endpoint'], $serverMetadata['token_endpoint'], $serverMetadata['registration_endpoint'])) {
            $serverMetadata = $this->getJson(rtrim($authorizationServer, '/').'/.well-known/oauth-authorization-server');
        }
        $authorizationEndpoint = $this->metadataUrl($authorizationServer, (string) ($serverMetadata['authorization_endpoint'] ?? ''));
        $tokenEndpoint = $this->metadataUrl($authorizationServer, (string) ($serverMetadata['token_endpoint'] ?? ''));
        $registrationEndpoint = $this->metadataUrl($authorizationServer, (string) ($serverMetadata['registration_endpoint'] ?? ''));
        $registration = $this->requestJson('POST', $registrationEndpoint, [
            'client_name' => 'Falkenwarte', 'redirect_uris' => [$callbackUrl], 'grant_types' => ['authorization_code'],
            'response_types' => ['code'], 'token_endpoint_auth_method' => 'none',
        ]);
        $clientId = $registration['client_id'] ?? null;
        if (!is_string($clientId) || $clientId === '') {
            throw new T3BridgeException('T3 hat keine gültige öffentliche OAuth-Client-ID registriert.');
        }
        $query = http_build_query([
            'response_type' => 'code', 'client_id' => $clientId, 'redirect_uri' => $callbackUrl,
            'state' => $state, 'code_challenge' => $codeChallenge, 'code_challenge_method' => 'S256',
            'resource' => $resourceUrl, 'scope' => 'orchestration:operate',
        ], '', '&', PHP_QUERY_RFC3986);

        return [
            'issuer' => $issuer, 'authorization_server' => $authorizationServer, 'token_endpoint' => $tokenEndpoint,
            'client_id' => $clientId, 'authorization_url' => $authorizationEndpoint.'?'.$query,
        ];
    }

    public function exchange(string $tokenEndpoint, string $code, string $callbackUrl, string $clientId, string $codeVerifier, string $resourceUrl): array
    {
        try {
            $response = $this->http->request('POST', $tokenEndpoint, [
                'headers' => ['Accept' => 'application/json', 'Content-Type' => 'application/x-www-form-urlencoded'],
                'body' => [
                    'grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => $callbackUrl,
                    'client_id' => $clientId, 'code_verifier' => $codeVerifier, 'resource' => $resourceUrl,
                ],
                'timeout' => 15,
            ]);
            $status = $response->getStatusCode();
            $content = $response->getContent(false);
        } catch (Throwable $exception) {
            throw new T3BridgeException('Der T3-Autorisierungscode konnte nicht ausgetauscht werden.', false, $exception);
        }
        if ($status < 200 || $status >= 300) {
            throw new T3BridgeException('T3 hat den Autorisierungscode mit HTTP '.$status.' abgewiesen.');
        }
        $data = json_decode($content, true);
        if (!is_array($data)) {
            throw new T3BridgeException('T3 lieferte beim Tokenaustausch keine gültige Antwort.');
        }

        return $data;
    }

    /** @return array<string, mixed> */
    private function getJson(string $url): array
    {
        try {
            $response = $this->http->request('GET', $url, ['headers' => ['Accept' => 'application/json'], 'timeout' => 10]);
            $status = $response->getStatusCode();
            $content = $response->getContent(false);
        } catch (Throwable $exception) {
            throw new T3BridgeException('T3-OAuth-Metadaten sind nicht erreichbar.', false, $exception);
        }
        if ($status < 200 || $status >= 300) {
            throw new T3BridgeException('T3-OAuth-Metadaten lieferten HTTP '.$status.'.');
        }
        $data = json_decode($content, true);
        if (!is_array($data)) {
            throw new T3BridgeException('T3 lieferte ungültige OAuth-Metadaten.');
        }

        return $data;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function requestJson(string $method, string $url, array $body): array
    {
        try {
            $response = $this->http->request($method, $url, ['headers' => ['Accept' => 'application/json'], 'json' => $body, 'timeout' => 10]);
            $status = $response->getStatusCode();
            $content = $response->getContent(false);
        } catch (Throwable $exception) {
            throw new T3BridgeException('T3 konnte keinen öffentlichen OAuth-Client registrieren.', false, $exception);
        }
        if ($status < 200 || $status >= 300) {
            throw new T3BridgeException('T3 hat die Registrierung des OAuth-Clients mit HTTP '.$status.' abgewiesen.');
        }
        $data = json_decode($content, true);
        if (!is_array($data)) {
            throw new T3BridgeException('T3 lieferte bei der Clientregistrierung keine gültige Antwort.');
        }

        return $data;
    }

    private function metadataUrl(string $base, string $endpoint): string
    {
        if ($endpoint === '') {
            throw new T3BridgeException('T3-OAuth-Metadaten enthalten einen erforderlichen Endpunkt nicht.');
        }
        if (parse_url($endpoint, PHP_URL_SCHEME) !== null) {
            return $endpoint;
        }
        if (str_starts_with($endpoint, '/')) {
            $parts = parse_url($base);
            return ($parts['scheme'] ?? 'https').'://'.($parts['host'] ?? '').(isset($parts['port']) ? ':'.$parts['port'] : '').$endpoint;
        }

        return rtrim($base, '/').'/'.$endpoint;
    }
}
