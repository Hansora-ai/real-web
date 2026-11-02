// TikTok comment automation: which videos, which comments, and the public reply. TikTok does not allow messaging
// people who only commented, so unlike Instagram there are no DM steps. Saved in automation_comment_workflows with
// safety_config.trigger_type = 'tiktok_comment' (the Instagram processors ignore that type).
(async function(){
  'use strict';
  const api=window.HansoraAutomation;const ui=window.HansoraUI;
  const params=new URLSearchParams(location.search);
  const businessId=params.get('business')||(api.isLocalPreview?'preview':'');
  const workflowParam=params.get('workflow');
  const previewSuffix=api.isLocalPreview&&location.protocol!=='file:'?'&preview=1':'';
  const storeKey='hansora_tiktok_workflows_preview';
  const MAX_REPLIES=5;
  const $=selector=>document.querySelector(selector);
  const user=await api.requireUser(location.pathname+location.search);if(!user)return;
  if(!api.isLocalPreview&&!/^[0-9a-f-]{36}$/i.test(businessId))return fail('This automation link is invalid.');
  $('#tt-back').href=`automation-workflows.html?business=${encodeURIComponent(businessId)}&platform=tiktok${previewSuffix}`;

  let state={id:null,name:'Reply to comments',status:'draft',scope:'all',videoIds:[],previews:{},match:'any',keywords:[],once:true,mode:'fixed',replies:['Thanks for your comment! 🙌','Thank you! 💛 Glad you like it.'],aiNote:'',activatedAt:null,runs:0};
  let connection=null;let videos=[];let videoCursor=null;let dirty=false;
  const connected=()=>['connecting','connected'].includes(connection?.status);
  try{await Promise.all([loadWorkflow(),loadConnection()])}catch(error){return fail(api.displayError(error))}
  $('#tt-loading').hidden=true;$('#tt-app').hidden=false;
  ui.hydrateIcons?.(document);
  bind();render();

  async function loadWorkflow(){
    if(api.isLocalPreview){
      const saved=readPreview().find(flow=>flow.id===workflowParam);
      if(saved)state={...state,...saved};
      return;
    }
    if(!workflowParam)return;
    if(!/^[0-9a-f-]{36}$/i.test(workflowParam))throw new Error('This automation link is invalid.');
    const result=await api.db.from('automation_comment_workflows').select('*').eq('business_id',businessId).eq('id',workflowParam).maybeSingle();
    if(result.error)throw result.error;if(!result.data)throw new Error('This automation was not found.');
    const row=result.data,safety=row.safety_config||{};
    state={id:row.id,name:row.name,status:row.status,scope:row.post_scope||'all',videoIds:row.selected_post_ids||[],previews:safety.post_previews||{},match:row.match_type==='any'?'any':'contains',keywords:row.keywords||[],once:safety.first_comment_only!==false,mode:safety.reply_mode==='ai'?'ai':'fixed',replies:(row.public_reply_variations||[]).length?row.public_reply_variations:[''],aiNote:safety.ai_instruction||'',activatedAt:row.activated_at,runs:Number(row.triggered_count||0)};
  }
  async function loadConnection(){
    if(api.isLocalPreview){connection={status:'connected',connected_account_label:'@oak.and.co'};return}
    const result=await api.db.from('automation_channel_connections').select('status,connected_account_label').eq('business_id',businessId).eq('channel_type','tiktok').maybeSingle();
    connection=result.error?null:result.data;
  }

  function bind(){
    $('#tt-name').addEventListener('input',event=>{state.name=event.target.value;touch()});
    document.querySelectorAll('input[name="tt-scope"]').forEach(input=>input.addEventListener('change',()=>{state.scope=input.value;touch();render();if(state.scope==='selected'&&!state.videoIds.length)openPicker()}));
    document.querySelectorAll('input[name="tt-match"]').forEach(input=>input.addEventListener('change',()=>{state.match=input.value;touch();render();if(state.match==='contains')$('#tt-word-input').focus()}));
    document.querySelectorAll('input[name="tt-mode"]').forEach(input=>input.addEventListener('change',()=>{state.mode=input.value;touch();render()}));
    $('#tt-once').addEventListener('change',event=>{state.once=event.target.checked;touch()});
    $('#tt-ai-note').addEventListener('input',event=>{state.aiNote=event.target.value;touch()});
    $('#tt-word-input').addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===','){event.preventDefault();addWord(event.target.value)}
      else if(event.key==='Backspace'&&!event.target.value&&state.keywords.length){state.keywords.pop();touch();renderWords();renderPreview()}
    });
    $('#tt-word-input').addEventListener('blur',event=>addWord(event.target.value));
    $('#tt-word-list').addEventListener('click',event=>{const button=event.target.closest('[data-remove-word]');if(!button)return;state.keywords.splice(Number(button.dataset.removeWord),1);touch();renderWords();renderPreview()});
    $('#tt-replies').addEventListener('input',event=>{const field=event.target.closest('[data-reply]');if(!field)return;state.replies[Number(field.dataset.reply)]=field.value;touch();renderPreview()});
    $('#tt-replies').addEventListener('click',event=>{const button=event.target.closest('[data-remove-reply]');if(!button)return;state.replies.splice(Number(button.dataset.removeReply),1);if(!state.replies.length)state.replies=[''];touch();renderReplies();renderPreview()});
    $('#tt-add-reply').addEventListener('click',()=>{if(state.replies.length>=MAX_REPLIES)return;state.replies.push('');touch();renderReplies();document.querySelector(`[data-reply="${state.replies.length-1}"]`)?.focus()});
    $('#tt-pick').addEventListener('click',openPicker);
    $('#tt-use').addEventListener('click',useSelectedVideos);
    $('#tt-more').addEventListener('click',()=>loadVideos(true));
    document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
    $('#tt-save').addEventListener('click',()=>run($('#tt-save'),()=>save(state.status==='active'?'active':state.status==='paused'?'paused':'draft'),state.status==='active'?'Saved ✓ Live changes applied.':'Saved'));
    $('#tt-live').addEventListener('click',()=>run($('#tt-live'),()=>save('active'),'Live ✓ Hansora now replies to new comments.'));
    $('#tt-pause').addEventListener('click',()=>run($('#tt-pause'),()=>save('paused'),'Paused'));
    window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue=''}});
  }
  function touch(){dirty=true;$('#tt-save').textContent=state.status==='active'?'Save changes':'Save'}
  function addWord(value){
    const words=String(value||'').split(',').map(word=>word.trim().replace(/\s+/g,' ').slice(0,60)).filter(Boolean);
    $('#tt-word-input').value='';if(!words.length)return;
    for(const word of words)if(!state.keywords.some(item=>item.toLocaleLowerCase()===word.toLocaleLowerCase())&&state.keywords.length<20)state.keywords.push(word);
    touch();renderWords();renderPreview();
  }

  function render(){
    $('#tt-name').value=state.name;
    const live=state.status==='active';
    $('#tt-status').textContent=live?'Live':state.status==='paused'?'Paused':'Draft';
    $('#tt-dot').classList.toggle('live',live);
    $('#tt-account').textContent=connection?.connected_account_label?`TikTok ${connection.connected_account_label}`:'TikTok comments';
    $('#tt-runs').textContent=state.runs?` · ${new Intl.NumberFormat().format(state.runs)} ${state.runs===1?'reply':'replies'}`:'';
    $('#tt-live').hidden=live;$('#tt-pause').hidden=!live;
    $('#tt-save').textContent=live?'Save changes':'Save';
    const box=$('#tt-connect');
    if(!connected()){box.hidden=false;box.innerHTML=`Connect your TikTok account first, so Hansora can see your videos and reply. <a class="ui-link" href="automation-connect.html?channel=tiktok&business=${encodeURIComponent(businessId)}${previewSuffix}">Connect TikTok →</a>`}else box.hidden=true;
    for(const [name,value] of [['tt-scope',state.scope],['tt-match',state.match],['tt-mode',state.mode]])document.querySelectorAll(`input[name="${name}"]`).forEach(input=>{input.checked=input.value===value});
    $('#tt-chosen').hidden=state.scope!=='selected';
    $('#tt-words').hidden=state.match!=='contains';
    $('#tt-once').checked=state.once;
    $('#tt-fixed').hidden=state.mode!=='fixed';$('#tt-ai').hidden=state.mode!=='ai';
    $('#tt-ai-note').value=state.aiNote;
    renderThumbs();renderWords();renderReplies();renderPreview();
  }
  function renderThumbs(){
    $('#tt-thumbs').innerHTML=state.videoIds.slice(0,12).map(id=>{const preview=state.previews[id]||{};return`<figure title="${escapeAttribute(preview.caption||'TikTok video')}">${preview.thumb?`<img src="${escapeAttribute(preview.thumb)}" alt="">`:'<span>Video</span>'}</figure>`}).join('');
    $('#tt-pick').textContent=state.videoIds.length?`Change videos (${state.videoIds.length})`:'Choose videos';
  }
  function renderWords(){$('#tt-word-list').innerHTML=state.keywords.map((word,index)=>`<span class="tt-word">${escapeHtml(word)}<button type="button" data-remove-word="${index}" aria-label="Remove ${escapeAttribute(word)}">✕</button></span>`).join('')}
  function renderReplies(){
    $('#tt-replies').innerHTML=state.replies.map((reply,index)=>`<div class="tt-reply-row"><textarea class="ui-textarea" data-reply="${index}" rows="2" maxlength="1000" placeholder="${index?'Another way to say it':'e.g. Thanks! The price is in our bio 💛'}" aria-label="Reply version ${index+1}">${escapeHtml(reply)}</textarea>${state.replies.length>1?`<button class="ui-btn ghost icon sm" type="button" data-remove-reply="${index}" aria-label="Remove this version">✕</button>`:''}</div>`).join('');
    $('#tt-add-reply').hidden=state.replies.length>=MAX_REPLIES;
  }
  function renderPreview(){
    const word=state.keywords[0];
    $('#tt-preview-comment').textContent=state.match==='contains'&&word?(word.length<=12?`${word}?`:word):'How much is this? 😍';
    $('#tt-preview-you').textContent=connection?.connected_account_label||'You';
    const reply=state.mode==='ai'?'✨ It’s $320! 🌳 Send us a message on TikTok for delivery details.':(state.replies.find(value=>value.trim())||'Your reply appears here');
    $('#tt-preview-reply').textContent=reply;
    const firstThumb=state.scope==='selected'&&state.previews[state.videoIds[0]]?.thumb;
    $('#tt-preview-video').style.backgroundImage=firstThumb?`url("${String(firstThumb).replace(/"/g,'%22')}")`:'';
    $('#tt-preview-video').classList.toggle('has-thumb',Boolean(firstThumb));
  }

  // Video picker: the account's videos, newest first, 20 at a time.
  async function openPicker(){
    if(!connected()&&!api.isLocalPreview){render();return ui.toast('Connect your TikTok account first.')}
    $('#tt-picker').showModal();
    if(!videos.length)await loadVideos(false);else renderGrid();
  }
  async function loadVideos(more){
    const grid=$('#tt-grid');if(!more)grid.innerHTML='<div class="ui-skeleton" style="grid-column:1/-1;height:220px;border-radius:12px"></div>';
    $('#tt-more').disabled=true;
    try{
      if(api.isLocalPreview){videos=previewVideos();videoCursor=null}
      else{
        const response=await api.authenticatedFetch('/.netlify/functions/automation-tiktok-media',{method:'POST',body:JSON.stringify({business_id:businessId,...(more&&videoCursor?{cursor:videoCursor}:{})})});
        const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.message||result.error||'tiktok_videos_unavailable');
        const page=Array.isArray(result.media)?result.media:[];videos=more?[...videos,...page.filter(item=>!videos.some(known=>known.id===item.id))]:page;videoCursor=result.cursor||null;
      }
      renderGrid();
    }catch(error){grid.innerHTML=`<p class="ui-alert">${escapeHtml(api.displayError(error))}</p>`}
    finally{$('#tt-more').disabled=false;$('#tt-more').hidden=!videoCursor}
  }
  function renderGrid(){
    const chosen=new Set(state.videoIds);
    $('#tt-grid').innerHTML=videos.length?videos.map(video=>`<label><input type="checkbox" value="${escapeAttribute(video.id)}" ${chosen.has(video.id)?'checked':''}><span class="tt-cover">${video.thumbnail_url?`<img src="${escapeAttribute(video.thumbnail_url)}" alt="" loading="lazy">`:''}</span><span class="tt-check">✓</span><small>${escapeHtml(video.caption||'TikTok video')}</small></label>`).join(''):'<p class="ui-empty">No public videos found on this TikTok account yet.</p>';
  }
  function useSelectedVideos(){
    state.videoIds=[...document.querySelectorAll('#tt-grid input:checked')].map(input=>input.value);
    const previews={};for(const id of state.videoIds){const video=videos.find(item=>item.id===id);previews[id]=video?{thumb:video.thumbnail_url||'',caption:String(video.caption||'').slice(0,120)}:(state.previews[id]||{})}
    state.previews=previews;$('#tt-picker').close();touch();renderThumbs();renderPreview();
  }

  function validate(going){
    const name=state.name.trim();if(!name)return'Give the automation a name.';
    if(!going)return'';
    if(!connected())return'Connect your TikTok account before setting this live.';
    if(state.scope==='selected'&&!state.videoIds.length)return'Choose at least one video, or pick “All my videos”.';
    if(state.match==='contains'&&!state.keywords.length)return'Add at least one word, or pick “Any comment”.';
    if(state.mode==='fixed'&&!state.replies.some(value=>value.trim()))return'Write the reply.';
    return'';
  }
  async function save(status){
    addWord($('#tt-word-input').value);
    const problem=validate(status==='active');if(problem){ui.toast(problem);return false}
    const going=status==='active'&&state.status!=='active';
    const replies=state.replies.map(value=>value.trim()).filter(Boolean).slice(0,MAX_REPLIES);
    const payload={business_id:businessId,name:state.name.trim().slice(0,200),status,post_scope:state.scope,selected_post_ids:state.scope==='selected'?state.videoIds:[],match_type:state.match,keywords:state.match==='contains'?state.keywords:[],public_reply_variations:replies,dm_steps:[],
      safety_config:{platform:'tiktok',trigger_type:'tiktok_comment',reply_mode:state.mode,ai_instruction:state.aiNote.trim().slice(0,500),first_comment_only:state.once,ignore_own:true,exclude_keywords:[],public_reply_enabled:true,post_previews:state.scope==='selected'?state.previews:{}},
      ...(going?{activated_at:new Date().toISOString()}:{})};
    if(api.isLocalPreview){
      const flows=readPreview();const id=state.id||`tiktok-preview-${Date.now()}`;const now=new Date().toISOString();
      const saved={...state,id,status,name:payload.name,replies:replies.length?replies:[''],updatedAt:now,activatedAt:going?now:state.activatedAt};
      const index=flows.findIndex(flow=>flow.id===id);if(index>=0)flows[index]=saved;else flows.unshift(saved);
      try{localStorage.setItem(storeKey,JSON.stringify(flows))}catch(_){}
      state={...saved};
    }else{
      const query=state.id?api.db.from('automation_comment_workflows').update(payload).eq('id',state.id).eq('business_id',businessId):api.db.from('automation_comment_workflows').insert(payload);
      const result=await query.select('id,activated_at').single();if(result.error)throw result.error;
      state.id=result.data.id;state.status=status;state.activatedAt=result.data.activated_at;state.name=payload.name;
    }
    dirty=false;
    const url=new URL(location.href);url.searchParams.set('workflow',state.id);url.searchParams.delete('new');history.replaceState({},'',url);
    render();return true;
  }
  async function run(button,action,message){
    const label=button.textContent;button.disabled=true;button.textContent='Saving…';
    try{const ok=await action();if(ok)ui.toast(message)}catch(error){ui.toast(api.displayError(error))}
    finally{button.disabled=false;if(button.textContent==='Saving…')button.textContent=label;render()}
  }

  function readPreview(){try{const flows=JSON.parse(localStorage.getItem(storeKey)||'[]');return Array.isArray(flows)?flows:[]}catch(_){return[]}}
  function previewVideos(){
    const items=[['Oak coffee table — styled 3 ways','#c58b4e','#5b3a1e','48.2K'],['Corner sofa unboxing','#7d8fa6','#2f3b4c','126K'],['Small room makeover','#d9a86c','#7a4b2a','31.5K'],['Bookshelf in 60 seconds','#9fb79a','#3e5a3a','12.9K'],['Dining table for 6','#b98d6b','#4a3326','77.1K'],['Wardrobe tour','#a7a2c9','#3d3866','9.4K']];
    return items.map(([caption,top,bottom,views],index)=>({id:`tiktok-video-${index+1}`,caption,thumbnail_url:`data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='180' height='320'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${top}'/><stop offset='1' stop-color='${bottom}'/></linearGradient></defs><rect width='180' height='320' fill='url(#g)'/><circle cx='90' cy='150' r='24' fill='rgba(0,0,0,.35)'/><path d='M83 138 L102 150 L83 162 Z' fill='white'/><path d='M12 300 L12 288 L22 294 Z' fill='white'/><text x='28' y='299' font-size='14' font-weight='600' fill='white' font-family='sans-serif'>${views}</text></svg>`)}`}));
  }
  function fail(message){$('#tt-loading').hidden=true;const box=$('#tt-error');box.textContent=message;box.hidden=false}
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]))}
  function escapeAttribute(value){return escapeHtml(value).replace(/`/g,'&#96;')}
})();
