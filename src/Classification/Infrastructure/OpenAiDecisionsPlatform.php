<?php

declare(strict_types=1);

namespace App\Classification\Infrastructure;

use App\Classification\Application\DecisionProviderException;
use Symfony\AI\Platform\Model;
use Symfony\AI\Platform\ModelCatalog\ModelCatalogInterface;
use Symfony\AI\Platform\PlatformInterface;
use Symfony\AI\Platform\Result\DeferredResult;
use Symfony\AI\Platform\Result\InMemoryRawResult;
use Symfony\AI\Platform\Result\ObjectResult;
use Symfony\AI\Platform\Result\RawResultInterface;
use Symfony\AI\Platform\Result\ResultInterface;
use Symfony\AI\Platform\ResultConverterInterface;
use Symfony\AI\Platform\TokenUsage\TokenUsageExtractorInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Compatibility bridge for the released Symfony AI Platform contract.
 * It calls the native OpenAI Decisions endpoint and is the only component that knows its wire format.
 */
final readonly class OpenAiDecisionsPlatform implements PlatformInterface
{
    private const string ENDPOINT = 'https://api.openai.com/v1/decisions';
    private ModelCatalogInterface $modelCatalog;

    public function __construct(private HttpClientInterface $httpClient)
    {
        $this->modelCatalog = new OpenAiDecisionsModelCatalog();
    }

    public function invoke(string|Model $model, array|string|object $input, array $options = []): DeferredResult
    {
        $modelName = $model instanceof Model ? $model->getName() : $model;
        if ($modelName !== 'gpt-6-luna') {
            throw new DecisionProviderException('Für die Klassifikation ist ausschließlich gpt-6-luna zugelassen.', retryable: false);
        }

        $apiKey = $options['api_key'] ?? null;
        $questions = $options['questions'] ?? null;
        $timeoutMs = $options['timeout_ms'] ?? 10000;
        if (!is_string($apiKey) || trim($apiKey) === '' || !is_array($questions) || !is_int($timeoutMs)) {
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
            $retryable = $status === 429 || $status >= 500;
            throw new DecisionProviderException(
                $retryable ? 'OpenAI Decisions ist vorübergehend nicht verfügbar.' : 'OpenAI Decisions hat die Anfrage abgewiesen.',
                retryable: $retryable,
            );
        }
        if (!isset($body['answers']) || !is_array($body['answers'])) {
            throw new DecisionProviderException('OpenAI Decisions lieferte kein gültiges Antwortformat.', retryable: false);
        }

        $requestId = $headers['x-request-id'][0] ?? null;
        $providerModel = $body['model'] ?? null;
        $usage = $body['usage']['input_tokens'] ?? null;
        $raw = new InMemoryRawResult($body);
        $deferred = new DeferredResult(new DecisionResultConverter($modelName), $raw);
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
            if (!is_string($name) || $name === '' || !is_array($question)) {
                throw new DecisionProviderException('Eine Decisions-Frage ist ungültig.', retryable: false);
            }
            $type = $question['type'] ?? null;
            if (!in_array($type, ['predicate', 'choice', 'score'], true)) {
                throw new DecisionProviderException('Eine Decisions-Frage verwendet einen unbekannten Fragetyp.', retryable: false);
            }
            $normalized[] = ['type' => $type, 'name' => $name] + $question;
        }

        if ($normalized === [] || count($normalized) > 400) {
            throw new DecisionProviderException('Die Anzahl der Decisions-Fragen liegt außerhalb des erlaubten Bereichs.', retryable: false);
        }

        return $normalized;
    }

    private function endpoint(): string
    {
        $environment = $_SERVER['APP_ENV'] ?? $_ENV['APP_ENV'] ?? getenv('APP_ENV') ?: 'prod';
        if ($environment !== 'test') {
            return self::ENDPOINT;
        }

        $endpoint = $_SERVER['DECISIONS_TEST_ENDPOINT'] ?? $_ENV['DECISIONS_TEST_ENDPOINT'] ?? getenv('DECISIONS_TEST_ENDPOINT') ?: '';
        if ($endpoint === '') {
            throw new DecisionProviderException('Der Decisions-Testendpunkt ist nicht konfiguriert.', retryable: false);
        }

        $host = parse_url($endpoint, PHP_URL_HOST);
        if (!is_string($host) || !in_array($host, ['localhost', '127.0.0.1', 'decisions-mock'], true)) {
            throw new DecisionProviderException('Der Decisions-Testendpunkt muss auf einen lokalen Mock zeigen.', retryable: false);
        }

        return rtrim($endpoint, '/').'/v1/decisions';
    }
}

final readonly class DecisionResultConverter implements ResultConverterInterface
{
    public function __construct(private string $modelName)
    {
    }

    public function supports(Model $model): bool
    {
        return $model->getName() === $this->modelName;
    }

    public function convert(RawResultInterface $result, array $options = []): ResultInterface
    {
        $data = $result->getData();
        if (!isset($data['answers']) || !is_array($data['answers'])) {
            throw new DecisionProviderException('Die Decisions-Antwort konnte nicht eingelesen werden.', retryable: false);
        }

        return new ObjectResult($data);
    }

    public function getTokenUsageExtractor(): ?TokenUsageExtractorInterface
    {
        return null;
    }
}

final readonly class OpenAiDecisionsModelCatalog implements ModelCatalogInterface
{
    public function getModel(string $modelName): Model
    {
        if ($modelName !== 'gpt-6-luna') {
            throw new \InvalidArgumentException('Unbekanntes Decisions-Modell.');
        }

        return new Model($modelName);
    }

    public function getModels(): array
    {
        return ['gpt-6-luna' => ['class' => Model::class, 'capabilities' => []]];
    }
}
