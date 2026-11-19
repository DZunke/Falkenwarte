<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$errors = [];
$files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root.'/docs', FilesystemIterator::SKIP_DOTS));

foreach ($files as $file) {
    if (!$file->isFile() || 'md' !== $file->getExtension()) {
        continue;
    }

    $sourcePath = $file->getPathname();
    $markdown = file_get_contents($sourcePath);
    if (false === $markdown) {
        $errors[] = sprintf('Could not read %s.', $sourcePath);
        continue;
    }

    preg_match_all('/!?\[[^\]]*\]\(([^)]+)\)/', $markdown, $links);
    foreach ($links[1] as $link) {
        $link = trim(preg_split('/\s+/', $link, 2)[0], '<>');
        if ('' === $link || str_starts_with($link, '#') || preg_match('/^(?:https?:|mailto:|tel:|data:)/i', $link)) {
            continue;
        }

        $target = rawurldecode(explode('#', explode('?', $link, 2)[0], 2)[0]);
        if ('' === $target) {
            continue;
        }

        $resolved = realpath(dirname($sourcePath).'/'.$target);
        if (false === $resolved || !str_starts_with($resolved, $root.DIRECTORY_SEPARATOR)) {
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
        if ($insideCode || '' === trim($line) || preg_match('/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\||<!--|!?\[)/', $line)) {
            $previousProse = false;
            continue;
        }

        if ($previousProse) {
            $errors[] = sprintf('%s:%d continues prose on a second source line.', substr($sourcePath, strlen($root) + 1), $lineNumber + 1);
        }
        $previousProse = !str_ends_with($line, '  ') && !str_ends_with($line, '\\');
    }
}

$decisions = (string) file_get_contents($root.'/docs/DECISIONS.md');
$ids = [];
foreach (glob($root.'/docs/adr/*.md') as $adr) {
    $content = (string) file_get_contents($adr);
    if (!preg_match('/^# (ADR-(\d{4}))\b/', $content, $id) || basename($adr, '.md') !== $id[2] || isset($ids[$id[1]])) {
        $errors[] = sprintf('ADR heading and filename must identify one unique decision in %s.', basename($adr));
        continue;
    }
    $ids[$id[1]] = true;
    if (!preg_match('/^\*\*Status:\*\* (accepted|proposed|rejected|superseded)\b/m', $content, $status)) {
        $errors[] = $id[1].' has an unrecognized decision status.';
    } elseif ('superseded' === $status[1] && !preg_match('/\[ADR-(?!'.preg_quote($id[2], '/').'\b)\d{4}\]\(\d{4}\.md\)/', $content)) {
        $errors[] = $id[1].' must link the successor decision.';
    }
    if (!str_contains($decisions, '['.$id[1].'](adr/'.basename($adr).')')) {
        $errors[] = $id[1].' is missing from the decision index.';
    }
}
foreach (['EVENTS' => ['event-envelope', 'action-event', 'ui-change'], 'LIFECYCLES' => ['ticket-receipt', 'classification-record']] as $page => $contracts) {
    $content = (string) file_get_contents($root.'/docs/domain/'.$page.'.md');
    foreach ($contracts as $contract) {
        $relative = 'contracts/schemas/'.$contract.'.schema.json';
        $schema = json_decode((string) file_get_contents($root.'/'.$relative), true, flags: JSON_THROW_ON_ERROR);
        if (!str_contains($content, $relative) || !preg_match('/v[1-9][0-9]*$/', $schema['$id'] ?? '')) {
            $errors[] = $page.' must link the versioned schema '.$relative.'.';
        }
    }
}

if ([] !== $errors) {
    fwrite(STDERR, implode("\n", array_map(static fn (string $error): string => 'ERROR: '.$error, $errors))."\n");
    exit(1);
}

fwrite(STDOUT, "Documentation links resolve and prose paragraphs use one source line.\n");
