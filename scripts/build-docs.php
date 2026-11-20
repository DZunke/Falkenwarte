<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$source = $root.'/docs';
$target = $root.'/public/docs';
$contentTarget = $target.'/content';
$repositoryRevision = 'main';
$arguments = $_SERVER['argv'] ?? [];
foreach (is_array($arguments) ? array_slice($arguments, 1) : [] as $argument) {
    if (str_starts_with($argument, '--revision=')) {
        $candidate = substr($argument, strlen('--revision='));
        if (preg_match('/^[a-f0-9]{7,64}$/i', $candidate)) {
            $repositoryRevision = $candidate;
        }
    }
}

if (!is_dir($source)) {
    fwrite(STDERR, "Documentation source directory is missing.\n");
    exit(1);
}

$documentPaths = [];
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $file) {
    if (!$file->isFile() || 'md' !== $file->getExtension()) {
        continue;
    }

    $documentPaths[] = str_replace(DIRECTORY_SEPARATOR, '/', substr($file->getPathname(), strlen($source) + 1));
}

if (!in_array('README.md', $documentPaths, true)) {
    throw new RuntimeException('The handbook index docs/README.md is missing.');
}

sort($documentPaths, SORT_NATURAL | SORT_FLAG_CASE);
$documentPaths = array_values(array_unique($documentPaths));

$removeDirectory = static function (string $path) use (&$removeDirectory): void {
    if (!is_dir($path)) {
        return;
    }

    foreach (new FilesystemIterator($path) as $entry) {
        if ($entry->isDir() && !$entry->isLink()) {
            $removeDirectory($entry->getPathname());
        } else {
            unlink($entry->getPathname());
        }
    }

    rmdir($path);
};

$removeDirectory($target);
if (!mkdir($contentTarget, 0775, true) && !is_dir($contentTarget)) {
    throw new RuntimeException(sprintf('Could not create %s', $contentTarget));
}

$documents = [];
$mediaSource = $source.'/media';
foreach ($documentPaths as $relativePath) {
    $sourcePath = $source.'/'.$relativePath;
    $markdown = file_get_contents($sourcePath);
    if (false === $markdown) {
        throw new RuntimeException(sprintf('Could not read docs/%s', $relativePath));
    }

    preg_match('/^#\s+(.+)$/m', $markdown, $titleMatch);
    $title = trim($titleMatch[1] ?? pathinfo($relativePath, PATHINFO_FILENAME));
    preg_match_all('/^(#{1,6})\s+(.+)$/m', $markdown, $headingMatches, PREG_SET_ORDER);
    $plainText = preg_replace('/```.*?```/s', ' ', $markdown) ?? $markdown;
    $plainText = preg_replace('/!\[([^\]]*)\]\([^)]*\)/', '$1', $plainText) ?? $plainText;
    $plainText = preg_replace('/\[([^\]]+)\]\([^)]*\)/', '$1', $plainText) ?? $plainText;
    $plainText = preg_replace('/[`*_>#|~-]+/', ' ', $plainText) ?? $plainText;
    $plainText = preg_replace('/\s+/u', ' ', $plainText) ?? $plainText;
    $section = match (true) {
        'README.md' === $relativePath => 'Start',
        'USER_GUIDE.md' === $relativePath, str_starts_with($relativePath, 'user/') => 'Benutzerhandbuch',
        'OPERATIONS.md' === $relativePath, str_starts_with($relativePath, 'operations/') => 'Betrieb',
        'DECISIONS.md' === $relativePath, str_starts_with($relativePath, 'adr/') => 'Architekturentscheidungen',
        str_starts_with($relativePath, 'domain/') => 'Fachmodell',
        default => 'Entwicklung',
    };

    $destination = $contentTarget.'/'.$relativePath;
    $destinationDirectory = dirname($destination);
    if (!is_dir($destinationDirectory) && !mkdir($destinationDirectory, 0775, true) && !is_dir($destinationDirectory)) {
        throw new RuntimeException(sprintf('Could not create %s', $destinationDirectory));
    }

    if (!copy($sourcePath, $destination)) {
        throw new RuntimeException(sprintf('Could not copy docs/%s', $relativePath));
    }

    $documents[] = [
        'path' => $relativePath,
        'section' => $section,
        'sourcePath' => '/docs/content/'.str_replace(DIRECTORY_SEPARATOR, '/', $relativePath),
        'title' => $title,
        'headings' => array_map(static fn (array $heading): array => [
            'depth' => strlen($heading[1]),
            'text' => trim($heading[2]),
        ], $headingMatches),
        'markdown' => $markdown,
        'searchText' => trim($plainText),
    ];
}

if (is_dir($mediaSource)) {
    $mediaIterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($mediaSource, FilesystemIterator::SKIP_DOTS));
    foreach ($mediaIterator as $file) {
        if (!$file->isFile()) {
            continue;
        }

        $relativePath = str_replace(DIRECTORY_SEPARATOR, '/', substr($file->getPathname(), strlen($source) + 1));
        $destination = $contentTarget.'/'.$relativePath;
        $destinationDirectory = dirname($destination);
        if (!is_dir($destinationDirectory) && !mkdir($destinationDirectory, 0775, true) && !is_dir($destinationDirectory)) {
            throw new RuntimeException(sprintf('Could not create %s', $destinationDirectory));
        }

        if (!copy($file->getPathname(), $destination)) {
            throw new RuntimeException(sprintf('Could not copy docs/%s', $relativePath));
        }
    }
}

$contractSource = $root.'/contracts';
$contractTarget = $target.'/contracts';
if (!is_dir($contractSource)) {
    throw new RuntimeException('Contract source directory is missing.');
}

$contractIterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($contractSource, FilesystemIterator::SKIP_DOTS));
foreach ($contractIterator as $file) {
    if (!$file->isFile()) {
        continue;
    }

    $relativePath = substr($file->getPathname(), strlen($contractSource) + 1);
    $destination = $contractTarget.'/'.$relativePath;
    $destinationDirectory = dirname($destination);
    if (!is_dir($destinationDirectory) && !mkdir($destinationDirectory, 0775, true) && !is_dir($destinationDirectory)) {
        throw new RuntimeException(sprintf('Could not create %s', $destinationDirectory));
    }

    if (!copy($file->getPathname(), $destination)) {
        throw new RuntimeException(sprintf('Could not copy contract asset %s', $relativePath));
    }
}

$manifest = json_encode(['revision' => $repositoryRevision, 'documents' => $documents], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
if (false === file_put_contents($target.'/index.json', $manifest."\n")) {
    throw new RuntimeException('Could not write public/docs/index.json');
}

fwrite(STDOUT, sprintf("Built active handbook index for %d Markdown files.\n", count($documents)));

require __DIR__.'/render-docs.php';
