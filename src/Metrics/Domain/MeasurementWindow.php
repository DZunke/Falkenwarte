<?php

declare(strict_types=1);

namespace App\Metrics\Domain;

use App\Shared\Domain\Problem;

/** UTC measurement range with an inclusive start and exclusive end. */
final readonly class MeasurementWindow
{
    public \DateTimeImmutable $from;
    public \DateTimeImmutable $to;

    public function __construct(\DateTimeImmutable $from, \DateTimeImmutable $to)
    {
        $utc = new \DateTimeZone('UTC');
        $this->from = $from->setTimezone($utc);
        $this->to = $to->setTimezone($utc);
        if ($this->from >= $this->to || $this->from->add(new \DateInterval('P366D')) < $this->to) {
            throw new Problem(422, 'validation_failed', 'Der Zeitraum muss positiv sein und darf höchstens 366 Tage umfassen.');
        }
    }

    public static function fromQuery(array $query, \DateTimeImmutable $now): self
    {
        try {
            $to = isset($query['to']) ? new \DateTimeImmutable($query['to']) : $now;
            $from = isset($query['from']) ? new \DateTimeImmutable($query['from']) : $to->sub(new \DateInterval('P30D'));
        } catch (\Exception) {
            throw new Problem(422, 'validation_failed', 'Für Beginn und Ende einen gültigen Zeitpunkt angeben.');
        }

        return new self($from, $to);
    }

    public function contains(?\DateTimeImmutable $date): bool
    {
        return null !== $date && $this->from <= $date && $date < $this->to;
    }

    /** @return \Generator<int,self> UTC calendar buckets clipped to the requested boundaries. */
    public function buckets(string $grain): \Generator
    {
        for ($start = $this->from; $start < $this->to; $start = $end) {
            $boundary = match ($grain) {
                'day' => $start->modify('tomorrow midnight'),
                'week' => $start->modify('next monday midnight'),
                'month' => $start->modify('first day of next month midnight'),
                'total' => $this->to,
                default => throw new Problem(422, 'validation_failed', 'Die zeitliche Auflösung ist unbekannt.'),
            };
            $end = min($boundary, $this->to);
            yield new self($start, $end);
        }
    }
}
