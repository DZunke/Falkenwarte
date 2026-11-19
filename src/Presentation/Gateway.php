<?php
declare(strict_types=1);
namespace App\Presentation;

use App\Access\Presentation\Access;
use App\Shared\Application\{Actor,IdempotencyStore,Store};
use App\Shared\Domain\Problem;

final class Gateway
{
    public function __construct(private readonly Store $store, private readonly IdempotencyStore $idempotency, private readonly Contract $contract, private readonly iterable $handlers) {}

    private const TARGETS=['project_id'=>'projects','task_id'=>'tasks','board_id'=>'boards','label_id'=>'labels','run_id'=>'runs','approval_id'=>'approvals','connection_id'=>'connections','profile_id'=>'agent_profiles','workflow_id'=>'workflows','instance_id'=>'workflow_instances','trigger_id'=>'triggers','plugin_id'=>'plugins','token_id'=>'tokens','secret_id'=>'secret_references','field_id'=>'custom_fields','evidence_id'=>'evidence','backup_id'=>'backups','revision_id'=>'revisions','action_id'=>'actions','export_id'=>'exports'];
    public function invoke(string $name,array $p,array $body,Actor $actor,?string $key,?string $etag,bool $failpoint=false): array
    {
        $op=$this->contract->op($name);
        if ($op['x-owner-only'] ?? false) { $actor->requireOwner(); }
        if (!$actor->owner && array_diff($op['x-required-capabilities'] ?? [],$actor->capabilities)) { throw new Problem(403,'forbidden','Dem Token fehlt die erforderliche Berechtigung.'); }
        if (isset($p['project_id'])) { $actor->requireProject($p['project_id']); }
        $read=$op['method']==='GET';
        $call=function() use ($op,$name,$p,$body,$actor,$key,$etag,$failpoint,$read) {
            $this->guardProject($actor,$p);
            if ($read) { return $this->dispatch($name,$p,$body,$actor); }
            $headers=array_column(array_filter($op['params'],fn($q)=>$q['in']==='header'),'name');
            $dedup=in_array('Idempotency-Key',$headers,true);
            if ($dedup && (!is_string($key) || strlen($key)<8 || strlen($key)>256)) { throw new Problem(428,'precondition_required','Ein gültiger Idempotency-Key ist erforderlich.'); }
            $fingerprint=hash('sha256',json_encode($this->canonical([$name,$p,$body,$etag]),JSON_THROW_ON_ERROR));
            if ($dedup) {
                $old=$this->idempotency->findReplay($actor->id,$key);
                if ($old) {
                    if (!hash_equals($old['fingerprint'],$fingerprint)) { throw new Problem(409,'idempotency_conflict','Dieser Schlüssel gehört bereits zu einem anderen Auftrag.'); }
                    return $old['response'];
                }
            }
            if (in_array('If-Match',$headers,true)) {
                if ($etag===null || !preg_match('/^"([1-9][0-9]*)"$/D',$etag,$match)) { throw new Problem(428,'precondition_required','Die aktuelle Version als starken If-Match-Header senden.'); }
                $version=$this->version($op,$p,$actor);
                if ((int)$match[1]!==$version) { throw new Problem(412,'version_conflict','Der Eintrag hat sich geändert. Aktuellen Stand laden.',['current_version'=>$version]); }
            }
            $id=$this->store->id();
            $this->store->context($actor,$id);
            $project=$this->project($p);
            $action=['id'=>$id,'type'=>$name,'status'=>'accepted','actor'=>$actor->ref(),'project_id'=>$project,'correlation_id'=>$id,'causation_id'=>null,'target'=>null,'result'=>null,'error'=>null,'accepted_at'=>$this->store->now(),'started_at'=>null,'finished_at'=>null];
            $this->store->save('actions',$action,'action.accepted');
            $action['started_at']=$this->store->now();
            $action['status']='started';
            $data=$this->dispatch($name,$p,$body,$actor);
            if ($failpoint) { throw new Problem(503,'test_commit_failure','Testunterbrechung vor dem Commit.'); }
            $action['project_id']??=$data['project_id'] ?? ($name==='projects_create'?($data['id'] ?? null):null);
            $action['result']=$data['resource'] ?? null;
            $this->store->save('actions',$action,'action.started');
            if (!$this->idempotency->hasPendingCommands($id)) {
                $action['status']='succeeded';
                $action['finished_at']=$this->store->now();
                $this->store->save('actions',$action,'action.succeeded');
            }
            if ($dedup) {
                $replay=$data;
                if ($name==='tokens_create') { $replay['token']=null; $replay['token_disclosed']=false; }
                $replay=json_encode($this->contract->output($op,$this->contract->status($op,$replay),$replay),JSON_THROW_ON_ERROR);
                $this->idempotency->saveReplay($actor->id,$key,$fingerprint,$replay,time());
            }
            return $data;
        };
        return $read ? $call() : $this->store->atomic($call);
    }

    private function canonical(array $value):array
    {
        if (!array_is_list($value)) { ksort($value); }
        foreach ($value as &$item) { if (is_array($item)) { $item=$this->canonical($item); } }
        return $value;
    }

    private function project(array $params):?string
    {
        if (isset($params['project_id'])) { return $params['project_id']; }
        foreach (self::TARGETS as $key=>$type) {
            if (isset($params[$key])) {
                $record=$this->store->find($type,$params[$key]);
                if (isset($record['project_id'])) { return $record['project_id']; }
            }
        }
        return null;
    }

    private function guardProject(Actor $a,array $params):void
    {
        if ($a->owner) { return; }
        foreach (self::TARGETS as $key=>$type) {
            if (!isset($params[$key])) { continue; }
            $record=$this->store->find($type,$params[$key]);
            if (isset($record['project_id'])) { $a->requireProject($record['project_id']); }
            if ($type==='actions' && $record && $record['actor']['id']!==$a->id) { throw new Problem(403,'forbidden','Diese Action gehört einem anderen Melder.'); }
        }
    }

    private function version(array $op,array $p,Actor $a):int
    {
        $name=$op['operationId'];
        if (str_starts_with($name,'owner_')) { return $this->store->get('owners',$a->id)['version']; }
        if ($name==='settings_update') { return $this->store->get('settings',Access::SETTINGS)['version']; }
        if ($name==='history_restore') {
            $resource=$this->store->get('revisions',$p['revision_id'])['resource'];
            $type=array_search($resource['resource_type'],Store::PUBLIC_TYPES,true);
            return $this->store->get($type?:'tasks',$resource['id'])['version'];
        }
        $get=match($op['x-version-resource'] ?? '') {
            'routing_rules'=>'routing_rules_get','decision_policy'=>'decision_policy_get','decision_configuration'=>'decision_configuration_get','plugin'=>'plugins_get',default=>null,
        };
        if ($get) { return $this->dispatch($get,$p,[],$a)['version'] ?? 1; }
        $paths=$this->contract->pathParams($op);
        if ($op['x-version-resource']==='task') { $paths=['task_id']; }
        foreach (array_reverse($paths) as $key) {
            if (isset(self::TARGETS[$key])) { return $this->store->get(self::TARGETS[$key],$p[$key])['version']; }
        }
        throw new Problem(409,'version_unavailable','Die Version dieses Eintrags ist nicht verfügbar.');
    }

    private function dispatch(string $name,array $p,array $b,Actor $a):array
    {
        foreach ($this->handlers as $handler) {
            if ($handler->handles($name)) { return $handler->handle($name,$p,$b,$a); }
        }
        throw new Problem(501,'operation_unavailable','Diese Operation ist nicht verfügbar: '.$name);
    }
}
