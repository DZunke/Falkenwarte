<?php
declare(strict_types=1);
namespace App\Shared\Domain;

final class Problem extends \RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $problemCode, string $message, public readonly array $extra = [])
    {
        parent::__construct($message);
    }

    public function details(): array
    {
        return ['type' => 'urn:falkenwarte:problem:'.$this->problemCode, 'title' => $this->getMessage(), 'detail' => $this->getMessage(), 'status' => $this->status, 'code' => $this->problemCode, 'trace_id' => bin2hex(random_bytes(10))] + $this->extra;
    }
}
