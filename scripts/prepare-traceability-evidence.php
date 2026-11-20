<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$options = [];
$supportedOptions = ['run', 'acceptance', 'production-boot', 'production-restart', 'a31', 'output'];
foreach (array_slice($_SERVER['argv'] ?? [], 1) as $argument) {
    if (!str_starts_with($argument, '--') || !str_contains($argument, '=')) {
        throw new InvalidArgumentException(sprintf('Expected --name=value, got %s.', $argument));
    }
    [$name, $value] = explode('=', substr($argument, 2), 2);
    if ('' === $name || '' === $value || isset($options[$name])) {
        throw new InvalidArgumentException(sprintf('Invalid or repeated option %s.', $name));
    }
    if (!in_array($name, $supportedOptions, true)) {
        throw new InvalidArgumentException(sprintf('Unknown option --%s.', $name));
    }
    $options[$name] = $value;
}

foreach (['run', 'acceptance', 'production-boot', 'production-restart'] as $requiredOption) {
    if (!isset($options[$requiredOption])) {
        throw new InvalidArgumentException(sprintf('Missing required option --%s=PATH.', $requiredOption));
    }
}

$outputPath = $options['output'] ?? $root.'/var/ci-evidence/verification.json';
$readJson = static function (string $path): array {
    if (!is_file($path)) {
        throw new RuntimeException(sprintf('Evidence input does not exist: %s', $path));
    }
    $value = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($value)) {
        throw new RuntimeException(sprintf('Evidence input is not a JSON object: %s', $path));
    }

    return $value;
};
$acceptanceSpecificationPath = $root.'/qa/acceptance/ACCEPTANCE.md';
$acceptanceSpecification = is_file($acceptanceSpecificationPath) ? (string) file_get_contents($acceptanceSpecificationPath) : '';
preg_match_all('/^##\s+(A\d{2,})\s+-/m', $acceptanceSpecification, $acceptanceMatches);
$knownAcceptanceIds = array_fill_keys($acceptanceMatches[1], true);
if ([] === $knownAcceptanceIds) {
    throw new RuntimeException('The current QA acceptance specification contains no cases.');
}
$get = static function (array $record, string $camel, ?string $snake = null): mixed {
    return $record[$camel] ?? (null === $snake ? null : ($record[$snake] ?? null));
};
$validSha = static fn (mixed $value): bool => is_string($value) && 1 === preg_match('/^[a-f0-9]{40}$/i', $value);
$validImage = static fn (mixed $value): bool => is_string($value) && 1 === preg_match('/^sha256:[a-f0-9]{64}$/i', $value);
$validUrl = static function (mixed $value): bool {
    if (!is_string($value)) {
        return false;
    }
    $parts = parse_url($value);

    return is_array($parts)
        && ($parts['scheme'] ?? '') === 'https'
        && isset($parts['host'])
        && !isset($parts['user'])
        && !isset($parts['pass']);
};
$readUrl = static function (mixed $value, string $fallback = '') use ($validUrl): ?string {
    if ($validUrl($value)) {
        return $value;
    }

    return $validUrl($fallback) ? $fallback : null;
};
$unique = static fn (array $values): array => array_values(array_unique(array_filter($values, static fn (mixed $value): bool => is_string($value) && '' !== $value)));
$hasObservation = static function (array $case): bool {
    $observations = $case['observed_outcome'] ?? null;
    if (is_string($observations)) {
        return '' !== trim($observations);
    }
    if (!is_array($observations)) {
        return false;
    }

    foreach ($observations as $observation) {
        if (is_string($observation) && '' !== trim($observation)) {
            return true;
        }
    }

    return false;
};
$passedCase = static fn (array $case): bool => ($case['status'] ?? null) === 'passed'
    && ($case['coverage'] ?? 'complete') === 'complete'
    && $hasObservation($case);

