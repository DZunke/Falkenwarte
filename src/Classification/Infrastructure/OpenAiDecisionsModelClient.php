<?php

declare(strict_types=1);

namespace App\Classification\Infrastructure;

use App\Classification\Application\DecisionProviderException;
use App\Shared\Application\Store;
use Symfony\AI\Platform\Model;
use Symfony\AI\Platform\ModelClientInterface;
use Symfony\AI\Platform\Result\RawHttpResult;
use Symfony\AI\Platform\Result\RawResultInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/** The narrow Symfony AI model client for OpenAI's Decisions API, which has no locked official bridge. */
final readonly class OpenAiDecisionsModelClient implements ModelClientInterface
{
    private const string ENDPOINT = 'https://api.openai.com/v1/decisions';

    public function __construct(
        #[Autowire(service: 'decisions.client')]
        private HttpClientInterface $httpClient,
        private Store $store,
        #[Autowire('%kernel.environment%')]
        private string $appEnv,
        #[Autowire('%env(DECISIONS_TEST_ENDPOINT)%')]
        private string $decisionsTestEndpoint,
    ) {
    }

    public function supports(Model $model): bool
    {
        return 'gpt-6-luna' === $model->getName();
    }

    public function request(Model $model, array|string $payload, array $options = []): RawResultInterface
    {
        if (!$this->supports($model)) {
            throw new DecisionProviderException('Für die Klassifikation ist ausschließlich gpt-6-luna zugelassen.', retryable: false);
        }

        $secretReferenceId = $options['secret_reference_id'] ?? null;
        $questions = $options['questions'] ?? null;
        $timeoutMs = $options['timeout_ms'] ?? 10000;
        if (!is_string($secretReferenceId) || '' === trim($secretReferenceId) || !is_array($questions) || !is_int($timeoutMs)) {
            throw new DecisionProviderException('Die Decisions-Verbindung ist nicht vollständig konfiguriert.', retryable: false);
        }

        $endpoint = $this->endpoint();
        // Resolve the current credential only at the transport boundary so it never enters AI options, events, or results.
        $apiKey = $this->store->secret($secretReferenceId);
        if ('' === trim($apiKey)) {
            throw new DecisionProviderException('Die Decisions-Verbindung ist nicht vollständig konfiguriert.', retryable: false);
        }

        $nativeInput = [[
            'type' => 'message',
            'role' => 'user',
            'content' => [[
                'type' => 'input_json',
                'data' => $payload,
            ]],
        ]];

        try {
            $response = $this->httpClient->request('POST', $endpoint, [
                'headers' => [
                    'Authorization' => 'Bearer '.$apiKey,
                    'Content-Type' => 'application/json',
                ],
                'json' => [
                    'model' => $model->getName(),
                    'input' => $nativeInput,
                    'questions' => $this->normalizeQuestions($questions),
                ],
                'timeout' => max(0.5, $timeoutMs / 1000),
            ]);
            $status = $response->getStatusCode();
        } catch (\Throwable $exception) {
            throw new DecisionProviderException('OpenAI Decisions ist vorübergehend nicht erreichbar.', retryable: true, previous: $exception);
        }

        if ($status < 200 || $status >= 300) {
            $retryable = 429 === $status || $status >= 500;
            throw new DecisionProviderException($retryable ? 'OpenAI Decisions ist vorübergehend nicht verfügbar.' : 'OpenAI Decisions hat die Anfrage abgewiesen.', retryable: $retryable);
        }

        return new RawHttpResult($response);
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
