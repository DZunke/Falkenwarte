<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$requirements = json_decode((string) file_get_contents($root.'/requirements.json'), true, 512, JSON_THROW_ON_ERROR);
$acceptance = (string) file_get_contents($root.'/docs/ACCEPTANCE.md');
$acceptanceAnchors = [];
preg_match_all('/^##\s+(A\d{2})\s+-\s+(.+)$/m', $acceptance, $acceptanceHeadings, PREG_SET_ORDER);
foreach ($acceptanceHeadings as $heading) {
    $transliterated = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $heading[2]);
    $slug = strtolower(trim(preg_replace('/[^a-zA-Z0-9]+/', '-', $transliterated === false ? $heading[2] : $transliterated), '-'));
    $acceptanceAnchors[$heading[1]] = strtolower($heading[1]).'---'.$slug;
}
$resultPath = $root.'/qa/results.json';
$results = is_file($resultPath) ? json_decode((string) file_get_contents($resultPath), true, 512, JSON_THROW_ON_ERROR) : [];
$cases = [];
$completeRunReference = !empty($results['commit']) && !empty($results['image']) && !empty($results['fixture_version']);
foreach ($results['cases'] ?? [] as $case) {
    if ($completeRunReference && ($case['status'] ?? '') === 'passed' && !empty($case['observed_outcome'])) {
        $cases[$case['acceptance_id']] = $case;
    }
}

$implementationPaths = [
    'R01' => ['src/Portfolio', 'frontend/src'],
    'R02' => ['src/AgentCatalog', 'src/Orchestration'],
    'R03' => ['src/Access', 'src/Portfolio', 'config'],
    'R04' => ['src/Portfolio/Domain', 'src/WorkManagement/Domain', 'src/Access/Domain', 'src/Metrics/Domain', 'src/Classification/Domain', 'src/AgentCatalog/Domain', 'src/Orchestration/Domain', 'src/Automation/Domain', 'src/Extensions/Domain', 'scripts/check-architecture.php', 'composer.json'],
    'R05' => ['src/Shared', 'migrations'],
    'R06' => ['src/Shared', 'migrations'],
    'R07' => ['composer.json', 'migrations'],
    'R08' => ['src/WorkManagement'],
    'R09' => ['src/Access', 'src/WorkManagement', 'contracts/mcp-tools.json'],
    'R10' => ['src/AgentCatalog', 'src/Orchestration'],
    'R11' => ['src/Metrics'],
    'R12' => ['src/Metrics', 'frontend/src'],
    'R13' => ['src/Extensions'],
    'R14' => ['src/Classification', 'src/Orchestration', 'src/Shared'],
    'R15' => ['contracts/openapi.yaml', 'frontend/src/generated'],
    'R16' => ['frontend/src'],
    'R17' => ['composer.json', 'src/Classification/Application/DecisionGateway.php', 'src/Classification/Infrastructure/SymfonyAiDecisionAdapter.php', 'src/Classification/Infrastructure/OpenAiDecisionsPlatform.php'],
    'R18' => ['docker/Dockerfile', 'compose.yaml', 'docker/entrypoint.sh'],
    'R19' => ['src/Live/Infrastructure/Live.php', 'docker/Caddyfile', 'compose.yaml', 'docker/Dockerfile'],
    'R20' => ['README.md', 'docs/PRODUCT_CONCEPT.md'],
    'R21' => ['tests/e2e', 'docs/TESTING.md'],
    'R22' => ['tests/e2e', 'qa'],
    'R23' => ['qa/fixtures/fixture-seed.json', 'qa/scenarios.json', 'qa/fixtures', 'qa/mocks', 'tests/e2e', 'compose.test.yaml', 'scripts/ci-e2e.sh'],
    'R24' => ['.github', 'docs/GITHUB_DELIVERY.md'],
    'R25' => ['src/Classification'],
    'R26' => ['src/Classification', 'src/WorkManagement'],
    'R27' => ['src/Classification', 'src/Access'],
    'R28' => ['src/Classification', 'src/WorkManagement'],
    'R29' => ['src/WorkManagement'],
    'R30' => ['docs/PRODUCT_CONCEPT.md', 'contracts/openapi.yaml', 'src/WorkManagement/Application/WorkHandler.php', 'scripts/check-architecture.php'],
    'R31' => ['src/AgentCatalog', 'src/Orchestration'],
    'R32' => ['docker/Dockerfile', 'docker/Caddyfile', 'docker/entrypoint.sh', 'compose.yaml', 'docs/OPERATIONS.md'],
    'R33' => ['docs/domain', 'docs/adr', 'scripts/build-docs.php', 'scripts/build-traceability.php', 'scripts/check-docs.php'],
    'R34' => ['src/Classification', 'composer.json'],
    'R35' => ['tests/BackgroundFunctional', 'docs/TESTING.md'],
    'R36' => ['src/Access', 'docs/OPERATIONS.md'],
];

