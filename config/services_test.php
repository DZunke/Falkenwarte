<?php

use App\Shared\Application\Clock;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

require_once dirname(__DIR__).'/tests/Fixtures/Plugins/QaBridgeDependentDefinition.php';

return static function (ContainerConfigurator $c): void {
    $services = $c->services();
    $services->alias(Clock::class, App\Shared\Infrastructure\FileClock::class);
    $services->set(App\Tests\Fixtures\Plugins\QaBridgeDependentDefinition::class)
        ->file('%kernel.project_dir%/tests/Fixtures/Plugins/QaBridgeDependentDefinition.php')
        ->tag('app.plugin_definition');
};
