<?php

declare(strict_types=1);

$projectRoot = dirname(__DIR__);
$options = getopt('', ['output:', 'app-version:', 'revision:', 'debian-snapshot:', 'source-date-epoch:', 'frankenphp-image:']);
$option = static function (string $name, string $default) use ($options): string {
    $value = $options[$name] ?? $default;
    if (!is_string($value)) {
        throw new InvalidArgumentException(sprintf('The --%s option must be provided once with a string value.', $name));
    }

    return $value;
};
$versionFile = file_get_contents($projectRoot.'/version.txt');
if (false === $versionFile) {
    throw new RuntimeException('The application version file cannot be read.');
}

$outputDirectory = trim($option('output', '/usr/share/falkenwarte/image-audit'));
$appVersion = trim($option('app-version', $versionFile));
$revision = trim($option('revision', 'unknown'));
$debianSnapshot = trim($option('debian-snapshot', 'unknown'));
$baseImage = trim($option('frankenphp-image', ''));
$sourceDateEpoch = filter_var($option('source-date-epoch', '0'), FILTER_VALIDATE_INT);

if (false === $sourceDateEpoch || '' === $outputDirectory || '' === $appVersion || '' === $baseImage) {
    throw new RuntimeException('The output directory, application version, source date, and base image must be valid.');
}

/** @param list<string> $command */
$run = static function (array $command): string {
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($process)) {
        throw new RuntimeException(sprintf('Could not start command: %s', implode(' ', $command)));
    }
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $status = proc_close($process);
    if (0 !== $status || false === $stdout) {
        throw new RuntimeException(sprintf('Command failed (%d): %s %s', $status, implode(' ', $command), trim((string) $stderr)));
    }

    return trim($stdout);
};

/** @return array<string, mixed> */
$readJson = static function (string $path): array {
    $bytes = @file_get_contents($path);
    if (false === $bytes) {
        throw new RuntimeException(sprintf('Required inventory input is missing: %s', $path));
    }
    $value = json_decode($bytes, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($value)) {
        throw new RuntimeException(sprintf('Inventory input is not a JSON object: %s', $path));
    }

    return $value;
};

/** @param list<string> $names @return list<array{license: array{name: string}}> */
$licenseChoices = static function (array $names): array {
    $choices = [];
    foreach (array_values(array_unique(array_filter($names, static fn (mixed $name): bool => is_string($name) && '' !== trim($name)))) as $name) {
        $choices[] = ['license' => ['name' => trim($name)]];
    }

    return [] !== $choices ? $choices : [['license' => ['name' => 'NOASSERTION']]];
};

/** @param array<string, mixed> $component */
$componentLicenseNames = static function (array $component): array {
    $names = [];
    foreach ($component['licenses'] ?? [] as $choice) {
        $license = $choice['license'] ?? null;
        if (is_array($license)) {
            $name = $license['id'] ?? $license['name'] ?? $license['expression'] ?? null;
            if (is_string($name) && '' !== trim($name)) {
                $names[] = trim($name);
            }
        } elseif (is_string($choice['expression'] ?? null)) {
            $names[] = trim($choice['expression']);
        }
    }

    return array_values(array_unique($names));
};

/** @param list<string> $licenses @param list<array<string, mixed>> $references @param list<array<string, mixed>> $properties @return array<string, mixed> */
$makeComponent = static function (string $type, string $name, string $version, string $purl, array $licenses, array $references = [], array $properties = []) use ($licenseChoices): array {
    $component = [
        'type' => $type,
        'bom-ref' => $purl,
        'name' => $name,
        'version' => $version,
        'purl' => $purl,
        'licenses' => $licenseChoices($licenses),
    ];
    if ([] !== $references) {
        $component['externalReferences'] = $references;
    }
    if ([] !== $properties) {
        $component['properties'] = $properties;
    }

    return $component;
};

$npmInventory = $readJson('/tmp/falkenwarte-frontend-sbom.cdx.json');
$composerInventory = $readJson($projectRoot.'/vendor/composer/installed.json');
if (($npmInventory['bomFormat'] ?? null) !== 'CycloneDX' || !is_array($npmInventory['components'] ?? null)) {
    throw new RuntimeException('The frontend SBOM is missing or is not CycloneDX.');
}
if (!is_array($composerInventory['packages'] ?? null)) {
    throw new RuntimeException('Composer installed package metadata is missing.');
}

