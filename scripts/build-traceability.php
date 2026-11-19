<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$requirements = json_decode((string) file_get_contents($root.'/requirements.json'), true, 512, JSON_THROW_ON_ERROR);
$acceptance = (string) file_get_contents($root.'/docs/ACCEPTANCE.md');
$acceptanceAnchors = [];
preg_match_all('/^##\s+(A\d{2})\s+-\s+(.+)$/m', $acceptance, $acceptanceHeadings, PREG_SET_ORDER);
foreach ($acceptanceHeadings as $heading) {
    $transliterated = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $heading[2]);
    $slug = strtolower(trim(preg_replace('/[^a-zA-Z0-9]+/', '-', false === $transliterated ? $heading[2] : $transliterated), '-'));
    $acceptanceAnchors[$heading[1]] = strtolower($heading[1]).'---'.$slug;
}
$resultPath = getenv('FALKENWARTE_ACCEPTANCE_EVIDENCE') ?: $root.'/var/ci-evidence/acceptance.json';
$verificationPath = getenv('FALKENWARTE_TRACEABILITY_VERIFICATION') ?: $root.'/var/ci-evidence/verification.json';
$results = is_file($resultPath) ? json_decode((string) file_get_contents($resultPath), true, 512, JSON_THROW_ON_ERROR) : [];
$verification = is_file($verificationPath) ? json_decode((string) file_get_contents($verificationPath), true, 512, JSON_THROW_ON_ERROR) : [];
$primary = $verification['primary'] ?? [];
$verifiedPrimary = ($verification['format'] ?? null) === 'falkenwarte.traceability-verification.v1'
    && ($primary['status'] ?? null) === 'passed'
    && ($primary['workflow_conclusion'] ?? null) === 'success'
    && ($results['overall_status'] ?? null) === 'passed'
    && is_string($results['commit'] ?? null)
    && ($primary['commit'] ?? null) === $results['commit']
    && is_string($results['image'] ?? null)
    && ($primary['image'] ?? null) === $results['image']
    && is_string($results['fixture_version'] ?? null)
    && ($primary['fixture_version'] ?? null) === $results['fixture_version'];
