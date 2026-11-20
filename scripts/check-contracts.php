<?php

declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';

use Opis\JsonSchema\Parsers\SchemaParser;
use Opis\JsonSchema\Resolvers\SchemaResolver;
use Opis\JsonSchema\SchemaLoader;
use Opis\JsonSchema\Validator;
use Symfony\Component\Yaml\Yaml;

$root = dirname(__DIR__);
$errors = [];
$openApiPath = $root.'/contracts/openapi.yaml';
$openApi = Yaml::parseFile($openApiPath);
$mcp = json_decode((string) file_get_contents($root.'/contracts/mcp-tools.json'), true, 512, JSON_THROW_ON_ERROR);

if (!isset($openApi['openapi']) || !str_starts_with((string) $openApi['openapi'], '3.1.')) {
    $errors[] = 'The public API contract must use OpenAPI 3.1.';
}

/** @return mixed */
$resolvePointer = static function (array $document, string $reference): mixed {
    if (!str_starts_with($reference, '#/')) {
        throw new InvalidArgumentException(sprintf('Only local references are supported, got %s', $reference));
    }

    $value = $document;
    foreach (explode('/', substr($reference, 2)) as $segment) {
        $key = str_replace(['~1', '~0'], ['/', '~'], $segment);
        if (!is_array($value) || !array_key_exists($key, $value)) {
            throw new InvalidArgumentException(sprintf('Unresolved reference %s', $reference));
        }
        $value = $value[$key];
    }

    return $value;
};

$resolveReference = static function (string $reference) use ($resolvePointer, $openApi, $root): mixed {
    if (str_starts_with($reference, '#/')) {
        return $resolvePointer($openApi, $reference);
    }

    [$filePath, $fragment] = array_pad(explode('#', $reference, 2), 2, '');
    if ('openapi.yaml' === $filePath) {
        return '' === $fragment ? $openApi : $resolvePointer($openApi, '#'.$fragment);
    }
    $targetPath = realpath($root.'/contracts/'.$filePath);
    $contractsPath = realpath($root.'/contracts');
    if (false === $targetPath || false === $contractsPath || !str_starts_with($targetPath, $contractsPath.DIRECTORY_SEPARATOR)) {
        throw new InvalidArgumentException(sprintf('Unresolved local reference %s', $reference));
    }

    $target = json_decode((string) file_get_contents($targetPath), true, 512, JSON_THROW_ON_ERROR);
    if ('' === $fragment) {
        return $target;
    }

    return $resolvePointer($target, '#'.$fragment);
};

$walk = static function (mixed $value, callable $visit) use (&$walk): void {
    if (!is_array($value)) {
        return;
    }

    foreach ($value as $key => $child) {
        if ('$ref' === $key && is_string($child)) {
            $visit($child);
        } else {
            $walk($child, $visit);
        }
    }
};

$walk($openApi, static function (string $reference) use ($resolveReference, &$errors): void {
    try {
        $resolveReference($reference);
    } catch (Throwable $exception) {
        $errors[] = $exception->getMessage();
    }
});

$operations = [];
foreach ($openApi['paths'] ?? [] as $path => $pathItem) {
    foreach ($pathItem as $method => $operation) {
        if (!is_array($operation) || !isset($operation['operationId'])) {
            continue;
        }
        $operationId = $operation['operationId'];
        if (isset($operations[$operationId])) {
            $errors[] = sprintf('Duplicate OpenAPI operationId %s.', $operationId);
        }
        $operations[$operationId] = [strtoupper((string) $method), $path];
    }
}

