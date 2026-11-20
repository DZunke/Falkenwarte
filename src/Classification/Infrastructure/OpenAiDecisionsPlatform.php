<?php

declare(strict_types=1);

namespace App\Classification\Infrastructure;

use App\Classification\Application\DecisionProviderException;
use Symfony\AI\Platform\Model;
use Symfony\AI\Platform\ModelCatalog\ModelCatalogInterface;
use Symfony\AI\Platform\PlatformInterface;
use Symfony\AI\Platform\Result\DeferredResult;
use Symfony\AI\Platform\Result\InMemoryRawResult;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;
use Symfony\Component\DependencyInjection\Attribute\AutoconfigureTag;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Compatibility bridge for the released Symfony AI Platform contract.
 * It calls the native OpenAI Decisions endpoint and is the only component that knows its wire format.
 */
#[AsAlias(PlatformInterface::class)]
#[AutoconfigureTag('ai.platform', ['name' => 'openai.decisions'])]
final readonly class OpenAiDecisionsPlatform implements PlatformInterface
{
    private const string ENDPOINT = 'https://api.openai.com/v1/decisions';

    public function __construct(
        #[Autowire(service: 'decisions.client')]
        private HttpClientInterface $httpClient,
        #[Autowire('%kernel.environment%')]
        private string $appEnv,
        #[Autowire('%env(DECISIONS_TEST_ENDPOINT)%')]
        private string $decisionsTestEndpoint,
        #[Autowire(service: OpenAiDecisionsModelCatalog::class)]
        private ModelCatalogInterface $modelCatalog,
        private DecisionResultConverter $resultConverter,
    ) {
    }

    public function invoke(string|Model $model, array|string|object $input, array $options = []): DeferredResult
    {
        $modelName = $model instanceof Model ? $model->getName() : $model;
        if ('gpt-6-luna' !== $modelName) {
            throw new DecisionProviderException('Für die Klassifikation ist ausschließlich gpt-6-luna zugelassen.', retryable: false);
        }

        $apiKey = $options['api_key'] ?? null;
        $questions = $options['questions'] ?? null;
        $timeoutMs = $options['timeout_ms'] ?? 10000;
        if (!is_string($apiKey) || '' === trim($apiKey) || !is_array($questions) || !is_int($timeoutMs)) {
            throw new DecisionProviderException('Die Decisions-Verbindung ist nicht vollständig konfiguriert.', retryable: false);
        }

        $endpoint = $this->endpoint();
        $nativeInput = [[
            'type' => 'message',
            'role' => 'user',
            'content' => [[
                'type' => 'input_json',
                'data' => $input,
            ]],
        ]];

        try {
            $response = $this->httpClient->request('POST', $endpoint, [
                'headers' => [
                    'Authorization' => 'Bearer '.$apiKey,
                    'Content-Type' => 'application/json',
                ],
                'json' => [
                    'model' => $modelName,
                    'input' => $nativeInput,
                    'questions' => $this->normalizeQuestions($questions),
                ],
                'timeout' => max(0.5, $timeoutMs / 1000),
            ]);
            $status = $response->getStatusCode();
            $body = $response->toArray(false);
            $headers = $response->getHeaders(false);
        } catch (\Throwable $exception) {
            throw new DecisionProviderException('OpenAI Decisions ist vorübergehend nicht erreichbar.', retryable: true, previous: $exception);
        }

        if ($status < 200 || $status >= 300) {
            $retryable = 429 === $status || $status >= 500;
            throw new DecisionProviderException($retryable ? 'OpenAI Decisions ist vorübergehend nicht verfügbar.' : 'OpenAI Decisions hat die Anfrage abgewiesen.', retryable: $retryable);
        }
        if (!isset($body['answers']) || !is_array($body['answers'])) {
            throw new DecisionProviderException('OpenAI Decisions lieferte kein gültiges Antwortformat.', retryable: false);
        }

        $requestId = $headers['x-request-id'][0] ?? null;
        $providerModel = $body['model'] ?? null;
        $usage = $body['usage']['input_tokens'] ?? null;
        $raw = new InMemoryRawResult($body);
        $deferred = new DeferredResult($this->resultConverter, $raw);
        $deferred->getMetadata()->set([
            'request_id' => is_string($requestId) ? $requestId : null,
            'model' => is_string($providerModel) ? $providerModel : null,
            'input_tokens' => is_int($usage) ? $usage : null,
        ]);

        return $deferred;
    }

    public function getModelCatalog(): ModelCatalogInterface
    {
        return $this->modelCatalog;
    }

    /** @param array<mixed> $questions @return list<array<string, mixed>> */
    private function normalizeQuestions(array $questions): array
    {
        $normalized = [];
        foreach ($questions as $name => $question) {
            if (!is_string($name) || '' === $name || !is_array($question)) {
                throw new DecisionProviderException('Eine Decisions-Frage ist ungültig.', retryable: false);
            }
            $type = $question['type'] ?? null;
            if (!in_array($type, ['predicate', 'choice', 'score'], true)) {
                throw new DecisionProviderException('Eine Decisions-Frage verwendet einen unbekannten Fragetyp.', retryable: false);
            }
            $normalized[] = ['type' => $type, 'name' => $name] + $question;
        }

        if ([] === $normalized || count($normalized) > 400) {
            throw new DecisionProviderException('Die Anzahl der Decisions-Fragen liegt außerhalb des erlaubten Bereichs.', retryable: false);
        }

        return $normalized;
    }

    private function endpoint(): string
    {
        if ('test' !== $this->appEnv) {
            return self::ENDPOINT;
        }

        $endpoint = trim($this->decisionsTestEndpoint);
        if ('' === $endpoint) {
            throw new DecisionProviderException('Der Decisions-Testendpunkt ist nicht konfiguriert.', retryable: false);
        }

        $parts = parse_url($endpoint);
        $host = is_array($parts) ? ($parts['host'] ?? null) : null;
        if ('http' !== parse_url($endpoint, PHP_URL_SCHEME)
            || !is_array($parts)
            || !is_string($host)
            || !in_array($host, ['localhost', '127.0.0.1', 'decisions-mock'], true)
            || isset($parts['user'], $parts['pass'], $parts['query'], $parts['fragment'])
        ) {
            throw new DecisionProviderException('Der Decisions-Testendpunkt muss auf einen lokalen Mock zeigen.', retryable: false);
        }

        return rtrim($endpoint, '/').'/v1/decisions';
    }
}
