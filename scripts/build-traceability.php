<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$requirements = json_decode((string) file_get_contents($root.'/requirements.json'), true, 512, JSON_THROW_ON_ERROR);
$acceptancePath = $root.'/qa/acceptance/ACCEPTANCE.md';
$acceptance = (string) file_get_contents($acceptancePath);
$acceptanceAnchors = [];
preg_match_all('/^##\s+(A\d{2,})\s+-\s+(.+)$/m', $acceptance, $acceptanceHeadings, PREG_SET_ORDER);
foreach ($acceptanceHeadings as $heading) {
    $caseId = $heading[1];
    if (isset($acceptanceAnchors[$caseId])) {
        throw new RuntimeException(sprintf('Acceptance case %s is duplicated.', $caseId));
    }
    $anchorMarkup = sprintf('<a id="%s"></a>'."\n".'## %s -', strtolower($caseId), $caseId);
    if (!str_contains($acceptance, $anchorMarkup)) {
        throw new RuntimeException(sprintf('Acceptance case %s lacks its explicit Markdown anchor.', $caseId));
    }
    $acceptanceAnchors[$caseId] = strtolower($caseId);
}
if ([] === $acceptanceAnchors) {
    throw new RuntimeException('The acceptance specification contains no cases.');
}
$options = getopt('', ['acceptance:', 'verification:', 'output:']);
$resultPath = $options['acceptance'] ?? null;
if (!is_string($resultPath) || '' === $resultPath) {
    $resultPath = getenv('FALKENWARTE_ACCEPTANCE_EVIDENCE');
}
if (!is_string($resultPath) || '' === $resultPath) {
    $resultPath = $root.'/var/ci-evidence/acceptance.json';
}
$verificationPath = $options['verification'] ?? null;
if (!is_string($verificationPath) || '' === $verificationPath) {
    $verificationPath = getenv('FALKENWARTE_TRACEABILITY_VERIFICATION');
}
if (!is_string($verificationPath) || '' === $verificationPath) {
    $verificationPath = $root.'/var/ci-evidence/verification.json';
}
$root = realpath($root) ?: $root;
$requestedReportPath = $options['output'] ?? $root.'/var/ci-evidence/traceability.md';
if (!str_starts_with($requestedReportPath, DIRECTORY_SEPARATOR)) {
    $requestedReportPath = (getcwd() ?: $root).'/'.$requestedReportPath;
}
$requestedReportDirectory = dirname($requestedReportPath);
if (!is_dir($requestedReportDirectory) && !mkdir($requestedReportDirectory, 0775, true) && !is_dir($requestedReportDirectory)) {
    throw new RuntimeException(sprintf('Could not create output directory %s.', $requestedReportDirectory));
}
$reportDirectory = realpath($requestedReportDirectory);
if (false === $reportDirectory) {
    throw new RuntimeException(sprintf('Could not resolve output directory %s.', $requestedReportDirectory));
}
$reportFilename = basename($requestedReportPath);
if (in_array($reportFilename, ['', '.', '..'], true) || is_dir($reportDirectory.'/'.$reportFilename)) {
    throw new InvalidArgumentException('The report output must be a file path.');
}
$reportPath = $reportDirectory.'/'.$reportFilename;
$relativeRepositoryPath = static function (string $from, string $to): string {
    $fromParts = array_values(array_filter(explode(DIRECTORY_SEPARATOR, trim($from, DIRECTORY_SEPARATOR)), static fn (string $part): bool => '' !== $part));
    $toParts = array_values(array_filter(explode(DIRECTORY_SEPARATOR, trim($to, DIRECTORY_SEPARATOR)), static fn (string $part): bool => '' !== $part));
    $sharedPartCount = 0;
    $limit = min(count($fromParts), count($toParts));
    while ($sharedPartCount < $limit && $fromParts[$sharedPartCount] === $toParts[$sharedPartCount]) {
        ++$sharedPartCount;
    }

    return implode('/', [
        ...array_fill(0, count($fromParts) - $sharedPartCount, '..'),
        ...array_slice($toParts, $sharedPartCount),
    ]);
};
$repositoryPath = $relativeRepositoryPath($reportDirectory, $root);
$repositoryPrefix = '' === $repositoryPath ? '' : $repositoryPath.'/';
$results = is_file($resultPath) ? json_decode((string) file_get_contents($resultPath), true, 512, JSON_THROW_ON_ERROR) : [];
$verification = is_file($verificationPath) ? json_decode((string) file_get_contents($verificationPath), true, 512, JSON_THROW_ON_ERROR) : [];
if (!is_array($results) || !is_array($verification)) {
    throw new RuntimeException('Traceability inputs must be JSON objects.');
}
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
            || !preg_match('/^A\d{2,}$/', $case['acceptance_id'])
            || !isset($acceptanceAnchors[$case['acceptance_id']])
            || empty($case['observed_outcome'])
            || in_array($case['acceptance_id'], ['A03', 'A05', 'A19', 'A31'], true)) {
            continue;
        }
        $case['source_urls'] = $verification['cases'][$case['acceptance_id']]['source_urls'] ?? [$primary['workflow_url'] ?? null];
        $cases[$case['acceptance_id']] = $case;
    }
    foreach ($verification['cases'] ?? [] as $acceptanceId => $case) {
        if (!is_string($acceptanceId) || !preg_match('/^A\d{2,}$/', $acceptanceId) || !isset($acceptanceAnchors[$acceptanceId]) || !is_array($case) || ($case['status'] ?? null) !== 'passed') {
            continue;
        }
        if (in_array($acceptanceId, ['A03', 'A05', 'A19', 'A31'], true)) {
            $cases[$acceptanceId] = $case;
        }
    }
}

