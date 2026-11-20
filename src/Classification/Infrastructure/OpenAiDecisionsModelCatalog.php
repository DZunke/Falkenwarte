<?php

declare(strict_types=1);

namespace App\Classification\Infrastructure;

use Symfony\AI\Platform\Model;
use Symfony\AI\Platform\ModelCatalog\ModelCatalogInterface;

final readonly class OpenAiDecisionsModelCatalog implements ModelCatalogInterface
{
    public function getModel(string $modelName): Model
    {
        if ('gpt-6-luna' !== $modelName) {
            throw new \InvalidArgumentException('Unbekanntes Decisions-Modell.');
        }

        return new Model($modelName);
    }

    public function getModels(): array
    {
        return ['gpt-6-luna' => ['class' => Model::class, 'capabilities' => []]];
    }
}
