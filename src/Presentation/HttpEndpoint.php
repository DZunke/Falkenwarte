<?php
declare(strict_types=1);
namespace App\Presentation;

use App\Access\Presentation\Access;
use App\Live\Infrastructure\Live;
use App\Operations\Application\JournalHandler;
use App\Shared\Application\Actor;
use App\Shared\Domain\Problem;
use Symfony\Component\HttpFoundation\{Request,Response,JsonResponse,BinaryFileResponse,RedirectResponse,ResponseHeaderBag};

final readonly class HttpEndpoint
{
    public function __construct(private Access $access,private Gateway $gateway,private Contract $contract,private Live $live,private McpEndpoint $mcp,private JournalHandler $journal) {}

    public function health():Response
    {
        try {
            $health=$this->journal->health()['status'];
            return new JsonResponse(['status'=>$health],$health==='unready'?503:200);
        } catch (\Throwable) { return new JsonResponse(['status'=>'unready'],503); }
    }

    public function shell():Response
    {
        $index=dirname(__DIR__,2).'/public/build/index.html';
        if (!is_file($index)) { return new Response('Frontend mit npm --prefix frontend run build erstellen.',503); }
        return new Response(file_get_contents($index),200,['Content-Type'=>'text/html; charset=UTF-8','Cache-Control'=>'no-cache']);
    }

    public function handle(Request $request):Response
    {
        try {
            $origin=$request->headers->get('Origin');
            if ($origin!==null && $origin!==$request->getSchemeAndHttpHost()) { throw new Problem(403,'origin_forbidden','Die Anfrage stammt von einem anderen Ursprung.'); }
            if ($request->getPathInfo()==='/mcp') { return $this->mcp->handle($request); }
            $name=$request->attributes->get('_route');
            $op=$this->contract->op($name);
            $actor=$this->access->authenticate($request);
            $public=isset($op['security']) && $op['security']===[];
            if (!$public && !$actor) { throw new Problem(401,'unauthenticated','Bitte anmelden.'); }
            $params=$this->contract->params($op,$request->attributes->all(),$request->query->all());
            $schema=$op['requestBody']['content']['application/json']['schema'] ?? null;
            $wire=(object)[];
            if ($request->getContent()!=='') {
                if (!$schema || $request->getContentTypeFormat()!=='json') { throw new Problem(415,'invalid_content_type','Dieser Endpunkt erwartet application/json.'); }
                if (strlen($request->getContent())>2_000_000) { throw new Problem(413,'payload_too_large','Die Eingabe ist zu groß.'); }
                try { $wire=json_decode($request->getContent(),false,128,JSON_THROW_ON_ERROR); } catch (\JsonException) { throw new Problem(400,'invalid_json','Ungültiges JSON.'); }
            }
            if ($schema) { $this->contract->validate($wire,$schema); }
            $body=json_decode(json_encode($wire,JSON_THROW_ON_ERROR),true,flags:JSON_THROW_ON_ERROR);
            if (in_array($name,['bootstrap_get','owner_setup','session_get','session_create','session_delete'],true)) {
                $data=$this->access->handleSession($name,$request,$body,$actor);
            } else {
                $actor??=new Actor('oauth',false);
                if ($actor->owner && !$request->isMethodSafe()) { $this->access->csrf($request); }
                $failpoint=getenv('APP_ENV')==='test' && $request->headers->get('X-Test-Failpoint')==='before_commit';
                $data=$this->gateway->invoke($name,$params,$body,$actor,$request->headers->get('Idempotency-Key'),$request->headers->get('If-Match'),$failpoint);
            }
            $status=$this->contract->status($op,$data);
            if (isset($data['_file'])) {
                $response=new BinaryFileResponse($data['_file']);
                $response->setContentDisposition(ResponseHeaderBag::DISPOSITION_ATTACHMENT,$data['_filename'] ?? basename($data['_file']));
                if (isset($data['_content_type'])) { $response->headers->set('Content-Type',$data['_content_type']); }
            } elseif ($name==='connection_oauth_callback') {
                $response=new RedirectResponse('/#/agents');
            } else {
                $response=$status===204 ? new Response('',204) : new JsonResponse($this->contract->output($op,$status,$data),$status);
            }
            if ($this->access->cookie) { $response->headers->setCookie($this->access->cookie); }
            if ($name==='live_authorize') { $response->headers->setCookie($this->live->cookie($data['topics'],$actor)); }
            if ($name==='session_delete') { $response->headers->clearCookie('__Secure-mercure_access_token','/.well-known/mercure',null,true,true,'strict'); }
            if (isset($data['version'])) { $response->setEtag((string)$data['version']); }
            $response->headers->set('Cache-Control','no-store, private');
            $response->headers->set('X-Content-Type-Options','nosniff');
            return $response;
        } catch (Problem $e) {
            return new JsonResponse($e->details(),$e->status,['Content-Type'=>'application/problem+json','Cache-Control'=>'no-store']);
        } catch (\Throwable $e) {
            $problem=new Problem(500,'internal_error','Der Auftrag konnte nicht verarbeitet werden.');
            $details=$problem->details();
            error_log($details['trace_id'].' '.$e::class.': '.$e->getMessage().' in '.$e->getFile().':'.$e->getLine());
            return new JsonResponse($details,500,['Content-Type'=>'application/problem+json','Cache-Control'=>'no-store']);
        }
    }
}
