<?php

use App\Shared\Application\Clock;
use App\Shared\Infrastructure\FileClock;
use App\Shared\Infrastructure\SystemClock;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

use function Symfony\Component\DependencyInjection\Loader\Configurator\service;

require_once dirname(__DIR__).'/tests/Fixtures/Plugins/QaBridgeDependentDefinition.php';

return static function (ContainerConfigurator $c): void {
    $services = $c->services();
    $services->set(FileClock::class)->arg('$systemClock', service(SystemClock::class));
    $services->alias(Clock::class, FileClock::class);
    $services->set(App\Tests\Fixtures\Plugins\QaBridgeDependentDefinition::class)
        ->file('%kernel.project_dir%/tests/Fixtures/Plugins/QaBridgeDependentDefinition.php')
        ->tag('app.plugin_definition');
};