$run = $readJson($options['run']);
$acceptance = $readJson($options['acceptance']);
$productionBoot = $readJson($options['production-boot']);
$productionRestart = $readJson($options['production-restart']);
$reportedAcceptanceIds = [];
$reportedCases = $acceptance['cases'] ?? [];
if (!is_array($reportedCases)) {
    throw new RuntimeException('Browser evidence cases must be an array.');
}
foreach ($reportedCases as $case) {
    if (!is_array($case) || !is_string($case['acceptance_id'] ?? null) || !isset($knownAcceptanceIds[$case['acceptance_id']])) {
        throw new RuntimeException(sprintf('Browser evidence references unknown acceptance case %s.', (string) ($case['acceptance_id'] ?? null)));
    }
    if (isset($reportedAcceptanceIds[$case['acceptance_id']])) {
        throw new RuntimeException(sprintf('Browser evidence duplicates acceptance case %s.', $case['acceptance_id']));
    }
    $reportedAcceptanceIds[$case['acceptance_id']] = true;
}
$runId = $get($run, 'databaseId', 'run_id');
$runSha = $get($run, 'headSha', 'head_sha');
$runUrl = $readUrl($get($run, 'htmlUrl', 'html_url'), $readUrl($get($run, 'url')) ?? '');
$runConclusion = $get($run, 'conclusion');
$runStatus = $get($run, 'status');
$jobs = [];
foreach ($run['jobs'] ?? [] as $job) {
    if (!is_array($job) || !is_string($job['name'] ?? null)) {
        continue;
    }
    $jobs[$job['name']] = $job;
}

$requiredJobs = ['commit-policy', 'static-quality', 'docs-quality', 'background-functional', 'build', 'e2e', 'quality-gate'];
$jobResults = [];
$allJobsPassed = true;
foreach ($requiredJobs as $name) {
    $job = $jobs[$name] ?? [];
    $status = $get($job, 'status');
    $conclusion = $get($job, 'conclusion');
    $jobUrl = $readUrl($get($job, 'htmlUrl', 'html_url'), $readUrl($get($job, 'url'), $runUrl ?? '') ?? '');
    if (is_string($jobUrl) && 'api.github.com' === parse_url($jobUrl, PHP_URL_HOST)) {
        $jobUrl = $runUrl;
    }
    $passed = 'success' === $conclusion && (null === $status || 'completed' === $status) && null !== $jobUrl;
    $jobResults[$name] = [
        'status' => $passed ? 'passed' : 'unverified',
        'conclusion' => is_string($conclusion) ? $conclusion : null,
        'source_url' => $jobUrl,
    ];
    $allJobsPassed = $allJobsPassed && $passed;
}

$primaryCommit = $acceptance['commit'] ?? null;
$primaryImage = $acceptance['image'] ?? null;
$primaryFixture = $acceptance['fixture_version'] ?? null;
$primaryPassed = ($acceptance['format'] ?? null) === 'falkenwarte.acceptance-evidence.v1'
    && ($acceptance['overall_status'] ?? null) === 'passed'
    && $validSha($primaryCommit)
    && $validImage($primaryImage)
    && is_string($primaryFixture)
    && '' !== trim($primaryFixture)
    && 'success' === $runConclusion
    && (null === $runStatus || 'completed' === $runStatus)
    && $allJobsPassed
    && is_string($runSha)
    && strtolower($runSha) === strtolower($primaryCommit);

$workflowUrl = $runUrl;
$primary = [
    'status' => $primaryPassed ? 'passed' : 'unverified',
    'commit' => $validSha($primaryCommit) ? $primaryCommit : null,
    'image' => $validImage($primaryImage) ? $primaryImage : null,
    'fixture_version' => is_string($primaryFixture) && '' !== trim($primaryFixture) ? $primaryFixture : null,
    'workflow_run_id' => is_int($runId) || is_string($runId) ? $runId : null,
    'workflow_conclusion' => is_string($runConclusion) ? $runConclusion : null,
    'workflow_url' => $workflowUrl,
    'jobs' => $jobResults,
];

