<?php

declare(strict_types=1);

use PhpParser\Node;
use PhpParser\Node\Expr\FuncCall;
use PhpParser\Node\Expr\New_;
use PhpParser\Node\Expr\StaticCall;
use PhpParser\Node\Expr\Variable;
use PhpParser\Node\Name;
use PhpParser\Node\Stmt\Class_;
use PhpParser\NodeFinder;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\ParserFactory;

$root = dirname(__DIR__);
require $root.'/vendor/autoload.php';
$errors = [];
$markerTags = [
    App\Shared\Application\OperationHandler::class => 'app.operation_handler',
    App\Extensions\Application\PluginDefinition::class => 'app.plugin_definition',
    App\Extensions\Application\PluginEventSubscriber::class => 'app.plugin_event_subscriber',
];
$expectedTaggedClasses = array_fill_keys(array_values($markerTags), []);
$parser = (new ParserFactory())->createForNewestSupportedVersion();

$inspectProductSource = static function (string $relative, string $source) use ($parser, $markerTags, &$expectedTaggedClasses, &$errors): void {
    try {
        $ast = $parser->parse($source) ?? [];
    } catch (PhpParser\Error $exception) {
        $errors[] = sprintf('%s could not be parsed: %s', $relative, $exception->getMessage());

        return;
    }

    $traverser = new NodeTraverser();
    $traverser->addVisitor(new NameResolver());
    $ast = $traverser->traverse($ast);
    $finder = new NodeFinder();
    $nodes = $finder->find($ast, static fn (Node $node): bool => true);
    foreach ($nodes as $node) {
        if ($node instanceof Variable && is_string($node->name) && in_array($node->name, ['_ENV', '_SERVER'], true)) {
            $errors[] = sprintf('%s:%d reads environment state directly; inject Symfony configuration instead.', $relative, $node->getStartLine());
        }

        if ($node instanceof FuncCall && $node->name instanceof Name) {
            $resolved = $node->name->getAttribute('resolvedName');
            $function = strtolower(ltrim(($resolved instanceof Name ? $resolved : $node->name)->toString(), '\\'));
            if (in_array($function, ['getenv', 'putenv'], true)) {
                $errors[] = sprintf('%s:%d reads or writes environment state directly; inject Symfony configuration instead.', $relative, $node->getStartLine());
            }
        }

        if (($node instanceof New_ || $node instanceof StaticCall) && $node->class instanceof Name) {
            $resolved = $node->class->getAttribute('resolvedName');
            $class = ltrim(($resolved instanceof Name ? $resolved : $node->class)->toString(), '\\');
            $separator = strrpos($class, '\\');
            $shortName = false === $separator ? $class : substr($class, $separator + 1);
            if (str_starts_with($class, 'Symfony\\Component\\HttpClient\\')
                && str_ends_with($shortName, 'HttpClient')
                && ($node instanceof New_ || ($node->name instanceof Node\Identifier && str_starts_with(strtolower($node->name->toString()), 'create')))) {
                $errors[] = sprintf('%s:%d constructs an HTTP client directly; inject a configured Symfony HTTP client.', $relative, $node->getStartLine());
            }
        }

        if ($node instanceof Class_ && null !== $node->name && !$node->isAbstract()) {
            foreach ($node->implements as $interface) {
                $resolved = $interface->getAttribute('resolvedName');
                $interfaceName = $resolved instanceof Name ? $resolved->toString() : $interface->toString();
                if (isset($markerTags[$interfaceName])) {
                    $class = $node->namespacedName;
                    if ($class instanceof Name) {
                        $expectedTaggedClasses[$markerTags[$interfaceName]][$class->toString()] = true;
                    }
                }
            }
        }
    }
};

$composer = json_decode((string) file_get_contents($root.'/composer.json'), true, 512, JSON_THROW_ON_ERROR);
$locked = is_file($root.'/composer.lock') ? json_decode((string) file_get_contents($root.'/composer.lock'), true, 512, JSON_THROW_ON_ERROR) : [];

if (isset($composer['require']['doctrine/orm']) || isset($composer['require']['symfony/orm-pack'])) {
    $errors[] = 'Doctrine ORM must not be a runtime dependency.';
}
foreach (array_merge($locked['packages'] ?? [], $locked['packages-dev'] ?? []) as $package) {
    if (in_array($package['name'] ?? '', ['doctrine/orm', 'symfony/orm-pack'], true)) {
        $errors[] = sprintf('Forbidden ORM package %s is present in composer.lock.', $package['name']);
    }
}

$storePort = (string) file_get_contents($root.'/src/Shared/Application/Store.php');
if (str_contains($storePort, 'Doctrine\\DBAL') || preg_match('/function\s+db\s*\(/', $storePort)) {
    $errors[] = 'The Shared Application Store port must not expose DBAL.';
}