$components = [];
$ecosystemCounts = ['composer' => 0, 'npm' => 0, 'debian' => 0, 'embedded_go_modules' => 0];
$addComponent = static function (array $component) use (&$components): void {
    $reference = $component['bom-ref'] ?? null;
    if (!is_string($reference) || '' === $reference) {
        throw new RuntimeException('An SBOM component has no stable bom-ref.');
    }
    if (isset($components[$reference])) {
        throw new RuntimeException(sprintf('Duplicate SBOM component reference: %s', $reference));
    }
    $components[$reference] = $component;
};

$npmMissingLicenses = [];
foreach ($npmInventory['components'] as $component) {
    if (!is_array($component) || !is_string($component['name'] ?? null) || !is_string($component['version'] ?? null) || !is_string($component['purl'] ?? null)) {
        throw new RuntimeException('The frontend SBOM contains an incomplete dependency entry.');
    }
    if ([] === $componentLicenseNames($component)) {
        $npmMissingLicenses[] = $component['name'].'@'.$component['version'];
    }
    $component['type'] = is_string($component['type'] ?? null) ? $component['type'] : 'library';
    $component['bom-ref'] = is_string($component['bom-ref'] ?? null) ? $component['bom-ref'] : $component['purl'];
    $component['properties'] = array_values(array_merge($component['properties'] ?? [], [['name' => 'falkenwarte:ecosystem', 'value' => 'npm-production']]));
    $addComponent($component);
    ++$ecosystemCounts['npm'];
}
if ([] !== $npmMissingLicenses) {
    throw new RuntimeException('Production npm packages have no license metadata: '.implode(', ', $npmMissingLicenses));
}

$composerPackages = [];
$composerMissingLicenses = [];
foreach ($composerInventory['packages'] as $package) {
    if (!is_array($package) || !is_string($package['name'] ?? null) || !is_string($package['version'] ?? null)) {
        throw new RuntimeException('Composer installed metadata contains an incomplete package entry.');
    }
    $name = strtolower($package['name']);
    $version = ltrim($package['version'], 'v');
    $licenses = array_values(array_filter($package['license'] ?? [], static fn (mixed $license): bool => is_string($license) && '' !== trim($license)));
    if ([] === $licenses) {
        $composerMissingLicenses[] = $name.'@'.$version;
    }
    $purl = 'pkg:composer/'.$name.'@'.rawurlencode($version);
    $references = [];
    foreach (['homepage' => 'website', 'source' => 'vcs', 'dist' => 'distribution'] as $field => $type) {
        $url = is_string($package[$field] ?? null) ? $package[$field] : ($package[$field]['url'] ?? null);
        if (is_string($url) && '' !== $url) {
            $references[] = ['type' => $type, 'url' => $url];
        }
    }
    $properties = [
        ['name' => 'falkenwarte:ecosystem', 'value' => 'composer-production'],
    ];
    $sourceReference = $package['source']['reference'] ?? null;
    if (is_string($sourceReference) && '' !== $sourceReference) {
        $properties[] = ['name' => 'falkenwarte:source-reference', 'value' => $sourceReference];
    }
    $composerPackages[$name] = ['version' => $version, 'licenses' => $licenses];
    $addComponent($makeComponent('library', $name, $version, $purl, $licenses, $references, $properties));
    ++$ecosystemCounts['composer'];
}
if ([] !== $composerMissingLicenses) {
    throw new RuntimeException('Production Composer packages have no license metadata: '.implode(', ', $composerMissingLicenses));
}

foreach (['symfony/mercure' => '0.10.0', 'symfony/mercure-bundle' => '0.7.0'] as $name => $expectedVersion) {
    $package = $composerPackages[$name] ?? null;
    if (!is_array($package) || $package['version'] !== $expectedVersion || !in_array('MIT', $package['licenses'], true)) {
        throw new RuntimeException(sprintf('Expected %s %s with MIT license in the production Composer inventory.', $name, $expectedVersion));
    }
}

$frankenphpText = $run(['frankenphp', 'version']);
if (1 !== preg_match('/FrankenPHP\s+v?([^\s]+)\s+PHP\s+([^\s]+)\s+Caddy\s+v?([^\s]+)/', $frankenphpText, $frankenphpMatch)) {
    throw new RuntimeException('Could not read FrankenPHP, PHP, and Caddy versions from the image.');
}
$frankenphpVersion = 'v'.$frankenphpMatch[1];
$phpVersion = $frankenphpMatch[2];
$caddyVersion = 'v'.$frankenphpMatch[3];
if (PHP_VERSION !== $phpVersion || version_compare(PHP_VERSION, '8.5.0', '<')) {
    throw new RuntimeException(sprintf('The reported PHP version %s does not match the PHP runtime %s.', $phpVersion, PHP_VERSION));
}

