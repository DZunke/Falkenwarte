<?php

declare(strict_types=1);

namespace App\Presentation;

use Symfony\Bundle\FrameworkBundle\Routing\RouteLoaderInterface;
use Symfony\Component\Config\Resource\FileResource;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

final readonly class OpenApiRouteLoader implements RouteLoaderInterface
{
    public function __construct(private Contract $contract)
    {
    }

    public function __invoke(): RouteCollection
    {
        $routes = new RouteCollection();
        $routes->addResource(new FileResource($this->contract->openApiFile()));

        foreach ($this->contract->operations() as $name => $operation) {
            $prefix = '/' === ($operation['servers'][0]['url'] ?? '') ? '' : '/api/v1';
            $routes->add($name, new Route(
                $prefix.$operation['path'],
                defaults: ['_controller' => [HttpEndpoint::class, 'handle']],
                methods: [$operation['method']],
            ));
        }

        return $routes;
    }
}