$formatPaths = static function (array $paths) use ($repositoryPrefix): string {
    return implode(' · ', array_map(
        static fn (string $path): string => sprintf('[`%s`](%s%s)', $path, $repositoryPrefix, $path),
        $paths,
    ));
};

$requirementsList = $requirements['requirements'] ?? null;
if (!is_array($requirementsList) || [] === $requirementsList) {
    throw new RuntimeException('requirements.json must contain at least one requirement.');
}
$acceptanceIdPattern = '/^A\d{2,}$/';
$requirementIdPattern = '/^R\d{2,}$/';
$requirementIds = [];
$referencedAcceptanceIds = [];
foreach ($requirementsList as $requirement) {
    if (!is_array($requirement)
        || !is_string($requirement['id'] ?? null)
        || !preg_match($requirementIdPattern, $requirement['id'])
        || isset($requirementIds[$requirement['id']])
        || !is_string($requirement['requirement'] ?? null)
        || '' === trim($requirement['requirement'])
        || !is_array($requirement['acceptance'] ?? null)
        || [] === $requirement['acceptance']) {
        throw new RuntimeException('requirements.json contains an invalid or duplicated requirement.');
    }
    if (isset($requirement['specification']) && (!is_string($requirement['specification']) || '' === trim($requirement['specification']))) {
        throw new RuntimeException(sprintf('Requirement %s has an invalid optional specification reference.', $requirement['id']));
    }
    if (isset($requirement['milestone']) && (!is_string($requirement['milestone']) || '' === trim($requirement['milestone']))) {
        throw new RuntimeException(sprintf('Requirement %s has an invalid optional milestone reference.', $requirement['id']));
    }
    $requirementIds[$requirement['id']] = true;

    foreach ($requirement['acceptance'] as $caseId) {
        if (!is_string($caseId) || !preg_match($acceptanceIdPattern, $caseId) || !isset($acceptanceAnchors[$caseId])) {
            throw new RuntimeException(sprintf('Requirement %s references missing acceptance case %s.', $requirement['id'], (string) $caseId));
        }
        $referencedAcceptanceIds[$caseId] = true;
    }
    if (count($requirement['acceptance']) !== count(array_unique($requirement['acceptance']))) {
        throw new RuntimeException(sprintf('Requirement %s contains duplicate acceptance references.', $requirement['id']));
    }

    foreach (['implementation', 'documentation'] as $mappingName) {
        $paths = $requirement[$mappingName] ?? null;
        if (!is_array($paths) || [] === $paths) {
            throw new RuntimeException(sprintf('Requirement %s has no %s path mapping.', $requirement['id'], $mappingName));
        }
        foreach ($paths as $mappedPath) {
            if (!is_string($mappedPath)
                || '' === $mappedPath
                || str_starts_with($mappedPath, '/')
                || preg_match('~(^|/)\.\.(/|$)~', $mappedPath)
                || !file_exists($root.'/'.$mappedPath)) {
                throw new RuntimeException(sprintf('Invalid or missing %s path for %s: %s.', $mappingName, $requirement['id'], (string) $mappedPath));
            }
        }
    }
}
foreach (array_keys($acceptanceAnchors) as $caseId) {
    if (!isset($referencedAcceptanceIds[$caseId])) {
        throw new RuntimeException(sprintf('Acceptance case %s is not mapped to a requirement.', $caseId));
    }
}

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
    $passedCount = count(array_filter($requiredCases, static fn (string $caseId): bool => isset($cases[$caseId])));
    $status = $passedCount === count($requiredCases)
        ? 'Abgenommen'
        : ($passedCount > 0 ? sprintf('%d/%d Abnahmen belegt', $passedCount, count($requiredCases)) : 'Abnahmen offen');

    $caseLinks = [];
    foreach ($requiredCases as $caseId) {
        $anchor = $acceptanceAnchors[$caseId] ?? strtolower($caseId);
        $caseLink = sprintf('[%s](%sqa/acceptance/ACCEPTANCE.md#%s)', $caseId, $repositoryPrefix, $anchor);
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
        $formatPaths($requirement['implementation']),
        $formatPaths($requirement['documentation']),
        implode(', ', $caseLinks),
        $status,
    );
}