$loadedExtensions = array_map('strtolower', get_loaded_extensions());
foreach (['intl', 'pcntl', 'pdo_sqlite', 'sodium', 'sqlite3', 'zip'] as $requiredExtension) {
    if (!in_array($requiredExtension, $loadedExtensions, true)) {
        throw new RuntimeException(sprintf('Required PHP extension %s is not loaded.', $requiredExtension));
    }
}
$sqlite3Version = SQLite3::version()['versionString'] ?? null;
$pdo = new PDO('sqlite::memory:');
$pdoSqliteVersion = (string) $pdo->query('SELECT sqlite_version()')->fetchColumn();
if (!is_string($sqlite3Version) || '3.51.3' !== $sqlite3Version || '3.51.3' !== $pdoSqliteVersion) {
    throw new RuntimeException(sprintf('Expected SQLite3 and PDO SQLite 3.51.3, got %s and %s.', (string) $sqlite3Version, $pdoSqliteVersion));
}

$moduleInventory = json_decode($run(['frankenphp', 'list-modules', '--json']), true, 512, JSON_THROW_ON_ERROR);
if (!is_array($moduleInventory)) {
    throw new RuntimeException('FrankenPHP did not return its embedded module inventory.');
}
$mercureVersions = [];
$caddyModuleVersions = [];
$goPackages = [];
foreach ($moduleInventory as $module) {
    if (!is_array($module) || !is_string($module['package_url'] ?? null) || !is_string($module['version'] ?? null)) {
        continue;
    }
    $packagePath = $module['package_url'];
    $version = $module['version'];
    if (str_starts_with($packagePath, 'github.com/dunglas/mercure/')) {
        $mercureVersions[$version] = true;
    }
    if ('github.com/caddyserver/caddy/v2' === $packagePath) {
        $caddyModuleVersions[$version] = true;
    }
    if (!str_starts_with($packagePath, 'github.com/')) {
        continue;
    }
    $key = $packagePath.'@'.$version;
    $goPackages[$key] = ['path' => $packagePath, 'version' => $version];
}
if (['v1.1.6' => true] !== $mercureVersions) {
    throw new RuntimeException('The embedded Mercure modules must all report version v1.1.6.');
}
if (['v'.ltrim($caddyVersion, 'v') => true] !== $caddyModuleVersions) {
    throw new RuntimeException('The embedded Caddy module version does not match the FrankenPHP runtime report.');
}

$goLicenseByPath = [
    'github.com/caddyserver/caddy/v2' => 'Apache-2.0',
    'github.com/dunglas/frankenphp' => 'MIT',
    'github.com/dunglas/mercure/caddy' => 'AGPL-3.0',
];
if (!isset($goPackages['github.com/dunglas/mercure/caddy@v1.1.6'])) {
    throw new RuntimeException('The embedded Mercure Go package is absent from the software inventory.');
}
ksort($goPackages, SORT_STRING);
foreach ($goPackages as $goPackage) {
    $path = $goPackage['path'];
    $version = $goPackage['version'];
    $purl = 'pkg:golang/'.$path.'@'.rawurlencode($version);
    $license = $goLicenseByPath[$path] ?? 'NOASSERTION';
    $addComponent($makeComponent(
        'library',
        $path,
        $version,
        $purl,
        [$license],
        [['type' => 'vcs', 'url' => 'https://'.$path]],
        [['name' => 'falkenwarte:ecosystem', 'value' => 'embedded-go-module']],
    ));
    ++$ecosystemCounts['embedded_go_modules'];
}

$phpPurl = 'pkg:generic/php@'.rawurlencode(PHP_VERSION);
$addComponent($makeComponent('framework', 'PHP', PHP_VERSION, $phpPurl, ['PHP License 3.01'], [['type' => 'website', 'url' => 'https://www.php.net/license/3_01.txt']], [['name' => 'falkenwarte:ecosystem', 'value' => 'runtime']]));
$frankenphpPurl = 'pkg:generic/frankenphp@'.rawurlencode($frankenphpVersion);
$addComponent($makeComponent('application', 'FrankenPHP', $frankenphpVersion, $frankenphpPurl, ['MIT'], [['type' => 'website', 'url' => 'https://frankenphp.dev/']], [
    ['name' => 'falkenwarte:base-image', 'value' => $baseImage],
    ['name' => 'falkenwarte:ecosystem', 'value' => 'runtime'],
]));
$sqlitePurl = 'pkg:generic/sqlite@'.rawurlencode($sqlite3Version);
$addComponent($makeComponent('library', 'SQLite', $sqlite3Version, $sqlitePurl, ['Public domain'], [['type' => 'website', 'url' => 'https://sqlite.org/copyright.html']], [['name' => 'falkenwarte:ecosystem', 'value' => 'runtime-source-build']]));

