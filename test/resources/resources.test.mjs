import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const pub=path.join(root,'public');
const center=path.join(pub,'resources');
const read=relative=>readFile(path.join(root,relative),'utf8');
test('all resource pages have consistent canonical/schema identities and resolvable local targets',async()=>{
 const dirs=(await readdir(center,{withFileTypes:true})).filter(d=>d.isDirectory()&&d.name!=='assets');
 assert.equal(dirs.length,5);
 const descriptions=new Set();const titles=new Set();
 for(const slug of ['',...dirs.map(d=>d.name)]){
  const file=path.join(center,slug,'index.html');const html=await readFile(file,'utf8');
  const canonical='https://hansora.co/resources/'+(slug?slug+'/':'');
  assert.match(html,/<html lang="en">/);assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.ok(html.includes('<link rel="canonical" href="'+canonical+'">'));assert.doesNotMatch(html,/noindex/i);assert.doesNotMatch(html,/<(?:form|input|button)\b|<script[^>]+src=/i);
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

test('sitemap includes each resource once without new training-bot rules',async()=>{
 const rootMap=await read('public/sitemap.xml');const resourceMap=await read('public/resources/sitemap.xml');
 for(const loc of resourceMap.matchAll(/<loc>([^<]+)<\/loc>/g))assert.equal(rootMap.split('<loc>'+loc[1]+'</loc>').length-1,1);
 const robots=await read('public/robots.txt');assert.match(robots,/Sitemap: https:\/\/hansora\.co\/sitemap\.xml/);assert.doesNotMatch(robots,/User-agent|Disallow|GPTBot/i);
});
