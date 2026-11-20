<?php

declare(strict_types=1);

use League\CommonMark\GithubFlavoredMarkdownConverter;

require_once dirname(__DIR__).'/vendor/autoload.php';

$root = dirname(__DIR__);
$target = $root.'/public/docs';
$manifestPath = $target.'/index.json';
if (!is_file($manifestPath)) {
    throw new RuntimeException('Documentation index is missing. Run scripts/build-docs.php first.');
}

$manifest = json_decode((string) file_get_contents($manifestPath), true, flags: JSON_THROW_ON_ERROR);
$pages = $manifest['documents'] ?? [];
$converter = new GithubFlavoredMarkdownConverter([
    'html_input' => 'escape',
    'allow_unsafe_links' => false,
    'table' => ['wrap' => ['enabled' => true, 'attributes' => ['class' => 'handbook-table']]],
]);
$escape = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$names = array_column($pages, 'title', 'path');
$pageUrl = static fn (string $path): string => '/docs/'.('README.md' === $path ? 'index.html' : substr($path, 0, -3).'.html');
$repositoryRevision ??= $manifest['revision'] ?? 'main';
$resolveRepositoryPath = static function (string $path, string $base): string {
    $parts = [];
    foreach (explode('/', ('' === $base ? '' : $base.'/').$path) as $part) {
        if ('' === $part || '.' === $part) {
            continue;
        }
        if ('..' === $part) {
            array_pop($parts);
            continue;
        }
        $parts[] = $part;
    }

    return implode('/', $parts);
};
$navigationGroups = [];
foreach ($pages as $pageIndex => $page) {
    $navigationGroups[$page['section'] ?? 'Entwicklung'][] = $page['path'];
}
$sectionOrder = ['Start', 'Benutzerhandbuch', 'Betrieb', 'Entwicklung', 'Architekturentscheidungen', 'Fachmodell'];
uksort($navigationGroups, static function (string $left, string $right) use ($sectionOrder): int {
    $leftIndex = array_search($left, $sectionOrder, true);
    $rightIndex = array_search($right, $sectionOrder, true);

    return (false === $leftIndex ? PHP_INT_MAX : $leftIndex) <=> (false === $rightIndex ? PHP_INT_MAX : $rightIndex);
});
foreach ($navigationGroups as &$paths) {
    usort($paths, static function (string $left, string $right): int {
        $leftNested = str_contains($left, '/');
        $rightNested = str_contains($right, '/');
        if ($leftNested !== $rightNested) {
            return $leftNested <=> $rightNested;
        }

        return strnatcasecmp($left, $right);
    });
}
unset($paths);

$renderNavigation = static function (string $currentPath) use ($navigationGroups, $names, $escape, $pageUrl): string {
    $navigation = '';
    foreach ($navigationGroups as $group => $paths) {
        $links = '';
        foreach ($paths as $path) {
            if (!isset($names[$path])) {
                continue;
            }

            $current = $currentPath === $path ? ' aria-current="page"' : '';
            $links .= '<li><a href="'.$escape($pageUrl($path)).'"'.$current.'>'.$escape($names[$path]).'</a></li>';
        }
        if ('' === $links) {
            continue;
        }

        $navigation .= '<section class="handbook-nav-group"><h2>'.$escape($group).'</h2><ul>'.$links.'</ul></section>';
    }

    return $navigation;
};