$osRelease = [];
foreach (file('/etc/os-release', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
    if (str_contains($line, '=')) {
        [$key, $value] = explode('=', $line, 2);
        $osRelease[$key] = trim($value, "\"'");
    }
}
$dpkgOutput = $run(['dpkg-query', '-W', '-f=${db:Status-Status}\t${Package}\t${Version}\t${Architecture}\n']);
foreach (preg_split('/\r?\n/', $dpkgOutput) ?: [] as $line) {
    if ('' === $line) {
        continue;
    }
    $fields = explode("\t", $line);
    if (4 !== count($fields) || 'installed' !== $fields[0]) {
        continue;
    }
    [, $package, $version, $architecture] = $fields;
    if ('' === $package || '' === $version || '' === $architecture) {
        continue;
    }
    $packagePath = preg_replace('/:[a-z0-9]+$/i', '', $package) ?: $package;
    $copyrightPath = '/usr/share/doc/'.$packagePath.'/copyright';
    $licenses = [];
    $copyrightBytes = @file_get_contents($copyrightPath);
    if (is_string($copyrightBytes)) {
        foreach (preg_split('/\r?\n/', $copyrightBytes) ?: [] as $copyrightLine) {
            if (preg_match('/^License:\s*(\S.*)$/', $copyrightLine, $match)) {
                $licenseName = trim($match[1]);
                if ('' !== $licenseName && strlen($licenseName) <= 200) {
                    $licenses[] = $licenseName;
                }
            }
        }
    }
    $licenses = array_values(array_unique($licenses));
    if ([] === $licenses) {
        $licenses = ['NOASSERTION'];
    }
    $purl = 'pkg:deb/debian/'.rawurlencode($packagePath).'@'.rawurlencode($version).'?arch='.rawurlencode($architecture).'&distro='.rawurlencode((string) ($osRelease['VERSION_CODENAME'] ?? 'unknown'));
    $addComponent($makeComponent('library', $package, $version, $purl, $licenses, [], [
        ['name' => 'falkenwarte:ecosystem', 'value' => 'debian-runtime'],
        ['name' => 'falkenwarte:debian-copyright-file', 'value' => $copyrightPath],
        ['name' => 'falkenwarte:architecture', 'value' => $architecture],
    ]));
    ++$ecosystemCounts['debian'];
}

$componentList = array_values($components);
usort($componentList, static fn (array $left, array $right): int => strcmp((string) $left['bom-ref'], (string) $right['bom-ref']));
$rootPurl = 'pkg:generic/falkenwarte@'.rawurlencode($appVersion);
$identity = hash('sha256', $revision.'|'.$appVersion.'|'.implode('|', array_column($componentList, 'bom-ref')));
$uuid = substr($identity, 0, 12).'5'.substr($identity, 13, 3).'a'.substr($identity, 17, 15);
$created = (new DateTimeImmutable('@'.$sourceDateEpoch))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
$sbom = [
    'bomFormat' => 'CycloneDX',
    'specVersion' => '1.5',
    'serialNumber' => 'urn:uuid:'.$uuid,
    'version' => 1,
    'metadata' => [
        'timestamp' => $created,
        'tools' => [['vendor' => 'Falkenwarte', 'name' => 'build-image-inventory.php', 'version' => '1.0.0']],
        'component' => [
            'type' => 'application',
            'bom-ref' => $rootPurl,
            'name' => 'Falkenwarte',
            'version' => $appVersion,
            'purl' => $rootPurl,
            'externalReferences' => [['type' => 'vcs', 'url' => 'https://github.com/DZunke/Falkenwarte']],
            'properties' => [
                ['name' => 'falkenwarte:build:revision', 'value' => $revision],
                ['name' => 'falkenwarte:build:debian-snapshot', 'value' => $debianSnapshot],
                ['name' => 'falkenwarte:runtime:architecture', 'value' => php_uname('m')],
            ],
        ],
    ],
    'components' => $componentList,
];
$sbomBytes = json_encode($sbom, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";

$licenseSummary = [];
$componentsWithoutLicense = 0;
$notices = [];
foreach ($componentList as $component) {
    $licenses = $componentLicenseNames($component);
    if ([] === $licenses || in_array('NOASSERTION', $licenses, true)) {
        ++$componentsWithoutLicense;
    }
    foreach ([] !== $licenses ? $licenses : ['NOASSERTION'] as $license) {
        $licenseSummary[$license] = ($licenseSummary[$license] ?? 0) + 1;
    }
    $source = '';
    foreach ($component['externalReferences'] ?? [] as $reference) {
        if (in_array($reference['type'] ?? null, ['website', 'vcs', 'distribution'], true) && is_string($reference['url'] ?? null)) {
            $source = $reference['url'];
            break;
        }
    }
    if ('' === $source) {
        $source = (string) ($component['purl'] ?? '');
    }
    $notices[] = sprintf('%s@%s | %s | %s', (string) $component['name'], (string) $component['version'], implode(', ', $licenses ?: ['NOASSERTION']), $source);
}
ksort($licenseSummary, SORT_STRING);
sort($notices, SORT_STRING);

$runtimeExtensions = array_values(array_filter($loadedExtensions, static fn (string $extension): bool => in_array($extension, ['intl', 'pcntl', 'pdo_sqlite', 'sodium', 'sqlite3', 'zip'], true)));
sort($runtimeExtensions, SORT_STRING);
$runtimeEvidence = [
    'format' => 'falkenwarte.image-inventory.v1',
    'application' => ['name' => 'Falkenwarte', 'version' => $appVersion, 'revision' => $revision],
    'build' => ['debian_snapshot' => $debianSnapshot, 'source_date_epoch' => $sourceDateEpoch],
    'runtime' => [
        'architecture' => php_uname('m'),
        'os_id' => $osRelease['ID'] ?? null,
        'os_version' => $osRelease['VERSION_ID'] ?? null,
        'frankenphp' => $frankenphpVersion,
        'php' => PHP_VERSION,
        'caddy' => $caddyVersion,
        'mercure' => 'v1.1.6',
        'mercure_license' => 'AGPL-3.0',
        'sqlite3' => $sqlite3Version,
        'pdo_sqlite' => $pdoSqliteVersion,
        'required_php_extensions' => $runtimeExtensions,
        'intl_icu' => defined('INTL_ICU_VERSION') ? INTL_ICU_VERSION : null,
        'zip_libzip' => defined(ZipArchive::class.'::LIBZIP_VERSION') ? ZipArchive::LIBZIP_VERSION : null,
        'base_image' => $baseImage,
    ],
    'inventory' => [
        'format' => 'CycloneDX 1.5',
        'components' => count($componentList),
        'ecosystem_counts' => $ecosystemCounts,
        'components_with_unasserted_license' => $componentsWithoutLicense,
        'license_component_counts' => $licenseSummary,
        'missing_npm_licenses' => count($npmMissingLicenses),
        'missing_composer_licenses' => count($composerMissingLicenses),
        'sbom_sha256' => hash('sha256', $sbomBytes),
    ],
];

if (!is_dir($outputDirectory) && !mkdir($outputDirectory, 0755, true) && !is_dir($outputDirectory)) {
    throw new RuntimeException(sprintf('Could not create inventory output directory: %s', $outputDirectory));
}
if (false === file_put_contents($outputDirectory.'/sbom.cdx.json', $sbomBytes)) {
    throw new RuntimeException('Could not write CycloneDX SBOM.');
}
$noticeBytes = "Falkenwarte third-party software inventory\nApplication: {$appVersion}\nRevision: {$revision}\nSBOM: sbom.cdx.json (CycloneDX 1.5)\n\nComponent | Version | License metadata | Source\n".implode("\n", $notices)."\n";
if (false === file_put_contents($outputDirectory.'/THIRD-PARTY-NOTICES.txt', $noticeBytes)) {
    throw new RuntimeException('Could not write third-party attribution list.');
}
$runtimeBytes = json_encode($runtimeEvidence, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
if (false === file_put_contents($outputDirectory.'/runtime-evidence.json', $runtimeBytes)) {
    throw new RuntimeException('Could not write compact runtime evidence.');
}

fwrite(STDOUT, sprintf(
    "Image inventory: %d components (%d Composer, %d npm, %d Debian, %d embedded Go); Mercure %s; SQLite %s; %d components without asserted license metadata.\n",
    count($componentList),
    $ecosystemCounts['composer'],
    $ecosystemCounts['npm'],
    $ecosystemCounts['debian'],
    $ecosystemCounts['embedded_go_modules'],
    'v1.1.6',
    $sqlite3Version,
    $componentsWithoutLicense,
));