$schemaResolver = new SchemaResolver();
$schemaResolver->registerFile(
    'https://falkenwarte.local/schemas/event-envelope.schema.json',
    $root.'/contracts/schemas/event-envelope.schema.json',
);
$validator = new Validator(new SchemaLoader(new SchemaParser(), $schemaResolver, true));
$mergeExamples = static function (object $target, object $addition) use (&$mergeExamples): void {
    foreach (get_object_vars($addition) as $key => $value) {
        if (isset($target->{$key}) && is_object($target->{$key}) && is_object($value)) {
            $mergeExamples($target->{$key}, $value);
            continue;
        }
        $target->{$key} = $value;
    }
};
$exampleForSchema = static function (object $schema) use (&$exampleForSchema, $mergeExamples): mixed {
    if (isset($schema->const)) {
        return $schema->const;
    }
    if (isset($schema->enum[0])) {
        return $schema->enum[0];
    }
    $type = $schema->type ?? null;
    if ('object' !== $type) {
        foreach (['anyOf', 'oneOf', 'allOf'] as $composition) {
            if (isset($schema->{$composition}[0]) && is_object($schema->{$composition}[0])) {
                return $exampleForSchema($schema->{$composition}[0]);
            }
        }
    }
    if (is_array($type)) {
        $type = in_array('null', $type, true) ? 'null' : $type[0];
    }
    if (null === $type && (isset($schema->required) || isset($schema->properties))) {
        $type = 'object';
    }
    if ('object' === $type) {
        $result = new stdClass();
        foreach ($schema->required ?? [] as $key) {
            $result->{$key} = $exampleForSchema($schema->properties->{$key} ?? new stdClass());
        }

        foreach (['anyOf', 'oneOf'] as $composition) {
            if (isset($schema->{$composition}[0]) && is_object($schema->{$composition}[0])) {
                $mergeExamples($result, $exampleForSchema($schema->{$composition}[0]));
            }
        }

        foreach ($schema->allOf ?? [] as $branch) {
            if (isset($branch->else) && is_object($branch->else)) {
                $mergeExamples($result, $exampleForSchema($branch->else));
            } elseif (!isset($branch->if) && is_object($branch)) {
                $mergeExamples($result, $exampleForSchema($branch));
            }
        }

        return $result;
    }
    if ('array' === $type) {
        $items = $exampleForSchema($schema->items ?? new stdClass());

        return array_fill(0, max(0, (int) ($schema->minItems ?? 0)), $items);
    }
    if ('integer' === $type || 'number' === $type) {
        return max(1, (int) ($schema->minimum ?? 1));
    }
    if ('boolean' === $type) {
        return true;
    }
    if ('null' === $type) {
        return null;
    }

    $minimumLength = max(1, (int) ($schema->minLength ?? 1));
    if (($schema->format ?? null) === 'uuid') {
        return '00000000-0000-4000-8000-000000000000';
    }
    if (($schema->format ?? null) === 'date-time') {
        return '2026-11-19T00:00:00Z';
    }
    if (($schema->format ?? null) === 'uri') {
        return 'https://example.test/resource';
    }

    return str_repeat('x', $minimumLength);
};

$seenTools = [];
foreach ($mcp['tools'] ?? [] as $tool) {
    $name = $tool['name'] ?? '(unnamed)';
    if (isset($seenTools[$name])) {
        $errors[] = sprintf('Duplicate MCP tool name %s.', $name);
    }
    $seenTools[$name] = true;

    $operationId = $tool['operation_id'] ?? '';
    if (!isset($operations[$operationId])) {
        $errors[] = sprintf('MCP tool %s references missing operation %s.', $name, $operationId);
        continue;
    }

    $mapping = $tool['http_mapping'] ?? [];
    $mappedPath = preg_replace('#^/api/v1(?=/|$)#', '', $mapping['path'] ?? '') ?? ($mapping['path'] ?? '');
    if ([strtoupper($mapping['method'] ?? ''), $mappedPath] !== $operations[$operationId]) {
        $errors[] = sprintf('MCP tool %s HTTP mapping differs from operation %s.', $name, $operationId);
    }

    if (isset($tool['inputSchema'])) {
        try {
            $schema = json_decode(json_encode($tool['inputSchema'], JSON_THROW_ON_ERROR), false, 512, JSON_THROW_ON_ERROR);
            $sample = $exampleForSchema($schema);
            $result = $validator->validate($sample, $schema);
            if (!$result->isValid()) {
                $errors[] = sprintf('MCP tool %s inputSchema rejected its generated example %s: %s', $name, json_encode($sample), (string) $result);
            }
        } catch (Throwable $exception) {
            $errors[] = sprintf('MCP tool %s inputSchema is invalid: %s', $name, $exception->getMessage());
        }
    }

    $outputReference = $tool['output_schema_ref'] ?? '';
    if (str_starts_with($outputReference, 'openapi.yaml#')) {
        try {
            $resolveReference(substr($outputReference, strlen('openapi.yaml')));
        } catch (Throwable $exception) {
            $errors[] = sprintf('MCP tool %s: %s', $name, $exception->getMessage());
        }
    }
}

