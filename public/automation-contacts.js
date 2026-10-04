(async function(){
  'use strict';
  // Contacts (like ManyChat's Contacts): everyone who wrote to the AI employee, with the tags and saved fields that
  // automations set (stored on the contact's profile). Tags can be added and removed here too.
  const api=window.HansoraAutomation;const ui=window.HansoraUI;const $=selector=>document.querySelector(selector);
  const params=new URLSearchParams(location.search);const businessId=params.get('business')||(api.isLocalPreview?'preview':'');
  const previewSuffix=api.isLocalPreview&&location.protocol!=='file:'?'&preview=1':'';
  const user=await api.requireUser(location.pathname+location.search);if(!user)return;
  if(!api.isLocalPreview&&!/^[0-9a-f-]{36}$/i.test(businessId))return fail('This contacts link is invalid.');
  $('#contacts-back').href=`automation-agent.html?id=${encodeURIComponent(businessId)}${previewSuffix}`;
  let contacts=[];let conversations={};
  try{await load()}catch(error){return fail(api.displayError(error))}
  $('#contacts-loading').hidden=true;$('#contacts-app').hidden=false;render();
  ['#contacts-search','#contacts-channel','#contacts-tag'].forEach(selector=>$(selector).addEventListener('input',render));
  $('#contacts-rows').addEventListener('click',async event=>{
    const remove=event.target.closest('[data-remove-tag]'),add=event.target.closest('[data-add-tag]');
    if(remove){const contact=contacts.find(item=>item.id===remove.dataset.contact);await saveTags(contact,(contact.profile.tags||[]).filter(tag=>tag!==remove.dataset.removeTag))}
    if(add){const contact=contacts.find(item=>item.id===add.dataset.addTag);const tag=(prompt('New tag')||'').trim().slice(0,60);if(tag&&!(contact.profile.tags||[]).some(item=>item.toLowerCase()===tag.toLowerCase()))await saveTags(contact,[...(contact.profile.tags||[]),tag])}
  });

  async function load(){
    if(api.isLocalPreview){contacts=previewContacts();return}
    const [people,chats]=await Promise.all([
      api.db.from('automation_contacts').select('id,display_name,primary_phone,primary_email,channel_type,profile,last_seen_at').eq('business_id',businessId).order('last_seen_at',{ascending:false}).limit(1000),
      api.db.from('automation_conversations').select('id,contact_id').eq('business_id',businessId).limit(2000)
    ]);
    if(people.error)throw people.error;
    contacts=(people.data||[]).map(item=>({...item,profile:item.profile||{}}));
    (chats.data||[]).forEach(chat=>{if(!conversations[chat.contact_id])conversations[chat.contact_id]=chat.id});
  }
  async function saveTags(contact,tags){
    const profile={...contact.profile,tags};
    if(!api.isLocalPreview){const result=await api.db.from('automation_contacts').update({profile}).eq('id',contact.id).eq('business_id',businessId);if(result.error)return ui.toast(api.displayError(result.error))}
    contact.profile=profile;render();
  }
  function render(){
    const query=$('#contacts-search').value.trim().toLowerCase(),channel=$('#contacts-channel').value,tag=$('#contacts-tag').value;
    const tags=[...new Set(contacts.flatMap(item=>item.profile.tags||[]))].sort((a,b)=>a.localeCompare(b));
    const tagSelect=$('#contacts-tag');const current=tagSelect.value;tagSelect.innerHTML='<option value="">All tags</option>'+tags.map(name=>`<option value="${escapeAttribute(name)}">${escapeHtml(name)}</option>`).join('');tagSelect.value=tags.includes(current)?current:'';
    const shown=contacts.filter(item=>(!channel||item.channel_type===channel)&&(!tagSelect.value||(item.profile.tags||[]).includes(tagSelect.value))&&(!query||[item.display_name,item.profile.username,item.primary_email,item.primary_phone,...(item.profile.tags||[]),...Object.values(item.profile.fields||{})].join(' ').toLowerCase().includes(query)));
    $('#contacts-count').textContent=`${contacts.length} contact${contacts.length===1?'':'s'}`;
    $('#contacts-rows').innerHTML=shown.slice(0,500).map(row).join('');$('#contacts-empty').hidden=Boolean(shown.length);
  }
  function row(item){
    const name=item.display_name||(item.profile.username?`@${item.profile.username}`:'Customer');const handle=item.profile.username?`@${item.profile.username}`:item.primary_phone||item.primary_email||'';
    const avatar=/^https:\/\//.test(String(item.profile.profile_pic||''))?`<img src="${escapeAttribute(item.profile.profile_pic)}" alt="">`:`<i>${escapeHtml(name.replace(/^@/,'').slice(0,1).toUpperCase())}</i>`;
    const fields={...(item.profile.fields||{}),...(item.primary_email?{email:item.primary_email}:{}),...(item.primary_phone?{phone:item.primary_phone}:{})};
    const chat=conversations[item.id];const channels={instagram_dm:'Instagram',instagram_comments:'Instagram comment',whatsapp:'WhatsApp',telegram:'Telegram',messenger:'Messenger',phone:'Phone',manual:'Manual'};
    return`<div class="contacts-row" role="row"><div class="contact-who">${avatar}<span><b>${escapeHtml(name)}</b><small>${escapeHtml(channels[item.channel_type]||item.channel_type)}${handle?` · ${escapeHtml(handle)}`:''}</small></span></div><div class="contact-tags">${(item.profile.tags||[]).map(tag=>`<span>${escapeHtml(tag)}<button type="button" data-remove-tag="${escapeAttribute(tag)}" data-contact="${escapeAttribute(item.id)}" aria-label="Remove tag">×</button></span>`).join('')}<button class="add-tag" type="button" data-add-tag="${escapeAttribute(item.id)}">+ Tag</button></div><div class="contact-fields">${Object.entries(fields).slice(0,4).map(([key,value])=>`<div><em>${escapeHtml(key)}:</em> ${escapeHtml(value)}</div>`).join('')||'<em>—</em>'}</div><span class="ui-faint">${escapeHtml(relative(item.last_seen_at))}</span>${chat?`<a class="ui-btn ghost sm contact-open" href="automation-inbox.html?business=${encodeURIComponent(businessId)}&conversation=${encodeURIComponent(chat)}${previewSuffix}">Open chat</a>`:'<span></span>'}</div>`;
  }
  function previewContacts(){const now=Date.now();return[
    {id:'p1',display_name:'Anna Miller',channel_type:'instagram_dm',primary_email:'anna@example.com',primary_phone:'',last_seen_at:new Date(now-6e5).toISOString(),profile:{username:'anna.m',tags:['Lead','Follower'],fields:{interest:'kitchen'}}},
    {id:'p2',display_name:'Carlos Ruiz',channel_type:'whatsapp',primary_email:'',primary_phone:'+15550100',last_seen_at:new Date(now-36e5).toISOString(),profile:{tags:['VIP'],fields:{}}},
    {id:'p3',display_name:'Hovo',channel_type:'instagram_dm',primary_email:'',primary_phone:'091918868',last_seen_at:new Date(now-864e5).toISOString(),profile:{username:'hovo_.vardanyan',tags:['Got link'],fields:{source:'reel'}}}
  ]}
  function relative(value){const difference=Math.max(0,Date.now()-Date.parse(value||''));if(!Number.isFinite(difference))return'';if(difference<3600000)return`${Math.max(1,Math.round(difference/60000))}m ago`;if(difference<86400000)return`${Math.round(difference/3600000)}h ago`;return`${Math.round(difference/86400000)}d ago`}
  function fail(message){$('#contacts-loading').hidden=true;$('#contacts-error').textContent=message;$('#contacts-error').hidden=false}
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]))}
  function escapeAttribute(value){return escapeHtml(value).replace(/`/g,'&#96;')}
})();
