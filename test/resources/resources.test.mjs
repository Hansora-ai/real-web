import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const pub=path.join(root,'public');
const center=path.join(pub,'resources');
const read=relative=>readFile(path.join(root,relative),'utf8');
const edgeSource=await read('netlify/edge-functions/inject-bottom-nav-inline.js');
const {default:edge}=await import('data:text/javascript;base64,'+Buffer.from(edgeSource).toString('base64'));
const fixture='<!doctype html><html lang="en"><head><title>fixture</title></head><body><h1>Readable content</h1></body></html>';

test('resource responses keep original HTML, status and headers for search agents',async()=>{
 for(const pathname of ['/resources','/resources/','/resources/ai-marketing-workflows/','/resources/missing/']){
  for(const ua of ['Googlebot','bingbot','OAI-SearchBot','Claude-SearchBot']){
   const original=new Response(fixture,{status:pathname.includes('missing')?404:200,headers:{'content-type':'text/html; charset=utf-8','x-resource-test':'preserved'}});
   const result=await edge(new Request('https://hansora.co'+pathname,{headers:{'user-agent':ua}}),{next:async()=>original});
   assert.equal(result,original);assert.equal(result.headers.get('x-resource-test'),'preserved');assert.equal(await result.text(),fixture);
  }
 }
});

test('edge behavior on existing app pages and non-HTML responses is preserved',async()=>{
 for(const pathname of ['/','/pricing.html','/resources-other']){
  const response=await edge(new Request('https://hansora.co'+pathname),{next:async()=>new Response(fixture,{headers:{'content-type':'text/html'}})});
  assert.match(await response.text(),/class="hs-bottom-nav"/);
 }
 for(const pathname of ['/oauth/consent','/caption-studio','/automation-flows.html']){
  const response=new Response(fixture,{headers:{'content-type':'text/html'}});
  assert.equal(await edge(new Request('https://hansora.co'+pathname),{next:async()=>response}),response);
 }
 const xml=new Response('<urlset/>',{headers:{'content-type':'application/xml'}});
 assert.equal(await edge(new Request('https://hansora.co/sitemap.xml'),{next:async()=>xml}),xml);
});

test('all resource pages have consistent canonical/schema identities and resolvable local targets',async()=>{
 const dirs=(await readdir(center,{withFileTypes:true})).filter(d=>d.isDirectory()&&d.name!=='assets');
 assert.equal(dirs.length,5);
 const descriptions=new Set();const titles=new Set();
 for(const slug of ['',...dirs.map(d=>d.name)]){
  const file=path.join(center,slug,'index.html');const html=await readFile(file,'utf8');
  const canonical='https://hansora.co/resources/'+(slug?slug+'/':'');
  assert.match(html,/<html lang="en">/);assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.ok(html.includes('<link rel="canonical" href="'+canonical+'">'));assert.doesNotMatch(html,/noindex/i);
  descriptions.add(html.match(/<meta name="description" content="([^"]+)"/)[1]);titles.add(html.match(/<title>([^<]+)<\/title>/)[1]);
  const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const breadcrumbs=graph.find(x=>x['@type']==='BreadcrumbList');assert.equal(breadcrumbs.itemListElement.at(-1).item,canonical);
  if(slug){const article=graph.find(x=>x['@type']==='Article');assert.equal(article.url,canonical);assert.ok(article.wordCount>=800&&article.wordCount<=1200);assert.ok(html.includes('Frequently asked questions'));assert.ok(article.citation.length>=2);}
  for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
   const value=match[1];if(/^(?:https?:|mailto:|#)/.test(value))continue;
   const url=new URL(value,'https://hansora.co/resources/'+(slug?slug+'/':''));let target=path.join(pub,decodeURIComponent(url.pathname));
   if((await stat(target)).isDirectory())target=path.join(target,'index.html');await stat(target);
   if(url.hash){const dest=await readFile(target,'utf8');assert.ok(dest.includes('id="'+url.hash.slice(1)+'"'),value);}
  }
 }
 assert.equal(descriptions.size,6);assert.equal(titles.size,6);
});

test('homepage discovers resources and sitemap includes each resource once without new training-bot rules',async()=>{
 assert.match(await read('public/index.html'),/<a href="\/resources\/">Resources<\/a>/);
 const rootMap=await read('public/sitemap.xml');const resourceMap=await read('public/resources/sitemap.xml');
 for(const loc of resourceMap.matchAll(/<loc>([^<]+)<\/loc>/g))assert.equal(rootMap.split('<loc>'+loc[1]+'</loc>').length-1,1);
 const robots=await read('public/robots.txt');assert.match(robots,/Sitemap: https:\/\/hansora\.co\/sitemap\.xml/);assert.doesNotMatch(robots,/User-agent|Disallow|GPTBot/i);
 const config=await read('netlify.toml');assert.match(config,/publish = "public"/);assert.doesNotMatch(config,/from\s*=\s*"\/resources/);
});
