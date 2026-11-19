<?php
declare(strict_types=1);

use League\CommonMark\GithubFlavoredMarkdownConverter;

require_once dirname(__DIR__).'/vendor/autoload.php';

$root=dirname(__DIR__);
$target=$root.'/public/docs';
$pages=json_decode(file_get_contents($target.'/index.json'),true,flags:JSON_THROW_ON_ERROR)['documents'];
$converter=new GithubFlavoredMarkdownConverter(['html_input'=>'escape','allow_unsafe_links'=>false]);
$escape=static fn(string $value):string=>htmlspecialchars($value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');
$names=array_column($pages,'title','path');
$pageUrl=static fn(string $path):string=>'/docs/'.($path==='README.md'?'index.html':substr($path,0,-3).'.html');
$copyPath=static function(string $path,string $base): string {
    $parts=[];
    foreach (explode('/',($base==='.'?'':$base.'/').$path) as $part) {
        if ($part==='' || $part==='.') { continue; }
        if ($part==='..') { array_pop($parts); continue; }
        $parts[]=$part;
    }
    return implode('/',$parts);
};
$navigation='';
foreach (['README.md','USER_GUIDE.md','OPERATIONS.md','domain/GLOSSARY.md','domain/CONTEXT_MAP.md','DECISIONS.md','TESTING.md','TRACEABILITY.md'] as $key) {
    if (isset($names[$key])) { $navigation.='<a href="'.$pageUrl($key).'">'.$escape($names[$key]).'</a>'; }
}
foreach ($pages as $page) {
    $path=$page['path'];
    $dir=dirname($path);
    $fragment=(string)$converter->convert($page['markdown']);
    $dom=new DOMDocument('1.0','UTF-8');
    $dom->loadHTML('<!doctype html><html lang="de"><head><meta charset="utf-8"></head><body><article>'.$fragment.'</article></body></html>',LIBXML_NOERROR|LIBXML_NOWARNING|LIBXML_NONET);
    $xpath=new DOMXPath($dom);
    $slugs=[];
    foreach ($xpath->query('//h1|//h2|//h3|//h4') as $heading) {
        $text=trim($heading->textContent);
        $ascii=iconv('UTF-8','ASCII//TRANSLIT//IGNORE',$text) ?: $text;
        $slug=strtolower(trim(preg_replace('/[^A-Za-z0-9]+/','-',$ascii),'-'));
        $slug=preg_replace('/^(a[0-9]{2})-/','$1---',$slug);
        $seen=$slugs[$slug] ?? 0;
        $slugs[$slug]=$seen+1;
        $heading->setAttribute('id',$slug.($seen?'-'.$seen:''));
    }
    foreach ($xpath->query('//a[@href]|//img[@src]') as $node) {
        $attr=$node->nodeName==='a'?'href':'src';
        $url=$node->getAttribute($attr);
        if ($url==='' || preg_match('~^(?:[a-z]+:|/|#)~i',$url)) { continue; }
        [$file,$hash]=array_pad(explode('#',$url,2),2,'');
        $resolved=$copyPath($file,'docs'.($dir==='.'?'':'/'.$dir));
        $doc=str_starts_with($resolved,'docs/')?substr($resolved,5):null;
        if ($doc!==null && isset($names[$doc])) { $url=$pageUrl($doc); }
        elseif ($doc!==null && is_file($root.'/'.$resolved)) { $url='/docs/content/'.$doc; }
        elseif (str_starts_with($resolved,'contracts/')) { $url='/docs/'.$resolved; }
        else { $url='https://github.com/DZunke/Falkenwarte/blob/main/'.$resolved; }
        $node->setAttribute($attr,$url.($hash!==''?'#'.$hash:''));
    }
    $article=$dom->saveHTML($dom->getElementsByTagName('article')->item(0));
    $title=$escape($page['title']);
    $html=<<<HTML
<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{$title} · Falkenwarte</title><link rel="stylesheet" href="/docs/handbuch.css"></head><body><header><a href="/docs/">Falkenwarte <span>Handbuch</span></a><a href="/">Zur Anwendung</a></header><main><nav aria-label="Handbuch">{$navigation}</nav>{$article}</main></body></html>
HTML;
    $out=$root.'/public'.$pageUrl($path);
    if (!is_dir(dirname($out))) { mkdir(dirname($out),0775,true); }
    file_put_contents($out,$html);
}
copy(__DIR__.'/handbuch.css',$target.'/handbuch.css');
