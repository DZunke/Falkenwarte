<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$errors = [];
$files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root.'/docs', FilesystemIterator::SKIP_DOTS));

foreach ($files as $file) {
    if (!$file->isFile() || $file->getExtension() !== 'md') {
        continue;
    }

    $sourcePath = $file->getPathname();
    $markdown = file_get_contents($sourcePath);
    if ($markdown === false) {
        $errors[] = sprintf('Could not read %s.', $sourcePath);
        continue;
    }

    preg_match_all('/!?\[[^\]]*\]\(([^)]+)\)/', $markdown, $links);
    foreach ($links[1] as $link) {
        $link = trim(preg_split('/\s+/', $link, 2)[0], '<>');
        if ($link === '' || str_starts_with($link, '#') || preg_match('/^(?:https?:|mailto:|tel:|data:)/i', $link)) {
            continue;
        }

        $target = rawurldecode(explode('#', explode('?', $link, 2)[0], 2)[0]);
        if ($target === '') {
            continue;
        }

        $resolved = realpath(dirname($sourcePath).'/'.$target);
        if ($resolved === false || !str_starts_with($resolved, $root.DIRECTORY_SEPARATOR)) {
            $errors[] = sprintf('%s links to missing local path %s.', substr($sourcePath, strlen($root) + 1), $link);
        }
    }

    $lines = preg_split('/\R/', $markdown) ?: [];
    $insideCode = false;
    $previousProse = false;
    foreach ($lines as $lineNumber => $line) {
        if (preg_match('/^\s*(```|~~~)/', $line)) {
            $insideCode = !$insideCode;
            $previousProse = false;
            continue;
        }
        if ($insideCode || trim($line) === '' || preg_match('/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\||<!--|!?\[)/', $line)) {
            $previousProse = false;
            continue;
        }

        if ($previousProse) {
            $errors[] = sprintf('%s:%d continues prose on a second source line.', substr($sourcePath, strlen($root) + 1), $lineNumber + 1);
        }
        $previousProse = !str_ends_with($line, '  ') && !str_ends_with($line, '\\');
    }
}

if ($errors !== []) {
    fwrite(STDERR, implode("\n", array_map(static fn (string $error): string => 'ERROR: '.$error, $errors))."\n");
    exit(1);
}

fwrite(STDOUT, "Documentation links resolve and prose paragraphs use one source line.\n");
