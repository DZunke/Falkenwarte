<?php
declare(strict_types=1);
namespace App\Presentation;

use App\Shared\Domain\Problem;
use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;
use Symfony\Component\Yaml\Yaml;

/** The same contract selects handlers, validates wire input and projects public response fields. */
final class Contract
{
    private array $spec;
    private array $ops = [];
    private array $documents = [];
    private array $schemaCache = [];
    private Validator $validator;

    public function __construct(private readonly string $root)
    {
        $file = $root.'/contracts/openapi.yaml';
        $cache = $root.'/var/cache/openapi-'.hash_file('xxh128',$file).'.php';
        if (!is_file($cache)) {
            $parsed = Yaml::parseFile($file);
            if (!is_dir(dirname($cache))) { @mkdir(dirname($cache),0770,true); }
            $temp = tempnam(dirname($cache),'spec');
            file_put_contents($temp,'<?php return '.var_export($parsed,true).';');
            rename($temp,$cache);
        }
        $this->spec = require $cache;
        $this->validator = new Validator();
        foreach ($this->spec['paths'] as $path=>$methods) {
            foreach ($methods as $method=>$op) {
                if (!isset($op['operationId'])) { continue; }
                $op['method'] = strtoupper($method);
                $op['path'] = $path;
                $op['params'] = array_map(fn($param)=>$this->resolve($param),array_merge($methods['parameters'] ?? [],$op['parameters'] ?? []));
                $this->ops[$op['operationId']] = $op;
            }
        }
    }

    public function operations(): array { return $this->ops; }
    public function op(string $id): array { return $this->ops[$id] ?? throw new Problem(404,'resource_not_found','Unbekannte Operation.'); }
    public function tools(): array { return json_decode(file_get_contents($this->root.'/contracts/mcp-tools.json'),true,flags:JSON_THROW_ON_ERROR)['tools']; }

    public function resolve(array $schema): array
    {
        while (isset($schema['$ref'])) {
            [$file,$fragment] = array_pad(explode('#',$schema['$ref'],2),2,'');
            $doc = $file === '' ? $this->spec : ($this->documents[$file] ??= json_decode(file_get_contents($this->root.'/contracts/'.$file),true,flags:JSON_THROW_ON_ERROR));
            if ($fragment !== '') {
                foreach (explode('/',ltrim($fragment,'/')) as $key) { $doc = $doc[$key]; }
            }
            $schema = $doc;
        }
        return $schema;
    }

    private function expand(array $node): array
    {
        $node = $this->resolve($node);
        unset($node['$id']);
        foreach ($node as $key=>$sub) {
            if (is_array($sub)) { $node[$key] = $this->expand($sub); }
        }
        return $node;
    }

    public function validate(mixed $value,array $schema): void
    {
        $key = hash('xxh128',serialize($schema));
        if (!isset($this->schemaCache[$key])) {
            $this->schemaCache[$key] = json_decode(json_encode($this->expand($schema),JSON_THROW_ON_ERROR),false,flags:JSON_THROW_ON_ERROR);
        }
        $result = $this->validator->validate($value,$this->schemaCache[$key]);
        if (!$result->isValid()) {
            $errors = (new ErrorFormatter())->format($result->error());
            $key = array_key_first($errors);
            throw new Problem(422,'validation_failed',mb_substr('Eingabe prüfen ('.$key.'). '.implode(' ',(array)$errors[$key]),0,1000));
        }
    }

    public function pathParams(array $op): array
    {
        return array_column(array_filter($op['params'], static fn($p)=>$p['in'] === 'path'),'name');
    }

    public function params(array $op,array $path,array $query): array
    {
        $input = [];
        foreach ($op['params'] as $p) {
            if (!in_array($p['in'],['path','query'],true)) { continue; }
            $k = $p['name'];
            $source = $p['in'] === 'path' ? $path : $query;
            if (!array_key_exists($k,$source)) {
                if ($p['required'] ?? false) { throw new Problem(422,'validation_failed','Parameter fehlt: '.$k); }
                continue;
            }
            $v = $source[$k];
            $schema = $this->resolve($p['schema']);
            if (($schema['type'] ?? '') === 'integer' && is_string($v) && preg_match('/^-?\d+$/D',$v)) { $v=(int)$v; }
            if (($schema['type'] ?? '') === 'boolean' && in_array($v,['true','false'],true)) { $v=$v==='true'; }
            $this->validate($v,$schema);
            $input[$k]=$v;
        }
        return $input;
    }

    public function status(array $op,array $data): int
    {
        if ($op['operationId'] === 'tasks_create' && ($data['outcome'] ?? '') === 'accepted') { return 202; }
        foreach ($op['responses'] as $status=>$_) { if (is_numeric($status) && $status<400) { return (int)$status; } }
        return 200;
    }

    public function output(array $op,int $status,array $data): mixed
    {
        $response=$this->resolve($op['responses'][$status] ?? []);
        $schema=$response['content']['application/json']['schema'] ?? [];
        return $this->project($schema,$data);
    }

    private function project(array $schema,mixed $data): mixed
    {
        $schema=$this->resolve($schema);
        if ($data === null) { return null; }
        $alternatives = $schema['anyOf'] ?? $schema['oneOf'] ?? null;
        if ($alternatives !== null) {
            foreach ($alternatives as $option) {
                $candidate=$this->resolve($option);
                if (($candidate['type'] ?? null)==='null') { continue; }
                if (isset($candidate['properties']['type']['const']) && ($data['type'] ?? null) !== $candidate['properties']['type']['const']) { continue; }
                return $this->project($candidate,$data);
            }
        }
        if (!is_array($data)) { return $data; }
        if (($schema['type'] ?? '')==='array') { return array_map(fn($v)=>$this->project($schema['items'] ?? [],$v),array_values($data)); }
        if (($schema['type'] ?? '')==='object' || isset($schema['properties'])) {
            $result=[];
            foreach ($data as $k=>$v) {
                if (str_starts_with((string)$k,'_')) { continue; }
                if (isset($schema['properties'][$k])) { $result[$k]=$this->project($schema['properties'][$k],$v); }
                elseif (($schema['additionalProperties'] ?? true)!==false) { $result[$k]=$this->project(is_array($schema['additionalProperties'] ?? null)?$schema['additionalProperties']:[],$v); }
            }
            return (object)$result;
        }
        return $data;
    }
}
