<?php

use App\Shared\Application\Clock;
use App\Shared\Infrastructure\FileClock;
use App\Shared\Infrastructure\SystemClock;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

use function Symfony\Component\DependencyInjection\Loader\Configurator\service;

return static function (ContainerConfigurator $c): void {
    $services = $c->services();
    $services->set(FileClock::class)->arg('$systemClock', service(SystemClock::class));
    $services->alias(Clock::class, FileClock::class);
};