$gates = $requirements['milestone_gates'] ?? [];
if (!is_array($gates) || [] === $gates) {
    throw new RuntimeException('requirements.json must define at least one milestone gate.');
}
$gateRows = ['| Meilenstein | Konzept-Gate | Abnahmen mit Laufbeleg | Sichtbare Ausnahme |', '|---|---|---|---|'];
foreach ($gates as $milestone => $gate) {
    if (!is_string($milestone) || !preg_match('/^M\d+$/', $milestone) || !is_array($gate)) {
        throw new RuntimeException(sprintf('Invalid milestone gate %s.', (string) $milestone));
    }
    $requiredCases = $gate['acceptance'] ?? null;
    if (!is_array($requiredCases) || [] === $requiredCases) {
        throw new RuntimeException(sprintf('Milestone %s has no acceptance gate.', (string) $milestone));
    }
    foreach ($requiredCases as $caseId) {
        if (!is_string($caseId) || !isset($acceptanceAnchors[$caseId])) {
            throw new RuntimeException(sprintf('Milestone %s references unknown acceptance case %s.', (string) $milestone, (string) $caseId));
        }
    }
    if (isset($gate['required_scenarios']) && (!is_array($gate['required_scenarios']) || $gate['required_scenarios'] !== array_filter($gate['required_scenarios'], 'is_string'))) {
        throw new RuntimeException(sprintf('Milestone %s has invalid required scenario identifiers.', $milestone));
    }

    $passedCount = count(array_filter($requiredCases, static fn (string $caseId): bool => isset($cases[$caseId])));
    $description = implode(', ', $requiredCases);
    if (is_string($gate['scenario_description'] ?? null)) {
        $description .= ', '.$gate['scenario_description'];
    }
    $proof = sprintf('%d/%d Abnahmen mit Laufbeleg', $passedCount, count($requiredCases));
    $requiredScenarios = $gate['required_scenarios'] ?? [];
    if ([] !== $requiredScenarios) {
        $scenarios = $verifiedPrimary && is_array($results['cases'] ?? null)
            ? array_column(array_filter($results['cases'], static fn (mixed $case): bool => is_array($case) && 'passed' === ($case['status'] ?? null) && !empty($case['observed_outcome'])), 'scenario_id')
            : [];
        $scenarioResult = [] === array_diff($requiredScenarios, $scenarios)
            ? ($gate['scenario_passed'] ?? 'Szenarien belegt')
            : ($gate['scenario_open'] ?? 'Browserbeleg der erforderlichen Szenarien offen');
        $proof .= ', '.$scenarioResult;
    }
    $gateException = $gate['exception'] ?? '—';
    if (!is_string($gateException)) {
        throw new RuntimeException(sprintf('Milestone %s has an invalid exception description.', $milestone));
    }
    $gateRows[] = sprintf('| %s | %s | %s | %s |', $milestone, $description, $proof, $gateException);
}
$report = implode("\n", [
    '# Anforderungszuordnung und Abnahmebelege',
    '',
    sprintf('Generiert am %s aus dem lokalen Abnahmestand und optionalen redigierten CI-Belegen.', gmdate(DATE_ATOM)),
    '',
    'Fehlende Laufbelege bleiben offen. Die Prüfung eines Pull Requests aus einem Fork bleibt auf ausdrückliche Nutzerentscheidung zurückgestellt.',
    '',
    '## Konzept-Gates',
    '',
    ...$gateRows,
    '',
    '## Laufbelege',
    '',
    ...$evidenceRows,
    '',
    '## Anforderungen',
    '',
    ...$rows,
    '',
    sprintf('Der aktuelle Abnahmeplan steht in [qa/acceptance/ACCEPTANCE.md](%sqa/acceptance/ACCEPTANCE.md); historische Release-Nachweise stehen unter [qa/evidence/](%sqa/evidence/README.md).', $repositoryPrefix, $repositoryPrefix),
    '',
]);
if (false === file_put_contents($reportPath, $report)) {
    throw new RuntimeException(sprintf('Could not write report output %s.', $reportPath));
}

fwrite(STDOUT, sprintf("Generated traceability for %d requirements. %d acceptance cases have verified hosted evidence.\n", count($requirements['requirements']), count($cases)));