$exampleSchemas = [
    'action-succeeded.json' => 'action-event.schema.json',
    'classification-record.json' => 'classification-record.schema.json',
    'intake-needs-information.json' => 'ticket-receipt.schema.json',
    'plugin-manifest.json' => 'plugin-manifest.schema.json',
    'task-link-collections.json' => 'task-links.schema.json',
    'task-moved.json' => 'task-moved.schema.json',
    'ui-change.json' => 'ui-change.schema.json',
];

foreach ($exampleSchemas as $exampleName => $schemaName) {
    $examplePath = $root.'/contracts/examples/'.$exampleName;
    $schemaPath = $root.'/contracts/schemas/'.$schemaName;
    if (!is_file($examplePath) || !is_file($schemaPath)) {
        $errors[] = sprintf('Missing contract example or schema for %s.', $exampleName);
        continue;
    }

    $example = json_decode((string) file_get_contents($examplePath), false, 512, JSON_THROW_ON_ERROR);
    $schema = json_decode((string) file_get_contents($schemaPath), false, 512, JSON_THROW_ON_ERROR);
    $result = $validator->validate($example, $schema);
    if (!$result->isValid()) {
        $errors[] = sprintf('Example %s does not satisfy %s.', $exampleName, $schemaName);
    }
}

$requirementsPath = $root.'/requirements.json';
$requirements = json_decode((string) file_get_contents($requirementsPath), true, 512, JSON_THROW_ON_ERROR);
$acceptancePath = $root.'/qa/acceptance/ACCEPTANCE.md';
$acceptance = is_file($acceptancePath) ? (string) file_get_contents($acceptancePath) : '';
if ('' === $acceptance) {
    $errors[] = 'The current QA acceptance specification is missing or empty.';
}
preg_match_all('/^##\s+(A\d{2,})\s+-/m', $acceptance, $acceptanceMatches);
$acceptanceIds = [];
foreach ($acceptanceMatches[1] as $acceptanceId) {
    if (isset($acceptanceIds[$acceptanceId])) {
        $errors[] = sprintf('Duplicate acceptance case ID %s.', $acceptanceId);
    }
    $anchor = sprintf('<a id="%s"></a>', strtolower($acceptanceId));
    if (!str_contains($acceptance, $anchor)) {
        $errors[] = sprintf('Acceptance case %s is missing its explicit Markdown anchor.', $acceptanceId);
    }
    $acceptanceIds[$acceptanceId] = true;
}
if ([] === $acceptanceIds) {
    $errors[] = 'The current QA acceptance specification defines no cases.';
}
$requirementIds = [];
$referencedAcceptanceIds = [];
foreach ($requirements['requirements'] ?? [] as $requirement) {
    if (!is_array($requirement)) {
        $errors[] = 'requirements.json contains a non-object requirement.';
        continue;
    }
    $id = $requirement['id'] ?? null;
    if (!is_string($id) || 1 !== preg_match('/^R\d{2,}$/', $id)) {
        $errors[] = sprintf('Invalid requirement ID %s.', (string) $id);
        continue;
    }
    if (isset($requirementIds[$id])) {
        $errors[] = sprintf('Duplicate requirement ID %s.', $id);
    }
    $requirementIds[$id] = true;
    if (empty($requirement['requirement'])) {
        $errors[] = sprintf('Requirement %s lacks its description.', $id);
    }
    if (isset($requirement['specification']) && (!is_string($requirement['specification']) || '' === trim($requirement['specification']))) {
        $errors[] = sprintf('Requirement %s has an invalid optional specification reference.', $id);
    }
    if (isset($requirement['milestone']) && (!is_string($requirement['milestone']) || '' === trim($requirement['milestone']))) {
        $errors[] = sprintf('Requirement %s has an invalid optional milestone reference.', $id);
    }

    $caseReferences = $requirement['acceptance'] ?? null;
    if (!is_array($caseReferences) || [] === $caseReferences) {
        $errors[] = sprintf('Requirement %s has no acceptance case mapping.', $id);
    } else {
        if (count($caseReferences) !== count(array_unique(array_filter($caseReferences, 'is_string')))) {
            $errors[] = sprintf('Requirement %s contains duplicate or invalid acceptance references.', $id);
        }
        foreach ($caseReferences as $acceptanceId) {
            if (!is_string($acceptanceId) || !isset($acceptanceIds[$acceptanceId])) {
                $errors[] = sprintf('Requirement %s references missing acceptance case %s.', $id, (string) $acceptanceId);
                continue;
            }
            $referencedAcceptanceIds[$acceptanceId] = true;
        }
    }

    foreach (['implementation', 'documentation'] as $mappingName) {
        $paths = $requirement[$mappingName] ?? null;
        if (!is_array($paths) || [] === $paths) {
            $errors[] = sprintf('Requirement %s has no %s path mapping.', $id, $mappingName);
            continue;
        }
        foreach ($paths as $mappedPath) {
            if (!is_string($mappedPath)
                || '' === $mappedPath
                || str_starts_with($mappedPath, '/')
                || preg_match('~(^|/)\.\.(/|$)~', $mappedPath)
                || !file_exists($root.'/'.$mappedPath)) {
                $errors[] = sprintf('Requirement %s has an invalid or missing %s path: %s.', $id, $mappingName, (string) $mappedPath);
            }
        }
    }

    if (preg_match_all('~(?:^|[; ])(docs/[A-Za-z0-9_./-]+)~', (string) ($requirement['specification'] ?? ''), $documentReferences)) {
        foreach ($documentReferences[1] as $documentReference) {
            if (!file_exists($root.'/'.$documentReference)) {
                $errors[] = sprintf('Requirement %s references missing documentation path %s.', $id, $documentReference);
            }
        }
    }
}
if ([] === $requirementIds) {
    $errors[] = 'requirements.json defines no requirements.';
}
foreach (array_keys($acceptanceIds) as $acceptanceId) {
    if (!isset($referencedAcceptanceIds[$acceptanceId])) {
        $errors[] = sprintf('Acceptance case %s is not mapped to a requirement.', $acceptanceId);
    }
}
$milestoneGates = $requirements['milestone_gates'] ?? null;
if (!is_array($milestoneGates) || [] === $milestoneGates) {
    $errors[] = 'requirements.json defines no milestone gates.';
} else {
    foreach ($milestoneGates as $milestone => $gate) {
        if (!is_string($milestone) || 1 !== preg_match('/^M\d+$/', $milestone) || !is_array($gate) || !is_array($gate['acceptance'] ?? null)) {
            $errors[] = sprintf('Invalid milestone gate %s.', (string) $milestone);
            continue;
        }
        foreach ($gate['acceptance'] as $acceptanceId) {
            if (!is_string($acceptanceId) || !isset($acceptanceIds[$acceptanceId])) {
                $errors[] = sprintf('Milestone %s references missing acceptance case %s.', $milestone, (string) $acceptanceId);
                continue;
            }
        }
    }
}

preg_match_all('/\]\(([^)]+)\)/', $acceptance, $acceptanceLinks);
foreach ($acceptanceLinks[1] as $acceptanceLink) {
    if (preg_match('~^https?://~i', $acceptanceLink) || str_starts_with($acceptanceLink, '#')) {
        continue;
    }
    [$linkedPath] = explode('#', $acceptanceLink, 2);
    if ('' !== $linkedPath && !file_exists(dirname($acceptancePath).'/'.$linkedPath)) {
        $errors[] = sprintf('Acceptance specification links to missing path %s.', $linkedPath);
    }
}
if ([] !== $errors) {
    fwrite(STDERR, implode("\n", array_map(static fn (string $error): string => 'ERROR: '.$error, $errors))."\n");
    exit(1);
}

fwrite(STDOUT, sprintf("Validated OpenAPI 3.1 with %d operations, %d MCP mappings, %d contract examples, %d requirements, and %d acceptance cases.\n", count($operations), count($seenTools), count($exampleSchemas), count($requirementIds), count($acceptanceIds)));
