<?php

use App\Access\Application\AccessPersistence;
use App\Access\Infrastructure\DbalAccessPersistence;
use App\Access\Presentation\Access;
use App\AgentCatalog\Application\AgentCatalogHandler;
use App\AgentCatalog\Application\AgentCatalogMcpClient;
use App\AgentCatalog\Application\AgentCatalogOAuthClient;
use App\AgentCatalog\Application\AgentCatalogReader;
use App\AgentCatalog\Application\RunImpactPort;
use App\AgentCatalog\Domain\AgentProfileRules;
use App\AgentCatalog\Domain\ProjectBindingRules;
use App\AgentCatalog\Domain\T3ConnectionRules;
use App\AgentCatalog\Infrastructure\StoreAgentCatalogReader;
use App\Automation\Application\WorkflowPolicy;
use App\Automation\Application\WorkflowPolicyService;
use App\Automation\Domain\WorkflowDefinitionPolicy;
use App\Automation\Domain\WorkflowTransitionPolicy;
use App\Classification\Application\DecisionGateway;
use App\Classification\Application\IntakeHandler;
use App\Classification\Infrastructure\OpenAiDecisionsPlatform;
use App\Classification\Infrastructure\SymfonyAiDecisionAdapter;
use App\Extensions\Application\ExtensionPersistence;
use App\Extensions\Application\PluginEventDispatcher;
use App\Extensions\Application\PluginHandler;
use App\Extensions\Application\PluginManifestReader;
use App\Extensions\Application\PluginRegistry;
use App\Extensions\Infrastructure\DbalExtensionPersistence;
use App\Extensions\Infrastructure\RegisteredPluginEventDispatcher;
use App\Live\Infrastructure\Live;
use App\Metrics\Application\MetricsHandler;
use App\Operations\Application\BackupHandler;
use App\Operations\Application\JournalHandler;
use App\Operations\Application\MigrationVersionReader;
use App\Operations\Application\OperationsPersistence;
use App\Operations\Infrastructure\DbalMigrationVersionReader;
use App\Operations\Infrastructure\DbalOperationsPersistence;
use App\Operations\Presentation\RestoreFinalizeCommand;
use App\Orchestration\Application\RunHandler;
use App\Orchestration\Domain\RunCompletionEvaluator;
use App\Orchestration\Domain\RunDelegationPolicy;
use App\Orchestration\Infrastructure\AgentCatalogRunImpactAdapter;
use App\Orchestration\Infrastructure\ProviderRunDrainAdapter;
use App\Portfolio\Application\PortfolioHandler;
use App\Presentation\Contract;
use App\Presentation\Gateway;
use App\Presentation\HttpEndpoint;
use App\Presentation\McpEndpoint;
use App\Shared\Application\Clock;
use App\Shared\Application\IdempotencyStore;
use App\Shared\Application\Store;
use App\Shared\Infrastructure\Consumer;
use App\Shared\Infrastructure\DbalIdempotencyStore;
use App\Shared\Infrastructure\MaintenanceCommand;
use App\Shared\Infrastructure\SystemClock;
use App\WorkManagement\Application\AttentionLabelReader;
use App\WorkManagement\Application\TaskIntake;
use App\WorkManagement\Application\WorkHandler;
use App\WorkManagement\Domain\BoardWipPolicy;
use App\WorkManagement\Domain\TaskCompletionPolicy;
use App\WorkManagement\Domain\TaskLinkPolicy;
use Falkenwarte\LinkNotes\Application\LinkNoteRepository;
use Falkenwarte\LinkNotes\Infrastructure\DbalLinkNoteRepository;
use Symfony\AI\Platform\PlatformInterface;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

use function Symfony\Component\DependencyInjection\Loader\Configurator\service;
use function Symfony\Component\DependencyInjection\Loader\Configurator\tagged_iterator;