$cases = [];
if ($verifiedPrimary) {
    foreach ($results['cases'] ?? [] as $case) {
        if (!is_array($case)
            || ($case['status'] ?? '') !== 'passed'
            || ($case['coverage'] ?? 'complete') !== 'complete'
            || !is_string($case['acceptance_id'] ?? null)
            || !preg_match('/^A\d{2}$/', $case['acceptance_id'])
            || empty($case['observed_outcome'])
            || in_array($case['acceptance_id'], ['A03', 'A05', 'A19', 'A31'], true)) {
            continue;
        }
        $case['source_urls'] = $verification['cases'][$case['acceptance_id']]['source_urls'] ?? [$primary['workflow_url'] ?? null];
        $cases[$case['acceptance_id']] = $case;
    }
    foreach ($verification['cases'] ?? [] as $acceptanceId => $case) {
        if (!is_string($acceptanceId) || !preg_match('/^A\d{2}$/', $acceptanceId) || !is_array($case) || ($case['status'] ?? null) !== 'passed') {
            continue;
        }
        if (in_array($acceptanceId, ['A03', 'A05', 'A19', 'A31'], true)) {
            $cases[$acceptanceId] = $case;
        }
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
    'R16' => ['frontend/src', 'docs/MOCKUPS.md', 'docs/media/mockups'],
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
    'R16' => ['docs/USER_GUIDE.md', 'docs/MOCKUPS.md'],
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

    return [] === $links ? 'Noch nicht vorhanden' : implode(' · ', $links);
};

$cell = static fn (mixed $value): string => is_string($value) && '' !== $value ? str_replace('|', '\\|', $value) : '—';
$sourceLink = static function (mixed $url, string $label): string {
    if (!is_string($url) || 1 !== preg_match('~^https://~i', $url)) {
        return '—';
    }

    return sprintf('[%s](%s)', $label, $url);
};
$evidenceRows = [
    '| Beleg | Status | Commit | Image oder Digest | Fixture | Quelle |',
    '|---|---|---|---|---|---|',
];
$primaryStatus = $verifiedPrimary ? 'Belegt' : 'Nicht belegt';
$evidenceRows[] = sprintf(
    '| Hauptlauf | %s | `%s` | `%s` | %s | %s |',
    $primaryStatus,
    $verifiedPrimary ? $cell($primary['commit'] ?? null) : '—',
    $verifiedPrimary ? $cell($primary['image'] ?? null) : '—',
    $verifiedPrimary ? $cell($primary['fixture_version'] ?? null) : '—',
    $sourceLink($primary['workflow_url'] ?? null, 'GitHub-Workflow'),
);
foreach (['A03' => 'static-quality', 'A05' => 'background-functional'] as $caseId => $jobName) {
    $job = $primary['jobs'][$jobName] ?? [];
    $evidenceRows[] = sprintf(
        '| %s · %s | %s | `%s` | `%s` | %s | %s |',
        $caseId,
        $jobName,
        isset($cases[$caseId]) ? 'Belegt' : 'Nicht belegt',
        isset($cases[$caseId]) ? $cell($primary['commit'] ?? null) : '—',
        isset($cases[$caseId]) ? $cell($primary['image'] ?? null) : '—',
        isset($cases[$caseId]) ? $cell($primary['fixture_version'] ?? null) : '—',
        $sourceLink($job['source_url'] ?? null, 'Joblauf'),
    );
}
$a19 = $cases['A19'] ?? [];
$a19Phases = $a19['phases'] ?? [];
$a19Sources = is_array($a19['source_urls'] ?? null) ? $a19['source_urls'] : [];
$a19Source = $sourceLink($a19Sources[0] ?? null, 'Start- und Neustartbericht');
$evidenceRows[] = sprintf(
    '| A19 · Produktionsstart und Neustart | %s | `%s` | `%s` | %s | %s |',
    isset($cases['A19']) && 2 === count($a19Phases) ? 'Belegt: Start und Neustart' : 'Nicht belegt',
    isset($cases['A19']) ? $cell($primary['commit'] ?? null) : '—',
    isset($cases['A19']) ? $cell($primary['image'] ?? null) : '—',
    isset($cases['A19']) ? $cell($primary['fixture_version'] ?? null) : '—',
    $a19Source,
);
$a31 = $verification['a31'] ?? [];
$a31Checks = is_array($a31['checks'] ?? null) ? $a31['checks'] : [];
foreach (['normal_pr' => 'Normaler PR', 'docs_quality' => 'Dokumentationsjob', 'release_pr' => 'Release-Please-PR', 'fail_probe' => 'Fehlerprobe', 'skip_probe' => 'Skip-Probe', 'release' => 'Veröffentlichung'] as $checkName => $label) {
    $check = $a31Checks[$checkName] ?? [];
    $commitParts = [];
    foreach (['head_sha' => 'head', 'dispatch_expected_sha' => 'dispatch', 'checked_out_sha' => 'checkout', 'tag_commit' => 'tag', 'tested_commit' => 'tested', 'image_revision' => 'image revision'] as $field => $partLabel) {
        if (is_string($check[$field] ?? null)) {
            $commitParts[] = $partLabel.': '.$check[$field];
        }
    }
    $commit = [] === $commitParts ? null : implode('; ', $commitParts);
    $imageOrDigest = $check['image_digest'] ?? null;
    $outcomeParts = ['passed' === ($check['status'] ?? null) ? 'Belegt' : 'Nicht belegt'];
    if (is_string($check['conclusion'] ?? null)) {
        $outcomeParts[] = 'Run/Job '.$check['conclusion'];
    }
    foreach (['workflow_conclusion' => 'Workflow', 'quality_gate_conclusion' => 'quality-gate', 'e2e_conclusion' => 'E2E'] as $field => $partLabel) {
        if (is_string($check[$field] ?? null)) {
            $outcomeParts[] = $partLabel.' '.$check[$field];
        }
    }
    $outcome = implode('; ', $outcomeParts);
    $evidenceRows[] = sprintf(
        '| A31 · %s | %s | `%s` | `%s` | — | %s |',
        $label,
        $outcome,
        $cell($commit),
        $cell($imageOrDigest),
        $sourceLink($check['source_url'] ?? null, 'GitHub-Quelle'),
    );
}
$evidenceRows[] = '| M6 · Fork-Prüfung | Zurückgestellt | — | — | — | Ausdrückliche Nutzerentscheidung |';

$rows = ['| ID | Anforderung | Umsetzung | Dokumentation | Abnahme und Laufquellen | Nachweisstatus |', '|---|---|---|---|---|---|'];
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
        $caseLink = sprintf('[%s](ACCEPTANCE.md#%s)', $caseId, $anchor);
        $checks = $cases[$caseId]['checks'] ?? [];
        if ('A31' === $caseId && is_array($checks)) {
            foreach ($checks as $checkName => $check) {
                if (!is_array($check) || !is_string($check['source_url'] ?? null) || 1 !== preg_match('~^https://~i', $check['source_url'])) {
                    continue;
                }
                $caseLink .= sprintf(' ([%s](%s))', str_replace('_', ' ', (string) $checkName), $check['source_url']);
            }
        } else {
            $sources = $cases[$caseId]['source_urls'] ?? [];
            if (is_array($sources)) {
                foreach (array_values(array_unique(array_filter($sources, static fn (mixed $source): bool => is_string($source) && 1 === preg_match('~^https://~i', $source)))) as $sourceIndex => $source) {
                    $caseLink .= sprintf(' ([Lauf %d](%s))', $sourceIndex + 1, $source);
                }
            }
        }
        $caseLinks[] = $caseLink;
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
$gateExceptions = [
    'M3' => 'Echte T3-/OpenAI-Verbindung mangels aktiver Konfiguration nicht geprüft; Vertrags-E2E läuft gegen isolierte Netzwerk-Mocks.',
    'M6' => 'Fork-Prüfung bleibt auf ausdrückliche Nutzerentscheidung zurückgestellt.',
];
$gateRows = ['| Meilenstein | Konzept-Gate | Abnahmen mit Laufbeleg | Sichtbare Ausnahme |', '|---|---|---|---|'];
foreach ($gates as $milestone => $requiredCases) {
    $passedCount = count(array_filter($requiredCases, static fn (string $caseId): bool => isset($cases[$caseId])));
    $gateRows[] = sprintf('| %s | %s | %d/%d Abnahmen mit Laufbeleg | %s |', $milestone, implode(', ', $requiredCases), $passedCount, count($requiredCases), $gateExceptions[$milestone] ?? '—');
}

$reportPath = $root.'/docs/TRACEABILITY.md';
$report = (string) file_get_contents($reportPath);
$replaceGenerated = static function (string $content, string $start, string $end, array $generated): string {
    $pattern = '/'.preg_quote($start, '/').'\s*.*?\s*'.preg_quote($end, '/').'/s';
    $replacement = $start."\n\n".implode("\n", $generated)."\n\n".$end;
    $updated = preg_replace($pattern, $replacement, $content, 1, $matches);
    if (1 !== $matches || null === $updated) {
        throw new RuntimeException(sprintf('Generated section %s is missing or duplicated.', $start));
    }

    return $updated;
};
$report = $replaceGenerated($report, '<!-- generated requirements start -->', '<!-- generated requirements end -->', $rows);
$report = $replaceGenerated($report, '<!-- generated gates start -->', '<!-- generated gates end -->', $gateRows);
$report = $replaceGenerated($report, '<!-- generated evidence start -->', '<!-- generated evidence end -->', $evidenceRows);
file_put_contents($reportPath, $report);

fwrite(STDOUT, sprintf("Generated traceability for %d requirements. %d acceptance cases have verified hosted evidence.\n", count($requirements['requirements']), count($cases)));