$cases = [];
if ($primaryPassed && is_array($acceptance['cases'] ?? null) && null !== $workflowUrl) {
    $e2eUrl = $jobResults['e2e']['source_url'] ?? $workflowUrl;
    foreach ($acceptance['cases'] as $case) {
        if (!is_array($case) || !$passedCase($case)) {
            continue;
        }
        $acceptanceId = $case['acceptance_id'] ?? null;
        if (in_array($acceptanceId, ['A03', 'A05', 'A19', 'A31'], true)) {
            continue;
        }
        $cases[$acceptanceId] = [
            'status' => 'passed',
            'evidence_kind' => 'hosted_browser_acceptance',
            'commit' => $primaryCommit,
            'image' => $primaryImage,
            'fixture_version' => $primaryFixture,
            'source_urls' => [$e2eUrl],
            'observed_outcome' => $case['observed_outcome'],
        ];
    }

    foreach (['A03' => 'static-quality', 'A05' => 'background-functional'] as $acceptanceId => $jobName) {
        $cases[$acceptanceId] = [
            'status' => 'passed',
            'evidence_kind' => $jobName,
            'commit' => $primaryCommit,
            'image' => $primaryImage,
            'fixture_version' => $primaryFixture,
            'source_urls' => $unique([$jobResults[$jobName]['source_url'] ?? null, $workflowUrl]),
        ];
    }

    $validProductionReports = true;
    foreach ([$productionBoot, $productionRestart] as $productionReport) {
        $productionCase = null;
        foreach ($productionReport['cases'] ?? [] as $case) {
            if (is_array($case) && ($case['acceptance_id'] ?? null) === 'A19') {
                $productionCase = $case;
                break;
            }
        }
        $validProductionReports = $validProductionReports
            && ($productionReport['format'] ?? null) === 'falkenwarte.acceptance-evidence.v1'
            && ($productionReport['overall_status'] ?? null) === 'passed'
            && ($productionReport['commit'] ?? null) === $primaryCommit
            && ($productionReport['image'] ?? null) === $primaryImage
            && ($productionReport['fixture_version'] ?? null) === $primaryFixture
            && is_array($productionCase)
            && $passedCase($productionCase);
    }
    if ($validProductionReports) {
        $cases['A19'] = [
            'status' => 'passed',
            'evidence_kind' => 'production_boot_and_restart',
            'commit' => $primaryCommit,
            'image' => $primaryImage,
            'fixture_version' => $primaryFixture,
            'source_urls' => [$workflowUrl],
            'phases' => [
                ['name' => 'boot', 'status' => 'passed'],
                ['name' => 'restart', 'status' => 'passed'],
            ],
        ];
    }
}

