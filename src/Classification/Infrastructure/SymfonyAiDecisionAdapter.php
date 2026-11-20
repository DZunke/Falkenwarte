<?php

declare(strict_types=1);

namespace App\Classification\Infrastructure;

use App\Classification\Application\DecisionGateway;
use App\Classification\Application\DecisionProviderException;
use Symfony\AI\Platform\PlatformInterface;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Keeps application handlers on the DecisionGateway port and invokes the named Decisions platform.
 */
#[AsAlias(DecisionGateway::class)]
final readonly class SymfonyAiDecisionAdapter implements DecisionGateway
{
    public function __construct(#[Autowire(service: 'ai.platform.openai.decisions')] private PlatformInterface $platform)
    {
    }

    /** @param array<string, mixed> $request @return array<string, mixed> */
    public function decide(array $request, string $secretReferenceId, int $timeoutMs): array
    {
        $input = $request['input'] ?? null;
        $questions = $request['questions'] ?? null;
        if (!is_array($input) || !is_array($questions)) {
            throw new DecisionProviderException('Die Decisions-Anfrage ist unvollständig.', retryable: false);
        }

        $result = $this->platform->invoke('gpt-6-luna', $input, [
            'questions' => $questions,
            'secret_reference_id' => $secretReferenceId,
            'timeout_ms' => $timeoutMs,
        ]);

        $content = $result->asObject();
        if (is_object($content)) {
            $content = get_object_vars($content);
        }

        $metadata = $result->getMetadata()->all();
        $content['_provider_metadata'] = [
            'request_id' => is_string($metadata['request_id'] ?? null) ? $metadata['request_id'] : null,
            'model' => is_string($metadata['model'] ?? null) ? $metadata['model'] : null,
            'input_tokens' => is_int($metadata['input_tokens'] ?? null) ? $metadata['input_tokens'] : null,
        ];

        return $content;
    }
}
