<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$errors = [];
$markdownFiles = array_merge(
    [$root.'/README.md', $root.'/contracts/README.md', $root.'/AGENTS.md'],
    glob($root.'/.agents/skills/*/SKILL.md') ?: [],
);
$docsRoot = $root.'/docs';

if (!is_file($docsRoot.'/README.md')) {
    $errors[] = 'docs/README.md is required as the handbook home page.';
}

foreach ([$root.'/README.md', $root.'/contracts/README.md'] as $entryPage) {
    if (!is_file($entryPage)) {
        $errors[] = sprintf('Required public entry page is missing: %s.', substr($entryPage, strlen($root) + 1));
    }
}

if (is_dir($docsRoot)) {
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($docsRoot, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isFile() && 'md' === $file->getExtension()) {
            $markdownFiles[] = $file->getPathname();
        }
    }
}

$markdownFiles = array_values(array_unique($markdownFiles));
foreach ($markdownFiles as $sourcePath) {
    if (!is_file($sourcePath)) {
        continue;
    }

    $markdown = file_get_contents($sourcePath);
    if (false === $markdown) {
        $errors[] = sprintf('Could not read %s.', substr($sourcePath, strlen($root) + 1));
        continue;
    }

    $sourceRelativePath = substr($sourcePath, strlen($root) + 1);
    preg_match_all('/!?(?:\[[^\]]*\])\(([^)]+)\)/', $markdown, $links);
    foreach ($links[1] as $link) {
        $link = trim(preg_split('/\s+/', $link, 2)[0], '<>');
        $parts = parse_url($link);
        if (false === $parts) {
            $errors[] = sprintf('%s contains a malformed link: %s.', $sourceRelativePath, $link);
            continue;
        }

        $scheme = strtolower($parts['scheme'] ?? '');
        $host = strtolower($parts['host'] ?? '');
        if ('' !== $scheme && !in_array($scheme, ['http', 'https', 'mailto', 'tel', 'data'], true)) {
            continue;
        }
        if ('' !== $host) {
            if ('github.com' === $host && preg_match('~^/DZunke/Falkenwarte/(?:blob|tree)/[^/]+/(.+)$~', $parts['path'] ?? '', $repositoryLink)) {
                $target = realpath($root.'/'.rawurldecode($repositoryLink[1]));
                if (false === $target || !str_starts_with($target, $root.DIRECTORY_SEPARATOR)) {
                    $errors[] = sprintf('%s links to missing repository path %s.', $sourceRelativePath, $link);
                }
            }
            continue;
        }
        if ('' !== $scheme || str_starts_with($link, '/') || str_starts_with($link, '#')) {
            continue;
        }

        $targetPath = rawurldecode($parts['path'] ?? '');
        if ('' === $targetPath) {
            continue;
        }

        $target = realpath(dirname($sourcePath).'/'.$targetPath);
        if (false === $target || !str_starts_with($target, $root.DIRECTORY_SEPARATOR)) {
            $errors[] = sprintf('%s links to missing local path %s.', $sourceRelativePath, $link);
        }
    }

    $lines = preg_split('/\R/', $markdown) ?: [];
    // YAML frontmatter precedes the Markdown body in project skills.
    if ('---' === $lines[0]) {
        $end = array_search('---', array_slice($lines, 1, null, true), true);
        if (false !== $end) {
            $lines = array_slice($lines, $end + 1, null, true);
        }
    }
    $insideCode = false;
    $previousProse = false;
    $h1Count = 0;
    foreach ($lines as $lineNumber => $line) {
        if (preg_match('/^\s*(```|~~~)/', $line)) {
            $insideCode = !$insideCode;
            $previousProse = false;
            continue;
        }
        if (!$insideCode && preg_match('/^#\s+\S/', $line)) {
            ++$h1Count;
        }
        if ($insideCode || '' === trim($line) || preg_match('/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\||<!--|!?(?:\[|<)|\s{2,})/', $line)) {
            $previousProse = false;
            continue;
        }

        if ($previousProse) {
            $errors[] = sprintf('%s:%d continues prose on a second source line.', $sourceRelativePath, $lineNumber + 1);
        }
        $previousProse = !str_ends_with($line, '  ') && !str_ends_with($line, '\\');
    }
    if (1 !== $h1Count) {
        $errors[] = sprintf('%s must have exactly one top-level heading.', $sourceRelativePath);
    }
}

$decisionsPath = $docsRoot.'/DECISIONS.md';
if (!is_file($decisionsPath)) {
    $errors[] = 'docs/DECISIONS.md is required as the ADR index.';
}
$decisions = is_file($decisionsPath) ? (string) file_get_contents($decisionsPath) : '';
$decisionIds = [];
foreach (glob($docsRoot.'/adr/*.md') ?: [] as $adrPath) {
    $content = (string) file_get_contents($adrPath);
    if (!preg_match('/^# (ADR-(\d{4}))\b/', $content, $id) || basename($adrPath, '.md') !== $id[2] || isset($decisionIds[$id[1]])) {
        $errors[] = sprintf('ADR heading and filename must identify one unique decision in %s.', basename($adrPath));
        continue;
    }

    $decisionIds[$id[1]] = true;
    if (!preg_match('/^\*\*Status:\*\* (accepted|proposed|rejected|superseded)\b/m', $content, $status)) {
        $errors[] = $id[1].' has an unrecognized decision status.';
    } elseif ('superseded' === $status[1] && !preg_match('/\[ADR-(?!'.preg_quote($id[2], '/').'\b)\d{4}\]\(\d{4}\.md\)/', $content)) {
        $errors[] = $id[1].' must link the successor decision.';
    }
    if (!str_contains($decisions, '['.$id[1].'](adr/'.basename($adrPath).')')) {
        $errors[] = $id[1].' is missing from the decision index.';
    }
}

foreach (['EVENTS' => ['event-envelope', 'action-event', 'ui-change'], 'LIFECYCLES' => ['ticket-receipt', 'classification-record']] as $page => $contracts) {
    $pagePath = $docsRoot.'/domain/'.$page.'.md';
    if (!is_file($pagePath)) {
        $errors[] = 'The domain handbook is missing '.$page.'.md.';
        continue;
    }

    $content = (string) file_get_contents($pagePath);
    foreach ($contracts as $contract) {
        $relative = 'contracts/schemas/'.$contract.'.schema.json';
        $schemaPath = $root.'/'.$relative;
        $schema = is_file($schemaPath) ? json_decode((string) file_get_contents($schemaPath), true, flags: JSON_THROW_ON_ERROR) : null;
        if (!str_contains($content, $relative) || !is_array($schema) || !preg_match('/v[1-9][0-9]*$/', $schema['$id'] ?? '')) {
            $errors[] = $page.' must link the versioned schema '.$relative.'.';
        }
    }
}

if ([] !== $errors) {
    fwrite(STDERR, implode("\n", array_map(static fn (string $error): string => 'ERROR: '.$error, $errors))."\n");
    exit(1);
}

fwrite(STDOUT, "Handbook and project documentation links resolve locally; prose paragraphs use one source line.\n");