$a31 = [
    'status' => 'unverified',
    'fork_verification' => 'deferred',
    'checks' => [],
    'source_urls' => [],
];
if (isset($options['a31'])) {
    $delivery = $readJson($options['a31']);
    $requiredChecks = ['normal_pr', 'docs_quality', 'release_pr', 'fail_probe', 'skip_probe', 'release'];
    $checkResults = [];
    $allChecksPassed = ($delivery['format'] ?? null) === 'falkenwarte.github-delivery-evidence.v1';
    foreach ($requiredChecks as $name) {
        $check = $delivery['checks'][$name] ?? [];
        $url = $readUrl($check['url'] ?? null);
        $valid = null !== $url;
        if (in_array($name, ['normal_pr', 'docs_quality', 'release_pr'], true)) {
            $sha = $check['head_sha'] ?? null;
            $valid = $valid && $validSha($sha) && ($check['conclusion'] ?? null) === 'success';
            if (in_array($name, ['normal_pr', 'release_pr'], true)) {
                $valid = $valid && ($check['quality_gate_conclusion'] ?? null) === 'success';
            }
            if ('release_pr' === $name) {
                $valid = $valid
                    && $validSha($check['dispatch_expected_sha'] ?? null)
                    && $validSha($check['checked_out_sha'] ?? null)
                    && $check['dispatch_expected_sha'] === $sha
                    && $check['checked_out_sha'] === $sha;
            }
        } elseif ('fail_probe' === $name) {
            $valid = $valid
                && $validSha($check['head_sha'] ?? null)
                && ($check['workflow_conclusion'] ?? null) === 'failure'
                && ($check['quality_gate_conclusion'] ?? null) === 'failure'
                && ($check['e2e_conclusion'] ?? null) === 'failure';
        } elseif ('skip_probe' === $name) {
            $valid = $valid
                && $validSha($check['head_sha'] ?? null)
                && ($check['workflow_conclusion'] ?? null) === 'failure'
                && ($check['quality_gate_conclusion'] ?? null) === 'failure'
                && ($check['e2e_conclusion'] ?? null) === 'skipped';
        } elseif ('release' === $name) {
            $tagCommit = $check['tag_commit'] ?? null;
            $testedCommit = $check['tested_commit'] ?? null;
            $imageRevision = $check['image_revision'] ?? null;
            $digest = $check['image_digest'] ?? null;
            $valid = $valid
                && ($check['conclusion'] ?? null) === 'success'
                && $validSha($tagCommit)
                && $tagCommit === $testedCommit
                && $tagCommit === $imageRevision
                && is_string($digest)
                && 1 === preg_match('/(?:^|@)sha256:[a-f0-9]{64}$/i', $digest);
        }
        $checkResults[$name] = [
            'status' => $valid ? 'passed' : 'unverified',
            'source_url' => $url,
            'conclusion' => $check['conclusion'] ?? null,
            'head_sha' => isset($check['head_sha']) && $validSha($check['head_sha']) ? $check['head_sha'] : null,
            'dispatch_expected_sha' => isset($check['dispatch_expected_sha']) && $validSha($check['dispatch_expected_sha']) ? $check['dispatch_expected_sha'] : null,
            'checked_out_sha' => isset($check['checked_out_sha']) && $validSha($check['checked_out_sha']) ? $check['checked_out_sha'] : null,
            'workflow_conclusion' => $check['workflow_conclusion'] ?? null,
            'quality_gate_conclusion' => $check['quality_gate_conclusion'] ?? null,
            'e2e_conclusion' => $check['e2e_conclusion'] ?? null,
            'tag_commit' => isset($check['tag_commit']) && $validSha($check['tag_commit']) ? $check['tag_commit'] : null,
            'tested_commit' => isset($check['tested_commit']) && $validSha($check['tested_commit']) ? $check['tested_commit'] : null,
            'image_revision' => isset($check['image_revision']) && $validSha($check['image_revision']) ? $check['image_revision'] : null,
            'image_digest' => isset($check['image_digest']) && is_string($check['image_digest']) ? $check['image_digest'] : null,
        ];
        $allChecksPassed = $allChecksPassed && $valid;
    }
    $a31Sources = array_map(static fn (array $check): ?string => $check['source_url'], $checkResults);
    $a31 = [
        'status' => $allChecksPassed ? 'passed' : 'unverified',
        'fork_verification' => 'deferred',
        'checks' => $checkResults,
        'source_urls' => $unique($a31Sources),
    ];
    if ($allChecksPassed) {
        $cases['A31'] = [
            'status' => 'passed',
            'evidence_kind' => 'hosted_github_delivery',
            'source_urls' => $a31['source_urls'],
            'checks' => $checkResults,
            'fork_verification' => 'deferred',
        ];
    }
}

$document = [
    'format' => 'falkenwarte.traceability-verification.v1',
    'generated_at' => gmdate(DATE_ATOM),
    'primary' => $primary,
    'cases' => $cases,
    'a31' => $a31,
];
$directory = dirname($outputPath);
if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
    throw new RuntimeException(sprintf('Could not create output directory %s.', $directory));
}
if (false === file_put_contents($outputPath, json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n")) {
    throw new RuntimeException(sprintf('Could not write verification output %s.', $outputPath));
}

fwrite(STDOUT, sprintf(
    "Prepared traceability evidence: primary %s, %d accepted cases, A31 %s (fork check deferred).\n",
    $primary['status'],
    count($cases),
    $a31['status'],
));
