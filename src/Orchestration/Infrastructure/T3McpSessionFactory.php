<?php

declare(strict_types=1);

namespace App\Orchestration\Infrastructure;

use App\Orchestration\Application\T3BridgeException;
use Mcp\Client;
use Mcp\Schema\Enum\ProtocolVersion;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestFactoryInterface;
use Psr\Http\Message\StreamFactoryInterface;
use Symfony\AI\McpBundle\Client\ServerConnection;
use Symfony\AI\McpBundle\Client\ServerConnectionInterface;
use Symfony\AI\McpBundle\Client\TransportFactory;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** Creates short-lived, connection-specific MCP sessions through Symfony MCP Bundle primitives. */
final class T3McpSessionFactory
{
    public const PROTOCOL_VERSION = '2025-06-18';

    public function __construct(
        #[Autowire(service: 'psr18.t3.client')]
        private readonly ClientInterface $httpClient,
        #[Autowire(service: 'mcp.psr17_factory')]
        private readonly RequestFactoryInterface $requestFactory,
        #[Autowire(service: 'mcp.psr17_factory')]
        private readonly StreamFactoryInterface $streamFactory,
        private readonly string $appVersion,
        #[Autowire('%kernel.environment%')]
        private readonly string $appEnv,
    ) {
    }

    public function create(string $canonicalUrl, string $token): ServerConnectionInterface
    {
        $baseUrl = rtrim($canonicalUrl, '/');
        if (!str_starts_with($baseUrl, 'https://') && !$this->allowsTestMock($baseUrl)) {
            throw new T3BridgeException('Die T3-Verbindung benötigt eine kanonische HTTPS-Adresse.');
        }

        $transport = TransportFactory::http(
            $baseUrl.'/mcp',
            ['Authorization' => 'Bearer '.$token],
            $this->httpClient,
            $this->requestFactory,
            $this->streamFactory,
            null,
            null,
        );
        $client = Client::builder()
            ->setClientInfo('falkenwarte', $this->appVersion)
            ->setProtocolVersion(ProtocolVersion::V2025_06_18)
            ->setFallbackProtocolVersion(null)
            ->setInitTimeout(15)
            ->setRequestTimeout(15)
            ->setMaxRetries(0)
            ->build();

        return new ServerConnection('falkenwarte', 't3', $client, $transport);
    }

    private function allowsTestMock(string $url): bool
    {
        $host = parse_url($url, PHP_URL_HOST);

        return 'test' === $this->appEnv
            && 'http' === parse_url($url, PHP_URL_SCHEME)
            && 't3-mock' === $host;
    }
}
