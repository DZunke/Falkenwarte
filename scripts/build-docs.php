<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$source = $root.'/docs';
$target = $root.'/public/docs';
$contentTarget = $target.'/content';

if (!is_dir($source)) {
    fwrite(STDERR, "Documentation source directory is missing.\n");
    exit(1);
}

if (!is_dir($contentTarget) && !mkdir($contentTarget, 0775, true) && !is_dir($contentTarget)) {
    throw new RuntimeException(sprintf('Could not create %s', $contentTarget));
}

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
$removeDirectory($contentTarget);
$removeDirectory($target.'/contracts');
if (is_file($target.'/index.json')) {
    unlink($target.'/index.json');
}
if (!mkdir($contentTarget, 0775, true) && !is_dir($contentTarget)) {
    throw new RuntimeException(sprintf('Could not create %s', $contentTarget));
}

$documents = [];
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS));

foreach ($iterator as $file) {
    if (!$file->isFile() || 'md' !== $file->getExtension()) {
        continue;
    }

    $relativePath = substr($file->getPathname(), strlen($source) + 1);
    $markdown = file_get_contents($file->getPathname());
    if (false === $markdown) {
        throw new RuntimeException(sprintf('Could not read %s', $file->getPathname()));
    }

    preg_match('/^#\s+(.+)$/m', $markdown, $titleMatch);
    $title = trim($titleMatch[1] ?? pathinfo($relativePath, PATHINFO_FILENAME));
    preg_match_all('/^#{1,4}\s+(.+)$/m', $markdown, $headingMatches);
    $plainText = preg_replace('/```.*?```/s', ' ', $markdown) ?? $markdown;
    $plainText = preg_replace('/!\[([^\]]*)\]\([^)]*\)/', '$1', $plainText) ?? $plainText;
    $plainText = preg_replace('/\[([^\]]+)\]\([^)]*\)/', '$1', $plainText) ?? $plainText;
    $plainText = preg_replace('/[`*_>#|~-]+/', ' ', $plainText) ?? $plainText;
    $plainText = preg_replace('/\s+/u', ' ', $plainText) ?? $plainText;

    $destination = $contentTarget.'/'.$relativePath;
    $destinationDirectory = dirname($destination);
    if (!is_dir($destinationDirectory) && !mkdir($destinationDirectory, 0775, true) && !is_dir($destinationDirectory)) {
        throw new RuntimeException(sprintf('Could not create %s', $destinationDirectory));
    }

    if (!copy($file->getPathname(), $destination)) {
        throw new RuntimeException(sprintf('Could not copy %s', $relativePath));
    }

    $documents[] = [
        'path' => $relativePath,
        'sourcePath' => '/docs/content/'.str_replace(DIRECTORY_SEPARATOR, '/', $relativePath),
        'title' => $title,
        'headings' => array_values(array_map('trim', $headingMatches[1] ?? [])),
        'markdown' => $markdown,
        'searchText' => trim($plainText),
    ];
}

$mediaSource = $source.'/media';
if (is_dir($mediaSource)) {
    $mediaIterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($mediaSource, FilesystemIterator::SKIP_DOTS));
    foreach ($mediaIterator as $file) {
        if (!$file->isFile()) {
            continue;
        }

        $relativePath = substr($file->getPathname(), strlen($source) + 1);
        $destination = $contentTarget.'/'.$relativePath;
        $destinationDirectory = dirname($destination);
        if (!is_dir($destinationDirectory) && !mkdir($destinationDirectory, 0775, true) && !is_dir($destinationDirectory)) {
            throw new RuntimeException(sprintf('Could not create %s', $destinationDirectory));
        }
        if (!copy($file->getPathname(), $destination)) {
            throw new RuntimeException(sprintf('Could not copy %s', $relativePath));
        }
    }
}

$contractSource = $root.'/contracts';
$contractTarget = $target.'/contracts';
if (!is_dir($contractTarget) && !mkdir($contractTarget, 0775, true) && !is_dir($contractTarget)) {
    throw new RuntimeException(sprintf('Could not create %s', $contractTarget));
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

usort($documents, static fn (array $left, array $right): int => strnatcasecmp($left['path'], $right['path']));
$manifest = json_encode(['documents' => $documents], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
if (false === file_put_contents($target.'/index.json', $manifest."\n")) {
    throw new RuntimeException('Could not write public/docs/index.json');
}

fwrite(STDOUT, sprintf("Built documentation index for %d Markdown files.\n", count($documents)));

$renderer = $root.'/scripts/render-docs.php';
if (is_file($renderer)) {
    passthru(escapeshellarg(PHP_BINARY).' '.escapeshellarg($renderer), $status);
    if ($status !== 0) {
        exit($status);
    }
}

require __DIR__.'/render-docs.php';
