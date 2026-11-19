<?php
use App\Access\Application\AccessPersistence;
use App\Access\Infrastructure\DbalAccessPersistence;
use App\Access\Presentation\Access;
use App\Classification\Application\{DecisionGateway,IntakeHandler};
use App\Classification\Infrastructure\{OpenAiDecisionsPlatform,SymfonyAiDecisionAdapter};
use App\Extensions\Application\{ExtensionPersistence,PluginHandler};
use App\Extensions\Infrastructure\DbalExtensionPersistence;
use App\Live\Infrastructure\Live;
use App\Metrics\Application\MetricsHandler;
use App\Operations\Application\{BackupHandler,JournalHandler,MigrationVersionReader,OperationsPersistence};
use App\Operations\Infrastructure\{DbalMigrationVersionReader,DbalOperationsPersistence};
use App\Operations\Presentation\RestoreFinalizeCommand;
use App\Orchestration\Application\RunHandler;
use App\Portfolio\Application\PortfolioHandler;
use App\Presentation\{Contract,Gateway,HttpEndpoint,McpEndpoint};
use App\Shared\Application\Store;
use App\Shared\Application\IdempotencyStore;
use App\Shared\Infrastructure\{Consumer,DbalIdempotencyStore,MaintenanceCommand};
use App\WorkManagement\Application\{TaskIntake,WorkHandler};
use App\WorkManagement\Domain\{BoardWipPolicy,TaskCompletionPolicy,TaskLinkPolicy};
use Symfony\AI\Platform\PlatformInterface;
use Symfony\Component\DependencyInjection\Loader\Configurator\{ContainerConfigurator};
use function Symfony\Component\DependencyInjection\Loader\Configurator\{service,tagged_iterator};

return static function(ContainerConfigurator $c):void {
    $s=$c->services()->defaults()->autowire()->autoconfigure();
    $s->set(App\Shared\Infrastructure\DbalStore::class);
    $s->alias(Store::class,App\Shared\Infrastructure\DbalStore::class);
    $s->alias(App\Shared\Infrastructure\DbalStoreAccess::class,App\Shared\Infrastructure\DbalStore::class);
    $s->set(DbalIdempotencyStore::class);
    $s->alias(IdempotencyStore::class,DbalIdempotencyStore::class);
    $s->set(DbalOperationsPersistence::class);
    $s->alias(OperationsPersistence::class,DbalOperationsPersistence::class);
    $s->set(DbalMigrationVersionReader::class);
    $s->alias(MigrationVersionReader::class,DbalMigrationVersionReader::class);
    $s->set(DbalExtensionPersistence::class);
    $s->alias(ExtensionPersistence::class,DbalExtensionPersistence::class);
    $s->set(DbalAccessPersistence::class);
    $s->alias(AccessPersistence::class,DbalAccessPersistence::class);
    $s->set(Contract::class)->arg('$root','%kernel.project_dir%');
    $s->set(Gateway::class)->arg('$handlers',tagged_iterator('app.operation_handler'));
    $s->set(App\Orchestration\Infrastructure\T3McpBridge::class);
    $s->set(App\Orchestration\Infrastructure\T3OAuthAuthenticator::class);
    $s->alias(App\Orchestration\Application\AgentExecutionBridge::class,App\Orchestration\Infrastructure\T3McpBridge::class);
    $s->alias(App\Orchestration\Application\T3OAuthClient::class,App\Orchestration\Infrastructure\T3OAuthAuthenticator::class);
    $s->set(OpenAiDecisionsPlatform::class);
    $s->alias(PlatformInterface::class,OpenAiDecisionsPlatform::class);
    $s->set(SymfonyAiDecisionAdapter::class);
    $s->alias(DecisionGateway::class,SymfonyAiDecisionAdapter::class);
    $s->alias(TaskIntake::class,IntakeHandler::class);
    foreach ([BoardWipPolicy::class,TaskCompletionPolicy::class,TaskLinkPolicy::class] as $policy) { $s->set($policy); }
    $types=[Access::class,Live::class,PortfolioHandler::class,WorkHandler::class,IntakeHandler::class,RunHandler::class,PluginHandler::class,MetricsHandler::class,JournalHandler::class,BackupHandler::class];
    foreach ($types as $class) { $s->set($class)->tag('app.operation_handler'); }
    $workers=[];
    foreach (['intake'=>IntakeHandler::class,'connection'=>RunHandler::class,'recovery'=>RunHandler::class,'run'=>RunHandler::class,'workflow'=>RunHandler::class,'plugin'=>PluginHandler::class,'metrics'=>MetricsHandler::class,'export'=>JournalHandler::class,'backup'=>BackupHandler::class,'restore'=>BackupHandler::class] as $prefix=>$class) { $workers[$prefix]=service($class); }
    $s->set(Consumer::class)->arg('$workers',$workers);
    foreach ([MaintenanceCommand::class,RestoreFinalizeCommand::class,McpEndpoint::class] as $service) { $s->set($service); }
    $s->set(HttpEndpoint::class)->public()->tag('controller.service_arguments');
};
