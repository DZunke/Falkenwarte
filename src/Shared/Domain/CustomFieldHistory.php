<?php

declare(strict_types=1);

namespace App\Shared\Domain;

final class CustomFieldHistory
{
    public static function publicFields(array $fields): array
    {
        return array_filter($fields, static fn ($key): bool => is_string($key)
            && !str_starts_with($key, '_')
            && !preg_match('/(?:^|[._-])(?:secrets?|password|token|credentials?|api[._-]?key|private[._-]?key|code[._-]?verifier)(?:$|[._-])/i', $key), ARRAY_FILTER_USE_KEY);
    }

    public static function snapshot(array $fields, array $labels = []): array
    {
        $result = [];
        foreach (self::publicFields($fields) as $key => $field) {
            $value = $field['value'] ?? null;
            $item = match ($field['type'] ?? null) {
                'text', 'choice', 'date' => is_string($value) ? ['type' => 'text', 'value' => mb_substr($value, 0, 20000)] : null,
                'number' => is_int($value) || is_float($value) ? ['type' => 'number', 'value' => $value] : null,
                'boolean' => is_bool($value) ? ['type' => 'boolean', 'value' => $value] : null,
                'multi_choice' => is_array($value) && array_is_list($value) && array_all($value, is_string(...))
                    ? ['type' => 'text_list', 'value' => array_map(static fn (string $choice): string => mb_substr($choice, 0, 2000), array_slice($value, 0, 200))] : null,
                default => null,
            };
            if (null !== $item) {
                $result[] = ['key' => $key, 'label' => $labels[$key] ?? $key, 'value' => $item];
            }
        }

        return $result;
    }
}
