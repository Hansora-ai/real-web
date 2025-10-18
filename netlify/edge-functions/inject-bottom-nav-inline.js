// netlify/edge-functions/inject-bottom-nav-inline.js
// Injects: (1) EXACT Nano Banana header + header UI (no supabase init)
//          (2) EXACT bottom nav + overlay (1:1 from index)
// HTML-only, idempotent, no changes to auth/login/credits logic.

export default async (request, context) => {
  const res = await context.next();
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  const html = await res.text();
  const hasHeader = html.includes('id=\"navUser\"') || html.includes("id='navUser'");
  const hasBottom = html.includes('class=\"hs-bottom-nav\"') || html.includes("class='hs-bottom-nav'");
  let out = html;

  // Header from Nano Banana
  const HEADER = `<header class="sticky top-0 z-40 border-b border-base-line/60 bg-base-bg/70 backdrop-blur">
<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
<a class="flex items-center gap-3 hover:opacity-90" href="index.html">
<div class="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center font-bold">H</div>
<span class="font-semibold tracking-wide">HANSORA AI</span>
</a>
<nav class="hidden md:flex items-center gap-8 text-sm">
<a class="hover:text-white/90" href="index.html#models">Models</a>
<a class="hover:text-white/90" href="index.html#templates">Templates</a>
<a class="hover:text-white/90" href="index.html#pricing">Pricing</a>
<a class="hover:text-white/90" href="index.html#faq">FAQ</a>
</nav>
<div class="flex items-center gap-3"><a class="rounded-xl btn-brand px-3 py-2 text-sm font-semibold shadow-soft" href="login.html" id="btnLoginSignup">Login / Signup</a>



<div class="hidden items-center gap-2" id="navUser">
<span class="text-sm text-white/80 mr-2" id="navCredits">0⚡</span>
<div class="relative">
<button class="h-9 w-9 rounded-full bg-white/10 border border-white/10 overflow-hidden" id="navAvatar">
<img alt="profile" class="h-full w-full object-cover hidden" id="navAvatarImg"/>
</button>
<div class="absolute right-0 mt-2 w-48 rounded-xl border border-white/10 bg-base-bg shadow-soft p-1 text-sm hidden" id="navMenu"><a class="block rounded-lg px-3 py-2 hover:bg-white/5" href="profile.html">Profile</a><a class="block rounded-lg px-3 py-2 hover:bg-white/5" href="usage.html">History</a><a class="block rounded-lg px-3 py-2 hover:bg-white/5" href="price.html">Subscription</a><button class="w-full text-left rounded-lg px-3 py-2 hover:bg-white/5" id="btnLogout">Log out</button></div>
</div>
</div>
</div>
</div>
</header>`;
  if (!hasHeader) {
    out = out.replace(/<body([^>]*)>/i, (m,g) => `<body${g}>` + HEADER);
  }

  // Bottom nav from index
  const STYLE = ``;
  const NAV   = ``;
  if (!hasBottom) {
    out = out.replace('</body>', `${STYLE}${NAV}</body>`);
  }

  // Header UI script (without supabase init)
  const HEADER_UI = `<script>

document.getElementById('y').textContent = new Date().getFullYear();

// Supabase init
const SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
const supabase = // Header UI
const $btnLoginSignup = document.getElementById('btnLoginSignup');
const $navUser = document.getElementById('navUser');
const $navCredits = document.getElementById('navCredits');
const $navAvatar = document.getElementById('navAvatar');
const $navMenu = document.getElementById('navMenu');
const $btnLogout = document.getElementById('btnLogout');
const $navAvatarImg = document.getElementById('navAvatarImg');
function showLoggedInUI(profile, user){$btnLoginSignup.classList.add('hidden');$navUser.classList.remove('hidden');$navUser.classList.add('flex');$navCredits.textContent=(profile?.credits??0)+'⚡';if(user?.user_metadata?.avatar_url){$navAvatarImg.src=user.user_metadata.avatar_url;$navAvatarImg.classList.remove('hidden');}}
function showLoggedOutUI(){$btnLoginSignup.classList.remove('hidden');$navUser.classList.add('hidden');$navUser.classList.remove('flex');}
$navAvatar.addEventListener('click',()=>{const m=document.getElementById('navMenu');m.classList.toggle('hidden')});
document.addEventListener('click',(e)=>{if(!e.target.closest('#navAvatar')&&!e.target.closest('#navMenu'))document.getElementById('navMenu').classList.add('hidden')});
$btnLogout?.addEventListener('click',async()=>{await supabase.auth.signOut();showLoggedOutUI();});
async function getOrCreateProfile(user){const r=await supabase.from('profiles').select('credits').eq('user_id',user.id).maybeSingle();if(r.error)throw r.error;if(!r.data){const ins=await supabase.from('profiles').insert({user_id:user.id,email:user.email,credits:3}).select().single();if(ins.error)throw ins.error;return ins.data;}return r.data;}
(async()=>{const {data}=await supabase.auth.getUser();const user=data.user;if(user){try{const p=await getOrCreateProfile(user);showLoggedInUI(p,user)}catch{showLoggedOutUI()}}else{showLoggedOutUI()}})();

// Elements
const filesEl=document.getElementById('files');
const thumbsEl=document.getElementById('thumbs');
const promptEl=document.getElementById('prompt');
const runBtn=document.getElementById('runBtn');
const statusEl=document.getElementById('status');
const resultBox=document.getElementById('resultBox');
const downloadLink=document.getElementById('downloadLink');

filesEl.addEventListener('change',()=>{thumbsEl.innerHTML='';[...filesEl.files].slice(0,4).forEach(f=>{const u=URL.createObjectURL(f);const img=new Image();img.src=u;img.className='h-24 w-24 object-cover rounded-lg border border-white/10';thumbsEl.appendChild(img);});});

function showStatus(m,c=''){statusEl.textContent=m;statusEl.className='mt-2 text-sm '+c}

// Guarded renderer
let __done=false; let channel=null;
function onResult(url){
  if(__done || !url) return;
  __done = true;
  const img=new Image();
  img.onload=()=>{
    resultBox.innerHTML='';
    img.className='w-full h-full object-contain';
    resultBox.appendChild(img);
        const __name = (url.split('/').pop()||'generation');
    downloadLink.href='/.netlify/functions/download-proxy?url='+encodeURIComponent(url)+'&name='+encodeURIComponent(__name);
    downloadLink.setAttribute('download', __name);
    downloadLink.classList.remove('hidden');
    downloadLink.textContent='Download';

    showStatus('✅ Done.','text-emerald-300');
  };
  
  img.src=url;
  try{ channel?.unsubscribe?.(); }catch{}
}

// Credits + URL extraction helpers
async function chargeOneCredit(){const {data}=await supabase.auth.getUser();if(!data.user)return;const prof=await supabase.from('profiles').select('credits').eq('user_id',data.user.id).maybeSingle();const cur=prof?.data?.credits??0;if(cur < 0.5)throw new Error('Not enough credits (need 0.5).');await supabase.from('profiles').update({credits:cur-0.5}).eq('user_id',data.user.id);}

function derivePublicUrl(up){
  if (!up) return null;
  if (up.publicUrl) return up.publicUrl;
  try{
    if (up.bucket && up.objectPath && up.uploadUrl){
      const u = new URL(up.uploadUrl);
      const enc = up.objectPath.split('/').map(encodeURIComponent).join('/');
      return \`\${u.protocol}//\${u.host}/storage/v1/object/public/\${encodeURIComponent(up.bucket)}/\${enc}\`;
    }
  }catch(e){}
  return null;
}

// ADDED: make sure DB gets a row even if webhook is late/blocked
async function backfillRow(uid, rid, taskId, url){
  try{
    await fetch(
      '/.netlify/functions/kie-callback?uid='+encodeURIComponent(uid)+'&run_id='+encodeURIComponent(rid)+'&taskId='+encodeURIComponent(taskId),
      {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          status:'success',
          result:{ images:[{ url }] }
        })
      }
    );
  }catch{}
}

// Best-effort: create a submitted row immediately so Usage shows even if user leaves.
async function backfillSubmitted(uid, rid, taskId){
  try{
    await fetch('/.netlify/functions/kie-callback?uid='+encodeURIComponent(uid)+'&run_id='+encodeURIComponent(rid)+'&taskId='+encodeURIComponent(taskId||''),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ status:'submitted', result:{ images:[] } })
    });
  }catch{}
}

// Option A: poll nb-check (does NOT rely on webhook)
async function nbCheckPoll(taskId, uid, rid){
  if(!taskId) return;
  const start = Date.now();
  while(!__done && Date.now() - start < 180000){ // up to 3 min
    try{
      const r = await fetch('/.netlify/functions/nb-check?taskId='+encodeURIComponent(taskId), {
        headers: { 'X-USER-ID': uid }
      });

      let j;
      try { j = await r.json(); }
      catch {
        const txt = await r.text();
        try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
      }

      const status = String(j.status || j.data?.status || j.result?.status || j.state || '').toLowerCase();
      if(['success','succeeded','completed','done'].includes(status)){
        const url = await (async function tryExtractImageUrl(o){
          if(!o) return null;
          if(typeof o==='string'&&/^https?:\/\//.test(o)) return o;
          if(o.imageUrl) return o.imageUrl;
          if(o.outputUrl) return o.outputUrl;
          if(o.url) return o.url;
          if(o.data) { const x=await tryExtractImageUrl(o.data); if(x) return x; }
          if(o.result) { const x=await tryExtractImageUrl(o.result); if(x) return x; }
          if(Array.isArray(o.images)&&o.images[0]?.url) return o.images[0].url;
          if(Array.isArray(o.resultUrls) && o.resultUrls[0]) return o.resultUrls[0];
          if(Array.isArray(o.output)&&o.output[0]?.url) return o.output[0].url;
          return null;
        })(j);
        if(url){
          onResult(url);               // show immediately
          backfillRow(uid, rid, taskId, url); // ensure Supabase row exists
        }
        break;
      }
      if(['failed','error'].includes(status)){
        showStatus('❌ Generation failed.','text-rose-300');
        break;
      }
    }catch{}
    await new Promise(r=>setTimeout(r,1500));
  }
}

// Main run
window.__run=async function(){
  const {data:authData}=await supabase.auth.getUser();
  if(!authData.user){ alert('Please log in or register first.'); return; }

  // HARD CREDIT CHECK (surgical): prevent run if credits insufficient
  try{
    const { data: prof } = await supabase.from('profiles').select('credits').eq('user_id', authData.user.id).maybeSingle();
    const cur = prof?.credits ?? 0;
    if (cur < 0.5) {
      showStatus('Not enough credits (need 0.5).','text-rose-300');
      runBtn.disabled = false; runBtn.textContent = "Run (cost: 0.5⚡)";
      return;
    }
  }catch(_){ /* ignore, but don't proceed if unknown? proceed cautiously */ }

  __done=false;
  const files=[...filesEl.files];
  if(!files.length){alert('Choose at least one image.');return;}
  if(files.length>4){alert('Max 4 images.');return;}
  for(const f of files){if(f.size>10*1024*1024){alert('File too large: '+f.name);return;}}

  runBtn.disabled=true;runBtn.textContent='Uploading…';
  showStatus('Uploading images…','text-zinc-400');
  resultBox.innerHTML='<span class="text-xs text-zinc-500 animate-pulse">Generating… this can take ~20–60s</span>';

  try{
    const uid=authData.user.id;
    const rid=uid+'-'+Date.now();

    // ==== FIX: await all uploads, then proceed ====
    if (!window.kieUploadBridge || typeof window.kieUploadBridge.upload !== 'function') {
      throw new Error('upload_bridge_missing');
    }

    const uploadOne = async (f) => {
      const up = await window.kieUploadBridge.upload(f);
      const url = derivePublicUrl(up);
      if (!url) throw new Error('no_public_url');
      // Best effort warm HEAD to reduce signed-url cache lag
      try { await fetch(url, { method: 'HEAD', cache: 'no-store' }); } catch {}
      return url;
    };

    const settled = await Promise.allSettled(files.map(uploadOne));
    const urls = settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value);

    // guard: if no URLs were produced, stop here
    if (urls.length === 0) {
      showStatus('Upload failed: no image URLs to send','text-rose-300');
      runBtn.disabled = false; runBtn.textContent = 'Run (cost: 0.5⚡)';
      return;
    }

    runBtn.textContent='Submitting…';
    showStatus('Submitting…','text-zinc-400');

    // create job
    const res=await fetch('/.netlify/functions/run-nano-banana',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-USER-ID':uid},
      body:JSON.stringify({urls, prompt: (promptEl.value||'.'), format:'png', size:(document.getElementById('size')?.value||'auto'), run_id: rid})
    });

    if (res.status === 202 || res.ok) {
      await chargeOneCredit();
    } else {
      const errT = await res.text().catch(()=> '');
      throw new Error('Create failed: ' + errT);
    }

    const resJson = await res.json().catch(()=> ({}));
    const taskId = resJson?.taskId || resJson?.data?.taskId || resJson?.id || null;

    // ensure Usage shows even if user navigates away
    backfillSubmitted(uid, rid, taskId);

    showStatus('✅ Submitted. Waiting for result…','text-emerald-300');
    runBtn.textContent='Processing…';

    // subscribe to Supabase (if webhook inserts there)
    channel = supabase.channel('nb_results_' + rid)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'nb_results', filter: 'run_id=eq.' + rid },
        (payload) => {
          const url = payload?.new?.image_url;
          if (url) onResult(url);
        }
      )
      .subscribe();

    // start polling taskId (and backfill DB when done)
    nbCheckPoll(taskId, uid, rid);

    // fallback: poll table directly in case realtime is blocked
    const started = Date.now();
    while (!__done && Date.now() - started < 500000) { // up to 120s
      await new Promise(r => setTimeout(r, 1500));
      const { data: row } = await supabase
        .from('nb_results')
        .select('image_url')
        .eq('user_id', uid)
        .eq('run_id', rid)
        .limit(1)
        .maybeSingle();

      const url = row?.image_url || null;
      if (url) { onResult(url); break; }
    }

    if (!__done) {
      showStatus('Still processing… you can wait or try again.','text-yellow-300');
    }

  }catch(e){
    showStatus('❌ '+(e.message||String(e)),'text-rose-300')
  }finally{
    runBtn.disabled=false;runBtn.textContent='Run (cost: 0.5⚡)';
  }
};

</script>`;
  out = out.replace('</body>', HEADER_UI + '</body>');

  return new Response(out, { status: res.status, headers: res.headers });
};
