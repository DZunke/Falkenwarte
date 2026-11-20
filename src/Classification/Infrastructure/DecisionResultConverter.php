<?php

declare(strict_types=1);

namespace App\Classification\Infrastructure;

use App\Classification\Application\DecisionProviderException;
use Symfony\AI\Platform\Model;
use Symfony\AI\Platform\Result\ObjectResult;
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
