<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$errors = [];
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
