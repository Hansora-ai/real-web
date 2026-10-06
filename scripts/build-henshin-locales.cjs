// Generate translated HTML shells. All languages share the same application logic.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..','public'),context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'henshin-i18n.js'),'utf8'),context);
const {t,href}=context.window.HenshinI18n;
const decode=text=>text.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const escape=text=>text.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
for(const [lang,suffix]of [['hy','arm'],['ru','ru']])for(const base of ['henshin','henshin-template']){
 let html=fs.readFileSync(path.join(root,base+'.html'),'utf8').replace('<html lang="en">',`<html lang="${lang}">`);
 html=html.replace(/>([^<>]+)</g,(_m,value)=>{const text=value.trim();return '>'+value.replace(text,escape(t(decode(text),{},lang)))+'<';});
 html=html.replace(/\b(aria-label|placeholder|content)="([^"]*)"/g,(_m,name,value)=>`${name}="${escape(t(decode(value),{},lang))}"`);
 html=html.replace(/\bhref="(\/(?:henshin(?:-template)?|usage)\.html)"/g,(_m,url)=>`href="${href(url,lang)}"`);
 fs.writeFileSync(path.join(root,`${base}_${suffix}.html`),html);
}
