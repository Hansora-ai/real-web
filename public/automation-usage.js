(async function () {
  'use strict';
  const api=window.HansoraAutomation;
  const params=new URLSearchParams(location.search);
  const businessId=params.get('business')||(api.isLocalPreview?'preview':'');
  const user=await api.requireUser(location.pathname+location.search);if(!user)return;
  if(!api.isLocalPreview&&!/^[0-9a-f-]{36}$/i.test(businessId))return fail('This usage link is invalid.');
  document.querySelector('#usage-back').href=`automation-agent.html?id=${encodeURIComponent(businessId)}${api.isLocalPreview&&location.protocol!=='file:'?'&preview=1':''}`;
  const periodSelect=document.querySelector('#usage-period');
  const periods=[monthStart(0),monthStart(-1)];
  periodSelect.innerHTML=periods.map(date=>`<option value="${date.toISOString()}">${monthLabel(date)}</option>`).join('');

  const previewEntries=[
    ['Today · 14:04','Anna Miller','Instagram DM','Happy to help. What width and height do you need?'],['Today · 14:02','Anna Miller','Instagram DM','Delivery within the city is $5.'],['Today · 13:49','Carlos Ruiz','WhatsApp','I can help collect your preferred time.'],['Today · 13:33','Maria Rossi','Instagram comment','Thanks! I sent the product information to your messages.'],['Today · 13:33','Maria Rossi','Instagram comment','Hi! Which product or option would you like a price for?'],['Today · 12:58','Omar Haddad','Instagram DM','Yes, several darker finishes may be available.'],['Today · 12:12','Lena Fischer','WhatsApp','We are open Monday–Saturday from 10:00 to 19:00.'],['Today · 11:04','David Kim','Instagram DM','Yes, completed work includes a 12-month warranty.'],['Today · 10:22','Sofia M.','Instagram comment','I sent you a message with the details.'],['Today · 10:22','Sofia M.','Instagram comment','Hi! Which size are you interested in?']
  ].map((row,index)=>({id:index,date:row[0],customer:row[1],channel:row[2],message:row[3],counted:true}));
  let entries=[];let shown=10;
  await loadPeriod();
  document.querySelector('#usage-loading').hidden=true;document.querySelector('#usage-app').hidden=false;renderRows();
  periodSelect.addEventListener('change',async()=>{shown=10;await loadPeriod();renderRows()});
  document.querySelector('#usage-channel').addEventListener('change',()=>{shown=10;renderRows()});
  document.querySelector('#usage-search').addEventListener('input',()=>{shown=10;renderRows()});
  document.querySelector('#load-more-usage').addEventListener('click',()=>{shown+=10;renderRows()});

  async function loadPeriod(){
    if(api.isLocalPreview){entries=previewEntries;applySummary({messages:1284,credits:162.9,phoneCredits:34.5,voiceSeconds:2592,phoneCalls:37,human:146,balance:84.2,channels:{instagram_dm:764,instagram_comments:218,whatsapp:302}});return;}
    const start=new Date(periodSelect.value);const end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
    const [summary,channels,messages,conversations,contacts,human,calls,profile]=await Promise.all([
      api.db.from('automation_usage_monthly_v').select('*').eq('business_id',businessId).eq('billing_month',start.toISOString()).maybeSingle(),
      api.db.from('automation_usage_monthly_channel_v').select('*').eq('business_id',businessId).eq('billing_month',start.toISOString()),
      api.db.from('automation_messages').select('id,conversation_id,content,occurred_at,billable').eq('business_id',businessId).eq('sender_type','ai').eq('billable',true).gte('occurred_at',start.toISOString()).lt('occurred_at',end.toISOString()).order('occurred_at',{ascending:false}).limit(1000),
      api.db.from('automation_conversations').select('id,contact_id,channel_type').eq('business_id',businessId).limit(1000),
      api.db.from('automation_contacts').select('id,display_name').eq('business_id',businessId).limit(1000),
      api.db.from('automation_messages').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('sender_type','human').gte('occurred_at',start.toISOString()).lt('occurred_at',end.toISOString()),
      api.db.from('automation_calls').select('id',{count:'exact',head:true}).eq('business_id',businessId).neq('direction','test').gte('started_at',start.toISOString()).lt('started_at',end.toISOString()),
      api.client.from('profiles').select('credits').eq('user_id',user.id).maybeSingle()
    ]);
    const error=[summary,channels,messages,conversations,contacts,human,calls,profile].find(result=>result.error)?.error;if(error)return fail(api.displayError(error));
    const conversationMap=new Map((conversations.data||[]).map(item=>[item.id,item]));const contactMap=new Map((contacts.data||[]).map(item=>[item.id,item]));
    entries=(messages.data||[]).map(item=>{const conversation=conversationMap.get(item.conversation_id)||{};const contact=contactMap.get(conversation.contact_id)||{};return{id:item.id,date:new Date(item.occurred_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}),customer:contact.display_name||'Live test',channel:channelName(conversation.channel_type),message:item.content,counted:Boolean(item.billable)}});
    const channelValues={};for(const row of channels.data||[])channelValues[row.channel_type]=Number(row.billable_ai_messages||0);
    applySummary({messages:Number(summary.data?.billable_ai_messages||0),credits:Number(summary.data?.credits_used||0),phoneCredits:Number((channels.data||[]).find(row=>row.channel_type==='phone')?.credits_used||0),balance:Number(profile.data?.credits||0),voiceSeconds:Number(summary.data?.billable_voice_seconds||0),phoneCalls:Number(calls.count||0),human:Number(human.count||0),channels:channelValues});
  }
  function applySummary(data){
    // Stored credits are shown ×10 as ⚡, exactly like the Hansora header (1 AI reply = 0.1 stored = 1⚡).
    const ui=window.HansoraUI;const format=value=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(Number(value||0));const bolt=value=>`${format(Math.round(Number(value||0)*100)/10)}⚡`;
    ui.countUp(document.querySelector('#usage-balance'),Math.round(data.balance*10),value=>`${format(value)}⚡`);
    ui.countUp(document.querySelector('#usage-estimated-total'),Math.round(data.credits*10),value=>`${format(value)}⚡`);
    const phone=Math.max(0,data.phoneCredits);const ai=Math.max(0,data.credits-phone);const total=Math.max(data.credits,0.0001);
    requestAnimationFrame(()=>{document.querySelector('#usage-split-ai').style.width=`${ai/total*100}%`;document.querySelector('#usage-split-phone').style.width=`${phone/total*100}%`});
    document.querySelector('#usage-message-total').textContent=`${format(data.messages)}`;
    document.querySelector('#usage-message-cost').textContent=bolt(ai);document.querySelector('#usage-phone-cost').textContent=bolt(phone);document.querySelector('#usage-tracked-cost').textContent=bolt(data.credits);
    const seconds=Math.round(data.voiceSeconds||0);document.querySelector('#usage-phone-time').textContent=`${format(data.phoneCalls||0)} calls · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    ui.countUp(document.querySelector('#usage-instagram-dm'),data.channels.instagram_dm||0);ui.countUp(document.querySelector('#usage-instagram-comments'),data.channels.instagram_comments||0);ui.countUp(document.querySelector('#usage-whatsapp'),data.channels.whatsapp||0);ui.countUp(document.querySelector('#usage-human'),data.human||0);
    document.querySelector('#buy-credits').classList.toggle('accent',data.balance<1);
  }
  function renderRows(){
    const channel=document.querySelector('#usage-channel').value;const query=document.querySelector('#usage-search').value.trim().toLowerCase();const filtered=entries.filter(item=>(channel==='all'||item.channel===channel)&&(!query||`${item.customer} ${item.message}`.toLowerCase().includes(query)));const visible=filtered.slice(0,shown);
    document.querySelector('#usage-rows').innerHTML=visible.length?visible.map(item=>`<div class="ui-usage-row"><span class="ui-usage-when">${escapeHtml(item.date)}</span><span class="ui-usage-who"><strong>${escapeHtml(item.customer)}</strong><small>${escapeHtml(item.channel)}</small></span><p>${escapeHtml(item.message)}</p><span class="ui-badge sm blue">1⚡</span></div>`).join(''):'<div class="ui-empty">No AI replies match these filters.</div>';document.querySelector('#usage-results').textContent=`Showing ${visible.length} of ${filtered.length} replies`;document.querySelector('#load-more-usage').hidden=visible.length>=filtered.length;
  }
  function monthStart(offset){const date=new Date();return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+offset,1))}
  function duration(value){const seconds=Math.max(0,Math.round(Number(value||0)));return`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}
  function monthLabel(date){const end=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0));return`${date.toLocaleDateString([],{month:'short',day:'numeric'})} – ${end.toLocaleDateString([],{month:'short',day:'numeric'})}`}
  function channelName(value){return({instagram_dm:'Instagram DM',instagram_comments:'Instagram comment',whatsapp:'WhatsApp',telegram:'Telegram',messenger:'Messenger',phone:'Phone',test:'Live test'}[value]||value||'Unknown')}
  function fail(message){document.querySelector('#usage-loading').hidden=true;document.querySelector('#usage-app').hidden=true;const box=document.querySelector('#usage-error');box.textContent=message;box.hidden=false}
  function escapeHtml(value){return String(value||'').replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]))}
})();
