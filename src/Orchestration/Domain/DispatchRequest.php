<?php

declare(strict_types=1);

namespace App\Orchestration\Domain;

use App\Shared\Domain\CanonicalData;

/** The immutable T3 request persisted before any external launch is attempted. */
final readonly class DispatchRequest
{
    /** @param array<string, mixed> $payload */
    private function __construct(public array $payload)
    {
    }

    /** @param array<string, mixed> $payload */
    public static function fromPayload(array $payload): self
    {
        foreach (['projectId', 'title', 'message', 'clientRequestId'] as $field) {
            if (!is_string($payload[$field] ?? null) || '' === trim((string) $payload[$field])) {
                throw new \InvalidArgumentException(sprintf('Dispatch field "%s" must be a non-empty string.', $field));
            }
        }

        if (isset($payload['modelSelection'])) {
            $selection = $payload['modelSelection'];
            if (!is_array($selection) || !is_string($selection['instanceId'] ?? null) || !is_string($selection['model'] ?? null)) {
                throw new \InvalidArgumentException('A reference-thread dispatch needs its resolved T3 routing values.');
            }
        }

        return new self($payload);
    }

    /** Hash the canonical payload without changing list order or omitting nulls. */
    public function sha256(): string
    {
        try {
            return hash('sha256', json_encode(CanonicalData::sorted($this->payload), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        } catch (\JsonException $exception) {
            throw new \InvalidArgumentException('The dispatch payload is not JSON serializable.', previous: $exception);
        }
    }
}
