<?php

use App\Automation\Application\WorkflowPolicy;
use App\Automation\Application\WorkflowPolicyService;
use App\Extensions\Application\PluginAvailability;
use App\Extensions\Application\PluginDefinition;
use App\Extensions\Application\PluginEventSubscriber;
use App\Extensions\Application\PluginManifestReader;
use App\Extensions\Application\PluginRegistry;
use App\Shared\Application\OperationHandler;
use App\WorkManagement\Application\TaskIntake;
use Falkenwarte\LinkNotes\Application\LinkNoteRepository;
use Falkenwarte\LinkNotes\Infrastructure\DbalLinkNoteRepository;
use Falkenwarte\LinkNotes\PluginDefinition as LinkNotesPluginDefinition;
use Falkenwarte\LinkNotes\Subscribers\LinkRegisteredSubscriber;
use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\Security\Csrf\TokenGenerator\TokenGeneratorInterface;
use Symfony\Component\Security\Csrf\TokenGenerator\UriSafeTokenGenerator;

return static function (ContainerConfigurator $container): void {
    $version = trim((string) file_get_contents(dirname(__DIR__).'/version.txt'));
    if ('' === $version) {
        throw new RuntimeException('Die Anwendungsversion fehlt in version.txt.');
    }

    $services = $container->services()
        ->defaults()
        ->autowire()
        ->autoconfigure()
        ->bind('$appVersion', $version)
        ->bind('$allowTestHttpEndpoint', '%falkenwarte.test_mode%')
        ->bind('$publicOrigin', '%falkenwarte.public_url%')
        ->bind('$dataDirectory', '%falkenwarte.data_dir%')
        ->bind('$databasePath', '%falkenwarte.database_path%')
        ->bind('$backupDirectory', '%falkenwarte.backup_dir%')
        ->bind('$backupMaxBytes', '%falkenwarte.backup_max_bytes%');

    $services->instanceof(OperationHandler::class)->tag('app.operation_handler');
    $services->instanceof(PluginDefinition::class)->tag('app.plugin_definition');
    $services->instanceof(PluginEventSubscriber::class)->tag('app.plugin_event_subscriber');

    $sourceDirectory = dirname(__DIR__).'/src';
    $services->load('App\\', $sourceDirectory.'/')->exclude([
        $sourceDirectory.'/Kernel.php',
        $sourceDirectory.'/Access/Domain/TechnicalCredential.php',
        $sourceDirectory.'/Access/Infrastructure/McpPrincipal.php',
        $sourceDirectory.'/Access/Infrastructure/McpProblemAuthenticationException.php',
        $sourceDirectory.'/AgentCatalog/Application/T3ConnectionException.php',
        $sourceDirectory.'/Automation/Domain/WorkflowDefinitionViolation.php',
        $sourceDirectory.'/Classification/Application/DecisionProviderException.php',
        $sourceDirectory.'/Metrics/Domain/MeasurementWindow.php',
        $sourceDirectory.'/Operations/Infrastructure/OfflineRestoreAbort.php',
        $sourceDirectory.'/Orchestration/Application/T3BridgeException.php',
        $sourceDirectory.'/Orchestration/Domain/DispatchRequest.php',
        $sourceDirectory.'/Orchestration/Domain/RunCompletionDecision.php',
        $sourceDirectory.'/Orchestration/Domain/RunDelegationViolation.php',
        $sourceDirectory.'/Portfolio/Domain/ProjectSlug.php',
        $sourceDirectory.'/Presentation/McpTool.php',
        $sourceDirectory.'/Shared/Application/Actor.php',
        $sourceDirectory.'/Shared/Domain/Problem.php',
        $sourceDirectory.'/Shared/Infrastructure/Job.php',
    ]);

    $services->alias(PluginManifestReader::class, PluginRegistry::class);
    $services->alias(PluginAvailability::class, PluginRegistry::class);
    $services->alias(LinkNoteRepository::class, DbalLinkNoteRepository::class);
    $services->alias(WorkflowPolicy::class, WorkflowPolicyService::class);
    $services->alias(TaskIntake::class, App\Classification\Application\IntakeHandler::class);
    $services->alias(TokenGeneratorInterface::class, UriSafeTokenGenerator::class);

    $services->set(LinkNotesPluginDefinition::class);
    $services->set(DbalLinkNoteRepository::class);
    $services->set(LinkRegisteredSubscriber::class);
    $services->set(Validator::class);
    $services->set(ErrorFormatter::class);
    $services->set(UriSafeTokenGenerator::class);
};