$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root.'/src', FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $file) {
    if (!$file->isFile() || 'php' !== $file->getExtension()) {
        continue;
    }

    $relative = substr($file->getPathname(), strlen($root) + 1);
    $source = file_get_contents($file->getPathname());
    if (false === $source) {
        $errors[] = sprintf('Could not inspect %s.', $relative);
        continue;
    }

    $inspectProductSource($relative, $source);

    $parts = explode('/', $relative);
    $module = $parts[1] ?? '';
    $isDomain = ($parts[2] ?? '') === 'Domain';
    $isApplication = ($parts[2] ?? '') === 'Application';
    $isInfrastructure = ($parts[2] ?? '') === 'Infrastructure';
    preg_match_all('/^\s*use\s+([^;]+);/m', $source, $importMatches);
    foreach ($importMatches[1] as $import) {
        if ($isDomain && (str_starts_with($import, 'Doctrine\\') || str_starts_with($import, 'Symfony\\') || str_starts_with($import, 'Psr\\') || str_contains($import, '\\Application\\') || str_contains($import, '\\Infrastructure\\') || str_contains($import, '\\Presentation\\'))) {
            $errors[] = sprintf('%s imports infrastructure/framework or another outer layer into Domain.', $relative);
        }
        if ($isApplication && str_starts_with($import, 'Doctrine\\')) {
            $errors[] = sprintf('%s imports Doctrine from Application.', $relative);
        }
        if ($isApplication && str_contains($import, '\\Infrastructure\\')) {
            $errors[] = sprintf('%s imports Infrastructure from Application.', $relative);
        }
        if ($isApplication && str_starts_with($import, 'Symfony\\Component\\') && (str_contains($import, '\\HttpClient\\') || str_contains($import, '\\HttpFoundation\\') || str_contains($import, '\\HttpKernel\\') || str_contains($import, '\\Messenger\\') || str_contains($import, '\\Mercure\\'))) {
            $errors[] = sprintf('%s imports a transport/runtime framework adapter into Application.', $relative);
        }

        $segments = explode('\\', $import);
        if ($isApplication && 'App' === $segments[0] && !in_array($segments[1] ?? '', [$module, 'Shared'], true)) {
            $otherContext = $segments[1] ?? '';
            $outerLayer = $segments[2] ?? '';
            $targetPath = $root.'/src/'.$otherContext.'/'.implode('/', array_slice($segments, 2)).'.php';
            $targetSource = is_file($targetPath) ? (string) file_get_contents($targetPath) : '';
            $isPublishedPort = 'Application' === $outerLayer && 1 === preg_match('/\binterface\s+'.preg_quote((string) end($segments), '/').'\b/', $targetSource);
            if (!$isPublishedPort) {
                $errors[] = sprintf('%s depends on %s outside Shared or a published Application port.', $relative, $import);
            }
        }
    }

    if (!$isInfrastructure && str_contains($source, '->db()')) {
        $errors[] = sprintf('%s accesses the raw DBAL connection outside Infrastructure.', $relative);
    }
    if (str_contains($source, 'Doctrine\\ORM\\') || str_contains($source, 'EntityManagerInterface') || str_contains($source, 'EntityManager::class')) {
        $errors[] = sprintf('%s references Doctrine ORM.', $relative);
    }
}

foreach (glob($root.'/packages/*/src', GLOB_ONLYDIR) ?: [] as $packageSource) {
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($packageSource, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if (!$file->isFile() || 'php' !== $file->getExtension()) {
            continue;
        }

        $relative = substr($file->getPathname(), strlen($root) + 1);
        $source = file_get_contents($file->getPathname());
        if (false === $source) {
            $errors[] = sprintf('Could not inspect %s.', $relative);
            continue;
        }

        $inspectProductSource($relative, $source);
    }
}

$interfacesByTag = array_flip($markerTags);
foreach ($expectedTaggedClasses as $tag => $requiredClasses) {
    if ([] === $requiredClasses) {
        $errors[] = sprintf('No concrete product classes implement the contract for compiled service tag %s.', $tag);
        continue;
    }

    $process = new Symfony\Component\Process\Process([
        PHP_BINARY,
        $root.'/bin/console',
        'debug:container',
        '--env=prod',
        '--no-interaction',
        '--format=json',
        '--tag='.$tag,
    ], $root, ['APP_ENV' => 'prod', 'APP_DEBUG' => '1']);
    $process->run();

    if (!$process->isSuccessful()) {
        $details = trim($process->getErrorOutput()."\n".$process->getOutput());
        $errors[] = sprintf('Could not inspect compiled service tag %s: %s', $tag, $details);
        continue;
    }

    try {
        $containerServices = json_decode($process->getOutput(), true, flags: JSON_THROW_ON_ERROR);
    } catch (JsonException $exception) {
        $errors[] = sprintf('Could not decode compiled service tag %s: %s', $tag, $exception->getMessage());
        continue;
    }

    $registeredClasses = [];
    foreach ($containerServices['definitions'] ?? [] as $definition) {
        if (is_array($definition) && is_string($definition['class'] ?? null)) {
            $registeredClasses[$definition['class']] = true;
        }
    }
    foreach (array_keys($requiredClasses) as $class) {
        if (!isset($registeredClasses[$class])) {
            $errors[] = sprintf('Compiled service tag %s does not contain implementation %s.', $tag, $class);
        }
    }
    foreach (array_keys($registeredClasses) as $class) {
        if (!is_a($class, $interfacesByTag[$tag], true)) {
            $errors[] = sprintf('Compiled service tag %s contains %s, which does not implement %s.', $tag, $class, $interfacesByTag[$tag]);
        }
    }
}

$contexts = ['Portfolio', 'WorkManagement', 'Classification', 'AgentCatalog', 'Orchestration', 'Automation', 'Extensions', 'Metrics', 'Access'];
foreach ($contexts as $context) {
    if (!is_dir($root.'/src/'.$context.'/Domain')) {
        $errors[] = sprintf('Bounded context %s has no Domain layer directory.', $context);
    }
}

if ([] !== $errors) {
    fwrite(STDERR, implode("\n", array_map(static fn (string $error): string => 'ERROR: '.$error, array_unique($errors)))."\n");
    exit(1);
}

fwrite(STDOUT, "Architecture boundary checks passed.\n");
