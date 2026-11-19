<?php

declare(strict_types=1);

namespace App\Shared\Domain;

/** Stable map order for fingerprints. List order is part of the payload. */
final class CanonicalData
{
    public static function sorted(array $value): array
    {
        if (!array_is_list($value)) {
            ksort($value);
        }
        foreach ($value as $key => $item) {
            if (is_array($item)) {
                $value[$key] = self::sorted($item);
            }
        }

        return $value;
    }
}
