const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function locale(language){const ctx={window:{},document:{documentElement:{lang:language}},Intl};vm.runInNewContext(fs.readFileSync('public/henshin-i18n.js','utf8'),ctx);return ctx.window.HenshinI18n;}
test('Russian and Armenian localize dynamic controls, counts and errors while preserving custom text',()=>{
 for(const lang of ['hy','ru']){
  const i=locale(lang);assert.notEqual(i.t('Generating'), 'Generating');assert.notEqual(i.t('Not enough credits.'),'Not enough credits.');
  assert.ok(!i.t('Reference {n}',{n:3}).includes('{n}'));assert.ok(i.t('Reference {n}',{n:3}).includes('3'));
  assert.equal(i.t('Keep @Video 1 and @Image 1 exactly as uploaded.'),'Keep @Video 1 and @Image 1 exactly as uploaded.');assert.equal(i.t(null),'');
  assert.notEqual(i.seconds(12),'12s');assert.ok(!i.credits(42).includes('credits'));
  for(const [key,values]of Object.entries(i.messages))for(const language of ['hy','ru']){assert.ok(values[language],key);assert.deepEqual(values[language].match(/\{\w+\}/g)?.sort()||[],key.match(/\{\w+\}/g)?.sort()||[],key);}
 }
 const r=locale('ru');assert.equal(r.credits(1),'1 кредит');assert.equal(r.credits(2),'2 кредита');assert.equal(r.credits(5),'5 кредитов');assert.equal(r.credits(21),'21 кредит');assert.equal(locale('en').credits(42),'42 credits');
});
test('Localized HTML preserves every generation and template control and shares the same scripts',()=>{
 for(const base of ['henshin','henshin-template']){
  const en=fs.readFileSync('public/'+base+'.html','utf8'),ids=html=>Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]);
  for(const [lang,suffix]of [['hy','arm'],['ru','ru']]){
   const html=fs.readFileSync(`public/${base}_${suffix}.html`,'utf8');assert.ok(html.includes(`<html lang="${lang}">`));assert.deepEqual(ids(html),ids(en));
   const scripts=html=>Array.from(html.matchAll(/<script[^>]*src="([^"]+)"/g),m=>m[1]);assert.deepEqual(scripts(html),scripts(en));
   assert.ok(!html.includes('>Motion transfer<'));assert.ok(!html.includes('>Object swap<'));assert.ok(!html.includes('>Video edit<'));
   assert.ok(html.includes(base==='henshin'?`/henshin-template_${suffix}.html`:`/henshin_${suffix}.html`));
   assert.ok(html.includes('value="edit"')||html.includes('data-mode="edit"'));
  }
 }
});
test('Header language switching keeps Henshin page, query and anchor for HTML and clean URLs',()=>{
 const code=fs.readFileSync('public/header.js','utf8');const start=code.indexOf('  function localizedHref('),end=code.indexOf('  function profileLanguageValue',start);
 const fn=code.slice(start,end)+'\nresult=localizedHref(input, language);';
 for(const page of ['henshin','henshin-template'])for(const suffix of ['','_arm','_ru'])for(const extension of ['','.html'])for(const [language,wanted]of [['en',''],['hy','_arm'],['ru','_ru']]){
  const pathname=`/${page}${suffix}${extension}`,ctx={URL,input:pathname+'?mode=edit&ref=test#details',language,CURRENT_LANGUAGE:'en',LANGUAGE_SUFFIX:{en:'',hy:'_arm',ru:'_ru'},location:{href:'https://hansora.co'+pathname,origin:'https://hansora.co',protocol:'https:'}};
  vm.runInNewContext(fn,ctx);assert.equal(ctx.result,`/${page}${wanted}.html?mode=edit&ref=test#details`);
 }
});