foreach ($pages as $pageIndex => $page) {
    $pagePath = $page['path'];
    $navigation = $renderNavigation($pagePath);
    $directory = dirname('docs/'.$pagePath);
    $markdown = preg_replace('/^<!-- generated [^>]+ -->$/m', '', $page['markdown']) ?? $page['markdown'];
    $fragment = (string) $converter->convert($markdown);
    $dom = new DOMDocument('1.0', 'UTF-8');
    $dom->loadHTML('<!doctype html><html lang="de"><head><meta charset="utf-8"></head><body><article>'.$fragment.'</article></body></html>', LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET);
    $xpath = new DOMXPath($dom);
    $slugs = [];
    $renderedHeadings = [];
    foreach ($xpath->query('//h1|//h2|//h3|//h4|//h5|//h6') as $heading) {
        if (!$heading instanceof DOMElement) {
            continue;
        }

        $text = trim($heading->textContent);
        $slug = mb_strtolower($text, 'UTF-8');
        $slug = preg_replace('/[^\p{L}\p{N}_\s-]/u', '', $slug) ?? $slug;
        $slug = preg_replace('/\s+/u', '-', trim($slug)) ?? trim($slug);
        $slug = trim(preg_replace('/-+/', '-', $slug) ?? $slug, '-');
        $seen = $slugs[$slug] ?? 0;
        $slugs[$slug] = $seen + 1;
        $id = $slug.($seen ? '-'.$seen : '');
        $heading->setAttribute('id', $id);
        $renderedHeadings[] = [
            'depth' => (int) substr($heading->nodeName, 1),
            'text' => $text,
            'id' => $id,
        ];
    }
    $pages[$pageIndex]['headings'] = $renderedHeadings;

    foreach ($xpath->query('//a[@href]|//img[@src]') as $node) {
        if (!$node instanceof DOMElement) {
            continue;
        }

        $attribute = 'a' === $node->nodeName ? 'href' : 'src';
        $url = $node->getAttribute($attribute);
        if ('' === $url) {
            continue;
        }

        if (preg_match('~^https?://github\.com/DZunke/Falkenwarte/(blob|tree)/main/(.+)$~i', $url, $githubLink)) {
            $url = 'https://github.com/DZunke/Falkenwarte/'.$githubLink[1].'/'.$repositoryRevision.'/'.$githubLink[2];
            $node->setAttribute($attribute, $url);
            if ('a' === $node->nodeName) {
                $node->setAttribute('target', '_blank');
                $node->setAttribute('rel', 'noopener noreferrer');
            }
            continue;
        }

        if (preg_match('~^(?:[a-z]+:|/|#)~i', $url)) {
            if ('a' === $node->nodeName && preg_match('~^https?://~i', $url)) {
                $node->setAttribute('target', '_blank');
                $node->setAttribute('rel', 'noopener noreferrer');
            }
            continue;
        }

        $parts = parse_url($url);
        if (false === $parts) {
            continue;
        }
        $linkPath = rawurldecode($parts['path'] ?? '');
        if ('' === $linkPath) {
            continue;
        }

        $resolved = $resolveRepositoryPath($linkPath, $directory);
        $query = isset($parts['query']) ? '?'.$parts['query'] : '';
        $hash = isset($parts['fragment']) ? '#'.$parts['fragment'] : '';
        $doc = str_starts_with($resolved, 'docs/') ? substr($resolved, 5) : null;
        if (null !== $doc && isset($names[$doc])) {
            $url = $pageUrl($doc).$query.$hash;
        } elseif (null !== $doc && !str_ends_with(strtolower($doc), '.md') && is_file($root.'/'.$resolved)) {
            $url = '/docs/content/'.$doc.$query.$hash;
        } elseif (str_starts_with($resolved, 'contracts/') && is_file($root.'/'.$resolved)) {
            $url = '/docs/'.$resolved.$query.$hash;
        } else {
            $objectType = is_dir($root.'/'.$resolved) ? 'tree' : 'blob';
            $url = 'https://github.com/DZunke/Falkenwarte/'.$objectType.'/'.$repositoryRevision.'/'.$resolved.$query.$hash;
        }

        $node->setAttribute($attribute, $url);
        if ('a' === $node->nodeName && preg_match('~^https?://~i', $url)) {
            $node->setAttribute('target', '_blank');
            $node->setAttribute('rel', 'noopener noreferrer');
        }
    }

    $articleNode = $dom->getElementsByTagName('article')->item(0);
    if (!$articleNode instanceof DOMElement) {
        throw new RuntimeException(sprintf('Could not render article for docs/%s', $pagePath));
    }

    $article = $dom->saveHTML($articleNode);
    $title = $escape($page['title']);
    $html = <<<HTML
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{$title} · Falkenwarte</title>
    <link rel="stylesheet" href="/docs/handbuch.css">
</head>
<body>
    <a class="skip-link" href="#main-content">Zum Inhalt springen</a>
    <header>
        <a class="brand" href="/docs/">Falkenwarte <span>Handbuch</span></a>
        <a href="/">Zur Anwendung</a>
    </header>
    <main id="main-content">
        <nav class="handbook-nav" aria-label="Handbuch">
            <div class="handbook-nav-desktop">{$navigation}</div>
            <details class="handbook-nav-mobile">
                <summary>Zum Kapitel springen</summary>
                <div class="handbook-nav-mobile-groups">{$navigation}</div>
            </details>
        </nav>
        {$article}
    </main>
</body>
</html>
HTML;

    $out = $root.'/public'.$pageUrl($pagePath);
    if (!is_dir(dirname($out)) && !mkdir(dirname($out), 0775, true) && !is_dir(dirname($out))) {
        throw new RuntimeException(sprintf('Could not create %s', dirname($out)));
    }
    if (false === file_put_contents($out, $html)) {
        throw new RuntimeException(sprintf('Could not write %s', $out));
    }
}

foreach ($pages as &$page) {
    unset($page['markdown']);
}
unset($page);

if (false === file_put_contents($manifestPath, json_encode(['revision' => $repositoryRevision, 'documents' => $pages], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n")) {
    throw new RuntimeException('Could not update rendered handbook headings.');
}

if (!copy(__DIR__.'/handbuch.css', $target.'/handbuch.css')) {
    throw new RuntimeException('Could not copy handbook stylesheet.');
}