$documentationPaths = [
    'R01' => ['docs/PRODUCT_CONCEPT.md', 'docs/USER_GUIDE.md'],
    'R02' => ['docs/T3_INTEGRATION.md', 'docs/USER_GUIDE.md'],
    'R03' => ['docs/PRODUCT_CONCEPT.md', 'docs/OPERATIONS.md'],
    'R04' => ['docs/domain/BOUNDED_CONTEXTS.md', 'docs/domain/CONTEXT_MAP.md', 'docs/adr/0001.md'],
    'R05' => ['docs/domain/EVENTS.md', 'docs/domain/LIFECYCLES.md'],
    'R06' => ['docs/domain/EVENTS.md'],
    'R07' => ['docs/domain/BOUNDED_CONTEXTS.md', 'docs/adr/0002.md'],
    'R08' => ['docs/domain/BOUNDED_CONTEXTS.md', 'docs/domain/LIFECYCLES.md'],
    'R09' => ['contracts/README.md', 'docs/AI_DECISIONS.md'],
    'R10' => ['docs/T3_INTEGRATION.md'],
    'R11' => ['docs/PRODUCT_CONCEPT.md'],
    'R12' => ['docs/USER_GUIDE.md', 'docs/PRODUCT_CONCEPT.md'],
    'R13' => ['docs/PLUGIN_SYSTEM.md'],
    'R14' => ['docs/domain/CONTEXT_MAP.md', 'docs/PLUGIN_SYSTEM.md'],
    'R15' => ['contracts/README.md'],
    'R16' => ['docs/USER_GUIDE.md'],
    'R17' => ['docs/AI_DECISIONS.md', 'docs/SOURCES.md'],
    'R18' => ['docs/OPERATIONS.md'],
    'R19' => ['docs/LIVE_SERVICES.md'],
    'R20' => ['README.md', 'docs/PRODUCT_CONCEPT.md'],
    'R21' => ['docs/TESTING.md', 'docs/ACCEPTANCE.md'],
    'R22' => ['docs/TESTING.md'],
    'R23' => ['docs/TESTING.md'],
    'R24' => ['docs/GITHUB_DELIVERY.md'],
    'R25' => ['docs/AI_DECISIONS.md', 'docs/domain/LIFECYCLES.md'],
    'R26' => ['docs/AI_DECISIONS.md', 'docs/domain/GLOSSARY.md'],
    'R27' => ['docs/AI_DECISIONS.md', 'docs/domain/LIFECYCLES.md'],
    'R28' => ['docs/domain/LIFECYCLES.md', 'docs/AI_DECISIONS.md'],
    'R29' => ['docs/PRODUCT_CONCEPT.md', 'contracts/README.md'],
    'R30' => ['docs/PRODUCT_CONCEPT.md', 'docs/USER_GUIDE.md'],
    'R31' => ['docs/T3_INTEGRATION.md'],
    'R32' => ['docs/OPERATIONS.md'],
    'R33' => ['docs/DOCUMENTATION.md', 'docs/DECISIONS.md'],
    'R34' => ['docs/AI_DECISIONS.md', 'docs/adr/0006.md'],
    'R35' => ['docs/TESTING.md'],
    'R36' => ['docs/OPERATIONS.md'],
];