return static function (ContainerConfigurator $c): void {
    $version = trim((string) file_get_contents(dirname(__DIR__).'/version.txt'));
    if ('' === $version) {
        throw new RuntimeException('Die Anwendungsversion fehlt in version.txt.');
    }
    $s = $c->services()->defaults()->autowire()->autoconfigure()->bind('string $appVersion', $version);
    $s->set(App\Shared\Infrastructure\DbalStore::class);
    $s->set(SystemClock::class);
    $s->alias(Clock::class, SystemClock::class);
    $s->alias(Store::class, App\Shared\Infrastructure\DbalStore::class);
    $s->alias(App\Shared\Infrastructure\DbalStoreAccess::class, App\Shared\Infrastructure\DbalStore::class);
    $s->set(DbalIdempotencyStore::class);
    $s->alias(IdempotencyStore::class, DbalIdempotencyStore::class);
    $s->set(DbalOperationsPersistence::class);
    $s->alias(OperationsPersistence::class, DbalOperationsPersistence::class);
    $s->set(DbalMigrationVersionReader::class);
    $s->alias(MigrationVersionReader::class, DbalMigrationVersionReader::class);
    $s->set(DbalExtensionPersistence::class);
    $s->alias(ExtensionPersistence::class, DbalExtensionPersistence::class);
    $s->set(PluginRegistry::class)->arg('$definitions', tagged_iterator('app.plugin_definition'));
    $s->alias(PluginManifestReader::class, PluginRegistry::class);
    $s->alias(App\Extensions\Application\PluginAvailability::class, PluginRegistry::class);
    $s->set(Falkenwarte\LinkNotes\PluginDefinition::class)->tag('app.plugin_definition');
    $s->set(App\Orchestration\Plugins\T3BridgePluginDefinition::class)->tag('app.plugin_definition');
    $s->set(DbalLinkNoteRepository::class);
    $s->alias(LinkNoteRepository::class, DbalLinkNoteRepository::class);
    $s->set(Falkenwarte\LinkNotes\Subscribers\LinkRegisteredSubscriber::class)->tag('app.plugin_event_subscriber');
    $s->set(RegisteredPluginEventDispatcher::class)->arg('$subscribers', tagged_iterator('app.plugin_event_subscriber'));
    $s->alias(PluginEventDispatcher::class, RegisteredPluginEventDispatcher::class);
    $s->set(DbalAccessPersistence::class);
    $s->alias(AccessPersistence::class, DbalAccessPersistence::class);
    $s->set(Contract::class)->arg('$root', '%kernel.project_dir%');
    $s->set(Gateway::class)->arg('$handlers', tagged_iterator('app.operation_handler'));
    $s->set(App\Orchestration\Infrastructure\T3McpBridge::class);
    $s->set(App\Orchestration\Infrastructure\T3OAuthAuthenticator::class);
    $s->alias(App\Orchestration\Application\AgentExecutionBridge::class, App\Orchestration\Infrastructure\T3McpBridge::class);
    $s->alias(App\Orchestration\Application\T3OAuthClient::class, App\Orchestration\Infrastructure\T3OAuthAuthenticator::class);
    $s->alias(AgentCatalogMcpClient::class, App\Orchestration\Infrastructure\T3McpBridge::class);
    $s->alias(AgentCatalogOAuthClient::class, App\Orchestration\Infrastructure\T3OAuthAuthenticator::class);
    $s->set(StoreAgentCatalogReader::class);
    $s->alias(AgentCatalogReader::class, StoreAgentCatalogReader::class);
    $s->set(AgentCatalogRunImpactAdapter::class);
    $s->alias(RunImpactPort::class, AgentCatalogRunImpactAdapter::class);
    $s->set(ProviderRunDrainAdapter::class);
    $s->alias(App\Extensions\Application\ProviderRunDrainPort::class, ProviderRunDrainAdapter::class);
    $s->set(AgentCatalogHandler::class);
    foreach ([T3ConnectionRules::class, AgentProfileRules::class, ProjectBindingRules::class] as $policy) {
        $s->set($policy);
    }
    $s->set(WorkflowPolicyService::class);
    $s->alias(WorkflowPolicy::class, WorkflowPolicyService::class);
    foreach ([WorkflowDefinitionPolicy::class, WorkflowTransitionPolicy::class, RunCompletionEvaluator::class, RunDelegationPolicy::class] as $policy) {
        $s->set($policy);
    }
    $s->set(OpenAiDecisionsPlatform::class);
    $s->alias(PlatformInterface::class, OpenAiDecisionsPlatform::class);
    $s->set(SymfonyAiDecisionAdapter::class);
    $s->alias(DecisionGateway::class, SymfonyAiDecisionAdapter::class);
    $s->alias(TaskIntake::class, IntakeHandler::class);
    foreach ([App\Portfolio\Domain\CustomFieldPolicy::class, BoardWipPolicy::class, TaskCompletionPolicy::class, TaskLinkPolicy::class] as $policy) {
        $s->set($policy);
    }
    $s->alias(AttentionLabelReader::class, WorkHandler::class);
    $types = [Access::class, Live::class, PortfolioHandler::class, WorkHandler::class, IntakeHandler::class, AgentCatalogHandler::class, RunHandler::class, PluginHandler::class, MetricsHandler::class, JournalHandler::class, BackupHandler::class];
    foreach ($types as $class) {
        $s->set($class)->tag('app.operation_handler');
    }
    $workers = [];
    foreach (['intake' => IntakeHandler::class, 'connection' => AgentCatalogHandler::class, 'recovery' => RunHandler::class, 'run' => RunHandler::class, 'workflow' => RunHandler::class, 'plugin' => PluginHandler::class, 'metrics' => MetricsHandler::class, 'export' => JournalHandler::class, 'backup' => BackupHandler::class, 'restore' => BackupHandler::class] as $prefix => $class) {
        $workers[$prefix] = service($class);
    }
    $s->set(Consumer::class)->arg('$workers', $workers);
    foreach ([MaintenanceCommand::class, RestoreFinalizeCommand::class, McpEndpoint::class] as $service) {
        $s->set($service);
    }
    $s->set(HttpEndpoint::class)->public()->tag('controller.service_arguments');
};
