<?php

use App\Presentation\HttpEndpoint;
use App\Presentation\OpenApiRouteLoader;
use Symfony\Component\Routing\Loader\Configurator\RoutingConfigurator;

return static function (RoutingConfigurator $routes): void {
    $routes->import(OpenApiRouteLoader::class, 'service');
    $routes->import('.', 'mcp');
    $routes->add('readiness', '/healthz')->controller([HttpEndpoint::class, 'health'])->methods(['GET']);
    $routes->add('app', '/')->controller([HttpEndpoint::class, 'shell'])->methods(['GET']);
};
