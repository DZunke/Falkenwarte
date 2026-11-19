<?php
use App\Presentation\{HttpEndpoint,Contract};
use Symfony\Component\Routing\Loader\Configurator\RoutingConfigurator;

return static function(RoutingConfigurator $routes):void {
    foreach ((new Contract(dirname(__DIR__)))->operations() as $name=>$op) {
        $path=(($op['servers'][0]['url'] ?? '')==='/'?'':'/api/v1').$op['path'];
        $routes->add($name,$path)->controller([HttpEndpoint::class,'handle'])->methods([$op['method']]);
    }
    $routes->add('mcp','/mcp')->controller([HttpEndpoint::class,'handle'])->methods(['POST','DELETE','GET']);
    $routes->add('readiness','/healthz')->controller([HttpEndpoint::class,'health'])->methods(['GET']);
    $routes->add('app','/')->controller([HttpEndpoint::class,'shell'])->methods(['GET']);
};