$link = static function (string $path, bool $showMissing = false) use ($root): string {
    if (!file_exists($root.'/'.$path)) {
        return $showMissing ? sprintf('**Fehlt:** `%s`', $path) : '';
    }
    if (str_starts_with($path, 'docs/')) {
        $relative = substr($path, strlen('docs/'));
        return sprintf('[%s](%s)', $relative, $relative);
    }
    if (str_starts_with($path, 'contracts/')) {
        return sprintf('[%s](../%s)', $path, $path);
    }

    return sprintf('`%s`', $path);
};

$formatPaths = static function (array $paths, bool $showMissing = false) use ($link): string {
    $links = array_values(array_filter(array_map(static fn (string $path): string => $link($path, $showMissing), $paths)));
    return $links === [] ? 'Noch nicht vorhanden' : implode('<br>', $links);
};

$rows = [];
foreach ($requirements['requirements'] as $requirement) {
    $id = $requirement['id'];
    $requiredCases = $requirement['acceptance'];
    foreach ($documentationPaths[$id] ?? [] as $documentationPath) {
        if (!file_exists($root.'/'.$documentationPath)) {
            throw new RuntimeException(sprintf('Traceability documentation path %s for %s does not exist.', $documentationPath, $id));
        }
    }
    $passedCount = count(array_filter($requiredCases, static fn (string $caseId): bool => isset($cases[$caseId])));
    $status = $passedCount === count($requiredCases)
        ? 'Abgenommen'
        : ($passedCount > 0 ? sprintf('%d/%d Abnahmen belegt', $passedCount, count($requiredCases)) : 'Abnahmen offen');

    $caseLinks = [];
    foreach ($requiredCases as $caseId) {
        $anchor = $acceptanceAnchors[$caseId] ?? strtolower($caseId);
        $caseLinks[] = sprintf('[%s](ACCEPTANCE.md#%s)', $caseId, $anchor);
    }

    $rows[] = sprintf(
        '| %s | %s | %s | %s | %s | %s |',
        $id,
        str_replace('|', '\\|', $requirement['requirement']),
        $formatPaths($implementationPaths[$id] ?? [], true),
        $formatPaths($documentationPaths[$id] ?? []),
        implode(', ', $caseLinks),
        $status,
    );
}

$gates = [
    'M0' => ['A03', 'A23'],
    'M1' => ['A01', 'A04', 'A06', 'A07', 'A08', 'A14', 'A21', 'A24', 'A28'],
    'M2' => ['A02', 'A13', 'A22', 'A25', 'A26', 'A27', 'A33'],
    'M3' => ['A05', 'A09', 'A10', 'A11', 'A12', 'A29', 'A30'],
    'M4' => ['A12', 'A16', 'A27', 'A33'],
    'M5' => ['A17', 'A18', 'A23', 'A32'],
    'M6' => ['A15', 'A19', 'A20', 'A21', 'A31'],
];
$gateRows = [];
foreach ($gates as $milestone => $requiredCases) {
    $passedCount = count(array_filter($requiredCases, static fn (string $caseId): bool => isset($cases[$caseId])));
    $gateRows[] = sprintf('| %s | %s | %d/%d Abnahmen mit Laufbeleg |', $milestone, implode(', ', $requiredCases), $passedCount, count($requiredCases));
}

$reportPath = $root.'/docs/TRACEABILITY.md';
$report = (string) file_get_contents($reportPath);
$replaceGenerated = static function (string $content, string $start, string $end, array $generated): string {
    $pattern = '/'.preg_quote($start, '/').'\s*.*?\s*'.preg_quote($end, '/').'/s';
    $replacement = $start."\n".implode("\n", $generated)."\n".$end;
    $updated = preg_replace($pattern, $replacement, $content, 1, $matches);
    if ($matches !== 1 || $updated === null) {
        throw new RuntimeException(sprintf('Generated section %s is missing or duplicated.', $start));
    }
    return $updated;
};
$report = $replaceGenerated($report, '<!-- generated requirements start -->', '<!-- generated requirements end -->', $rows);
$report = $replaceGenerated($report, '<!-- generated gates start -->', '<!-- generated gates end -->', $gateRows);
file_put_contents($reportPath, $report);

fwrite(STDOUT, sprintf("Generated traceability for %d requirements. %d acceptance cases have passing evidence.\n", count($rows), count($cases)));
