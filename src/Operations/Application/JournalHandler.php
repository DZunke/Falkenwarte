<?php
declare(strict_types=1);
namespace App\Operations\Application;

use App\Shared\Application\{Store,Actor};
use App\Shared\Domain\Problem;

final readonly class JournalHandler
{
    public function __construct(private Store $store, private OperationsPersistence $persistence) {}
    public function handles(string $op):bool
    {
        return in_array($op,['actions_list','actions_get','health_get','exports_list','exports_get','exports_create','export_content_get'],true);
    }

    public function handle(string $op,array $p,array $b,Actor $a):array
    {
        if ($op==='health_get') { return $this->health(); }
        if ($op==='exports_create') {
            foreach ($b['project_ids'] as $id) { $this->store->get('projects',$id); }
            $export=$this->store->save('exports',$b+['status'=>'queued','sha256'=>null,'size_bytes'=>null,'download_url'=>null,'expires_at'=>null,'error'=>null],'operations.export_requested');
            $this->store->enqueue('export.create',['id'=>$export['id']]);
            return $this->store->accepted(['resource_type'=>'export','id'=>$export['id'],'url'=>'/api/v1/exports/'.$export['id']]);
        }
        if ($op==='exports_list') { return $this->store->page($this->store->all('exports'),$p); }
        if (isset($p['export_id'])) {
            $export=$this->store->get('exports',$p['export_id']);
            if ($op==='exports_get') { return $export; }
            if ($export['status']!=='ready' || strtotime($export['expires_at'])<time()) { throw new Problem(409,'export_unavailable','Der Export steht nicht zum Download bereit.'); }
            return ['_file'=>$export['_file']];
        }
        if ($op==='actions_get') {
            $action=$this->store->get('actions',$p['action_id']);
            if (!$this->visible($action,$a)) { throw new Problem(403,'forbidden','Für diese Action fehlt die Berechtigung.'); }
            return $action;
        }
        $items=array_filter(array_reverse($this->store->all('actions',$p['project_id'] ?? null)),function($r) use($a,$p) {
            if (!$this->visible($r,$a)) { return false; }
            foreach (['status','type'] as $k) { if (isset($p[$k]) && ($r[$k] ?? null)!==$p[$k]) { return false; } }
            return true;
        });
        return $this->store->page($items,$p);
    }

    private function visible(array $r,Actor $a):bool
    {
        return $a->owner || (isset($r['project_id']) && $a->canProject($r['project_id']) && $r['actor']['id']===$a->id);
    }

    public function health():array
    {
        $state=$this->persistence->healthSnapshot(time());
        $schema=$state['schema']; $worker=$state['worker']; $maintenance=$state['maintenance'];
        $external=count(array_filter($this->store->all('connections'),fn($r)=>!in_array($r['status'] ?? '',['healthy','connected','ready'],true)));
        return ['status'=>($schema==='ok' && $worker==='ok' && $maintenance==='ok')?($external?'degraded':'ok'):'unready','checked_at'=>$this->store->now(),'database'=>'ok','schema'=>$schema,'worker'=>$worker,'maintenance'=>$maintenance,'external_connections_degraded'=>$external];
    }

    public function work(string $kind,array $p):void
    {
        $export=$this->store->get('exports',$p['id']);
        if ($export['status']==='ready') { return; }
        $result=[];
        $this->store->atomic(function() use($export,&$result) {
            foreach ($export['project_ids'] as $id) {
                $result[]=['type'=>'project','record'=>$this->store->redact($this->store->get('projects',$id))];
                $types=['tasks','labels','boards','link_collections','runs','approvals'];
                if ($export['include_history']) { $types[]='revisions'; }
                if ($export['include_artifacts']) { $types[]='evidence'; }
                foreach ($types as $type) {
                    foreach ($this->store->all($type,$id) as $row) { $result[]=['type'=>$type,'record'=>$this->store->redact($row)]; }
                }
            }
        });
        $bytes=$export['format']==='json'?json_encode($result,JSON_THROW_ON_ERROR|JSON_PRETTY_PRINT):implode("\n",array_map(fn($v)=>json_encode($v,JSON_THROW_ON_ERROR),$result))."\n";
        $dir=dirname(getenv('FALKENWARTE_DB') ?: dirname(__DIR__,3).'/var/falkenwarte.sqlite').'/exports';
        if (!is_dir($dir) && !mkdir($dir,0700,true) && !is_dir($dir)) { throw new \RuntimeException('Exportverzeichnis fehlt.'); }
        $path=$dir.'/'.$export['id'].'.'.$export['format'];
        if (file_put_contents($path.'.tmp',$bytes,LOCK_EX)===false || !rename($path.'.tmp',$path)) { throw new \RuntimeException('Export konnte nicht gespeichert werden.'); }
        $this->store->save('exports',array_replace($export,['status'=>'ready','sha256'=>hash('sha256',$bytes),'size_bytes'=>strlen($bytes),'expires_at'=>gmdate(DATE_ATOM,time()+86400),'download_url'=>'/api/v1/exports/'.$export['id'].'/content','_file'=>$path]),'operations.export_completed');
    }
}
