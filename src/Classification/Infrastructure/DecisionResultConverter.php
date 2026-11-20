<?php

declare(strict_types=1);

namespace App\Classification\Infrastructure;

use App\Classification\Application\DecisionProviderException;
use Symfony\AI\Platform\Model;
use Symfony\AI\Platform\Result\ObjectResult;
use Symfony\AI\Platform\Result\RawHttpResult;
use Symfony\AI\Platform\Result\RawResultInterface;
use Symfony\AI\Platform\Result\ResultInterface;
use Symfony\AI\Platform\ResultConverterInterface;
use Symfony\AI\Platform\TokenUsage\TokenUsageExtractorInterface;

final readonly class DecisionResultConverter implements ResultConverterInterface
{
    public function supports(Model $model): bool
    {
        return 'gpt-6-luna' === $model->getName();
    }

    public function convert(RawResultInterface $rawResult, array $options = []): ResultInterface
    {
        try {
            $data = $rawResult->getData();
            $headers = $rawResult instanceof RawHttpResult ? $rawResult->getObject()->getHeaders(false) : [];
        } catch (\Throwable $exception) {
            throw new DecisionProviderException('OpenAI Decisions lieferte kein gültiges Antwortformat.', retryable: true, previous: $exception);
        }
        if (!isset($data['answers']) || !is_array($data['answers'])) {
            throw new DecisionProviderException('OpenAI Decisions lieferte kein gültiges Antwortformat.', retryable: false);
        }

        $result = new ObjectResult($data);
        if ($rawResult instanceof RawHttpResult) {
            $requestId = $headers['x-request-id'][0] ?? null;
            $providerModel = $data['model'] ?? null;
            $usage = $data['usage']['input_tokens'] ?? null;
            $result->getMetadata()->set([
                'request_id' => is_string($requestId) ? $requestId : null,
                'model' => is_string($providerModel) ? $providerModel : null,
                'input_tokens' => is_int($usage) ? $usage : null,
            ]);
        }

        return $result;
    }

    public function getTokenUsageExtractor(): ?TokenUsageExtractorInterface
    {
        return null;
    }
}
