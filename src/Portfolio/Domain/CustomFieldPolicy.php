<?php

declare(strict_types=1);

namespace App\Portfolio\Domain;

use App\Shared\Domain\Problem;

final class CustomFieldPolicy
{
    /** @param array<string, mixed> $field @param array<string, mixed> $body @param list<array<string, mixed>> $tasks */
    public function assertUpdateAllowed(array $field, array $body, array $tasks): void
    {
        if (isset($body['key']) && $body['key'] !== $field['key']) {
            throw new Problem(409, 'custom_field_key_immutable', 'Der Schlüssel eines Zusatzfelds bleibt nach der Anlage unverändert.');
        }

        $key = $field['key'];
        $hasValues = false;
        foreach ($tasks as $task) {
            $values = $task['custom_fields'] ?? [];
            if (!is_array($values) || !array_key_exists($key, $values)) {
                continue;
            }
            $hasValues = true;
            if ($field['value_type'] === ($body['value_type'] ?? $field['value_type'])
                && in_array($field['value_type'], ['choice', 'multi_choice'], true)
                && isset($body['choices'])
            ) {
                $removedChoices = array_diff($field['choices'] ?? [], $body['choices']);
                $typedValue = $values[$key];
                $value = is_array($typedValue) ? ($typedValue['value'] ?? null) : null;
                $removedValueInUse = 'choice' === $field['value_type']
                    ? is_string($value) && in_array($value, $removedChoices, true)
                    : is_array($value) && [] !== array_intersect($value, $removedChoices);
                if ($removedValueInUse) {
                    throw new Problem(409, 'custom_field_choice_in_use', 'Ein verwendeter Zusatzfeldwert kann nicht aus der Auswahl entfernt werden.');
                }
            }
        }

        if ($hasValues && $field['value_type'] !== ($body['value_type'] ?? $field['value_type'])) {
            throw new Problem(409, 'custom_field_type_in_use', 'Der Feldtyp kann nicht geändert werden, solange Ticketwerte bestehen.');
        }

        if (empty($field['required']) && !empty($body['required'])) {
            foreach ($tasks as $task) {
                $values = $task['custom_fields'] ?? [];
                if (!is_array($values) || !array_key_exists($key, $values)) {
                    throw new Problem(409, 'custom_field_required_incomplete', 'Das Zusatzfeld kann erst verpflichtend werden, wenn alle bestehenden Tickets einen Wert enthalten.');
                }
            }
        }
    }
}
