import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
const source = await readFile(new URL('../../netlify/edge-functions/inject-bottom-nav-inline.js', import.meta.url), 'utf8');
const inject = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
const html = '<html><head></head><body><main>Content</main></body></html>';
async function response(path) { return inject(new Request('https://hansora.co'+path), {next: async () => new Response(html, {headers:{'Content-Type':'text/html'}})}); }
test('English, Russian and Armenian menus load the same form, with valid inline navigation code', async () => {
  for (const [path,label] of [['/index.html','Feedback'],['/index_ru.html','Обратная связь'],['/index_arm.html','Կարծիք հայտնել']]) {
    const output = await (await response(path)).text();
    assert.match(output, new RegExp('data-hansora-feedback[^>]*>.*'+label));
    assert.equal((output.match(/id="hs-feedback-btn"/g)||[]).length,1);
    assert.match(output, /src="\/feedback.js\?v=1" defer/);
    for (const script of output.matchAll(/<script>([\s\S]*?)<\/script>/g)) parse(script[1],{ecmaVersion:'latest'});
  }
});
test('standalone editor/automation exclusions remain intact', async () => {
  for (const path of ['/caption-studio.html','/caption-studio_arm.html','/caption-studio_ru.html','/automation.html','/oauth/consent']) assert.equal(await (await response(path)).text(),html);
});

test('mobile Video Edit opens localized Henshin in edit mode', async()=>{
 for(const suffix of ['', '_ru', '_arm']){
  const output=await (await response(`/index${suffix}.html`)).text();
  assert.match(output,new RegExp(`href="/henshin${suffix}\\.html\\?mode=edit">Video Edit</a>`));
  assert.doesNotMatch(output,/href="[^"]*video-edit/);
 }
});

test('retired editor URLs redirect before loading any old editor, regardless of device or query', async()=>{
 for (const suffix of ['', '_ru', '_arm']) {
  for (const ending of ['', '/', '.html', '.html/']) {
   for (const agent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)']) {
    let served = false;
    const request = new Request(`https://hansora.co/video-edit${suffix}${ending}?mode=old&taskId=previous`, {headers:{'User-Agent':agent}});
    const result = await inject(request, {next:async()=>{served=true;return new Response('old editor');}});
    assert.equal(result.status,302);
    assert.equal(result.headers.get('Location'),`https://hansora.co/henshin${suffix}.html?mode=edit`);
    assert.equal(result.headers.get('Cache-Control'),'no-store');
    assert.equal(served,false);
   }
  }
 }
});
