(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const loading = document.querySelector('#inbox-loading');
  const errorBox = document.querySelector('#inbox-error');
  const app = document.querySelector('#inbox-app');
  const params = new URLSearchParams(location.search);
  const businessId = params.get('business') || (api.isLocalPreview ? 'preview' : '');
  const user = await api.requireUser(location.pathname + location.search);
  if (!user) return;
  if (!api.isLocalPreview && !/^[0-9a-f-]{36}$/i.test(businessId)) return fail('This inbox link is invalid.');
  document.querySelector('#inbox-back').href = `automation-agent.html?id=${encodeURIComponent(businessId)}${api.isLocalPreview && location.protocol !== 'file:' ? '&preview=1' : ''}`;

  const previewConversations = [
    {id:'c1',name:'Anna Miller',handle:'@anna.m',channel:'Instagram DM',time:'2m',preview:'Can you deliver this to Main Street?',unread:true,attention:false,human:false,aiActive:true,intent:'Delivery question',summary:'Anna wants to order a custom cabinet and asked about delivery to Main Street. The AI provided the saved delivery price and is waiting for dimensions.',fields:[['Language','Armenian'],['Location','Main Street, the city'],['First seen','Today']],messages:[['customer','Hello, how much is delivery to Main Street?','14:02'],['ai','Delivery within the city is $5. Would you like help choosing a delivery date?','14:02'],['customer','Yes, and I want to order the cabinet from your latest post.','14:04'],['ai','Happy to help. What width and height do you need? I’ll collect the details for the team.','14:04']]},
    {id:'c2',name:'Carlos Ruiz',handle:'+1 555 010 0100',channel:'WhatsApp',time:'8m',preview:'I need to change my appointment.',unread:true,attention:true,human:false,aiActive:true,intent:'Change booking',summary:'Carlos wants to move tomorrow’s appointment. Calendar access is required before the AI can confirm another time.',fields:[['Language','Armenian'],['Phone','+1 555 010 0100'],['Existing customer','Yes']],messages:[['customer','I need to change my appointment tomorrow.','13:49'],['ai','I can help collect your preferred time, but I need a team member to confirm the calendar. Which day works for you?','13:49'],['customer','Friday after 3 PM.','13:52']]},
    {id:'c3',name:'Maria Rossi',handle:'@mariam.av',channel:'Instagram comment',time:'22m',preview:'PRICE under the newest post',unread:false,attention:false,human:false,aiActive:true,intent:'Product price',summary:'Mariam triggered the Product Questions automation. A public reply and one private message were sent.',fields:[['Language','English'],['Source','Newest Instagram post'],['Automation','Product questions']],messages:[['customer','PRICE','13:33'],['ai','Public reply: Thanks! I sent the product information to your messages.','13:33'],['ai','Private message: Hi! Which product or option would you like a price for?','13:33'],['customer','The white kitchen in the post.','13:36']]},
    {id:'c4',name:'Omar Haddad',handle:'@omar_h',channel:'Instagram DM',time:'41m',preview:'Can I speak to someone?',unread:false,attention:true,human:true,aiActive:false,intent:'Human requested',summary:'Omar explicitly requested a person. AI replies are paused and this conversation needs a staff response.',fields:[['Language','Armenian'],['Customer type','New lead'],['Handoff reason','Requested human']],messages:[['customer','Can you make this in dark wood?','12:58'],['ai','Yes, several darker finishes may be available. A team member can confirm the exact material options.','12:58'],['customer','Can I speak to someone?','13:01'],['ai','Of course. I’ve paused automatic replies and notified the team.','13:01']]},
    {id:'c5',name:'Lena Fischer',handle:'+44 7700 900012',channel:'WhatsApp',time:'1h',preview:'Thank you!',unread:false,attention:false,human:false,aiActive:true,intent:'Resolved question',summary:'Lena asked about opening hours and received the correct schedule.',fields:[['Language','Russian'],['Phone','+44 7700 900012'],['Outcome','Answered']],messages:[['customer','What time are you open today?','12:12'],['ai','We are open Monday–Saturday from 10:00 to 19:00.','12:12'],['customer','Thank you!','12:13']]},
    {id:'c6',name:'David Kim',handle:'@david.p',channel:'Instagram DM',time:'2h',preview:'Do you have a warranty?',unread:false,attention:false,human:false,aiActive:true,intent:'Policy question',summary:'David asked about warranty. The AI answered from the saved business policy.',fields:[['Language','English'],['Customer type','New'],['Outcome','Answered']],messages:[['customer','Do you have a warranty?','11:04'],['ai','Yes, completed work includes a 12-month warranty. I can explain what it covers if you’d like.','11:04']]},
    {id:'c7',name:'Sofia M.',handle:'@sofia_home',channel:'Instagram comment',time:'3h',preview:'available?',unread:true,attention:false,human:false,aiActive:true,intent:'Availability',summary:'Sofia asked about availability under a product post. The AI moved the conversation to DMs.',fields:[['Language','Armenian'],['Source','Product post'],['Automation','Product questions']],messages:[['customer','available?','10:22'],['ai','Public reply: I sent you a message with the details.','10:22'],['ai','Private message: Hi! Which size are you interested in?','10:22']]},
    {id:'c8',name:'Noah Brooks',handle:'+49 151 0000 890',channel:'WhatsApp',time:'Yesterday',preview:'I will send the measurements.',unread:false,attention:false,human:false,aiActive:true,intent:'Sales inquiry',summary:'Noah is interested in a custom kitchen and will send measurements for a quote.',fields:[['Language','Armenian'],['Phone','+49 151 0000 890'],['Lead quality','High']],messages:[['customer','Can you make a kitchen to custom measurements?','Yesterday'],['ai','Yes. Custom kitchens are planned after measurements. You can send the room dimensions or arrange a measurement visit.','Yesterday'],['customer','I will send the measurements.','Yesterday']]}
  ].map(conversation => ({...conversation,resolved:false,messages:conversation.messages.map(([role,text,time]) => ({role,text,time,counted:role === 'ai'}))}));

  let conversations;
  try { conversations = api.isLocalPreview ? previewConversations : await loadConversations(); }
  catch (error) { return fail(api.displayError(error)); }

  let selectedId = conversations.some(item => item.id === params.get('conversation')) ? params.get('conversation') : conversations[0]?.id || null;
  let activeFilter = 'all';
  if (selectedId && !api.isLocalPreview) await loadMessages(current());
  loading.hidden = true;
  app.hidden = false;
  renderList(); renderConversation();

  document.querySelector('#inbox-filters').addEventListener('click', event => {
    const button = event.target.closest('button[data-filter]'); if (!button) return;
    activeFilter = button.dataset.filter;
    document.querySelectorAll('#inbox-filters button').forEach(item => item.classList.toggle('active', item === button));
    renderList();
  });
  document.querySelector('#inbox-search').addEventListener('input', renderList);
  document.querySelector('#conversation-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-conversation-id]'); if (!button) return;
    selectedId = button.dataset.conversationId;
    document.querySelector('#inbox-app').classList.add('show-thread');
    const conversation = current(); conversation.unread = false;
    if (!api.isLocalPreview) await loadMessages(conversation);
    renderList(); renderConversation();
  });
  document.querySelector('#thread-back').addEventListener('click', () => document.querySelector('#inbox-app').classList.remove('show-thread'));
  document.querySelector('#toggle-ai').addEventListener('click', toggleAi);
  // One button next to the reply box: take over from the AI, or hand the conversation back to it.
  document.querySelector('#take-over').addEventListener('click', () => (current()?.human ? toggleAi() : takeOver()));
  document.querySelector('#resolve-conversation').addEventListener('click', async () => {
    const conversation = current(); conversation.resolved = !conversation.resolved;
    if (!api.isLocalPreview) {
      const result = await api.db.from('automation_conversations').update({status:conversation.resolved?'resolved':conversation.human?'human_handling':'open',resolved_at:conversation.resolved?new Date().toISOString():null}).eq('id',conversation.id).eq('business_id',businessId);
      if (result.error) return showError(api.displayError(result.error));
    }
    document.querySelector('#resolve-conversation').textContent = conversation.resolved ? 'Reopen' : 'Resolve';
    document.querySelector('#conversation-status').textContent = conversation.resolved ? 'Resolved' : statusText(conversation);
    renderList(); updateTopCounts();
  });
  document.querySelector('#human-composer').addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.querySelector('#human-message');
    if (!current().human) return;
    const template = templateMode() ? selectedTemplate() : null;
    if (templateMode() && !template) return showError('Choose an approved template and fill in every variable.');
    const text = template ? template.preview : input.value.trim();
    if (!text) return;
    const submit = document.querySelector('#human-composer button[type="submit"]'); submit.disabled = true;
    try {
      if (!api.isLocalPreview) {
        const payload = {business_id:businessId,conversation_id:current().id};
        if (template) payload.template = {name:template.name,language:template.language,params:template.params}; else payload.message = text;
        const response = await api.authenticatedFetch('/.netlify/functions/automation-conversation-reply',{method:'POST',body:JSON.stringify(payload)});
        const result = await response.json().catch(() => ({}));
        if (!response.ok) { if (result.error === 'whatsapp_template_required') { current().lastCustomerAt = 0; setComposerState(); } return showError(replyError(result.error)); }
      }
      current().messages.push({role:'human',text,time:'Now',counted:false}); input.value = '';
      if (template) { document.querySelector('#template-select').value = ''; renderTemplateFields(); }
      renderMessages(); renderUsage();
    } finally { setComposerState(); }
  });
  [['#create-lead','Lead created'],['#create-order','Order draft created'],['#create-booking','Booking']].forEach(([selector,label]) => document.querySelector(selector).addEventListener('click', async () => {
    const kind = selector.replace('#create-','');
    const operations = `automation-operations.html?business=${encodeURIComponent(businessId)}${api.isLocalPreview && location.protocol !== 'file:' ? '&preview=1' : ''}`;
    // A booking needs a date and time, so it opens the booking form with this customer filled in.
    if (kind === 'booking') { location.href = `${operations}&new=booking&customer=${encodeURIComponent(current().name)}&conversation=${encodeURIComponent(current().id)}`; return; }
    const id = await saveOutcome(kind); if (id === false) return;
    document.querySelector('#record-state').innerHTML = `${label} · <a href="${operations}${id ? `&record=${encodeURIComponent(id)}` : ''}">Open →</a>`; document.querySelector('#record-state').classList.add('created');
  }));
  document.querySelector('#usage-explanation').addEventListener('click', () => {
    const aiCount = current().messages.filter(message => message.counted).length;
    document.querySelector('#record-state').textContent = `${aiCount} AI replies count toward usage. Customer and human messages do not.`;
    document.querySelector('#record-state').classList.add('created');
  });

  // Customer photo when Instagram provides one; initials otherwise (and if the photo link has expired).
  function avatarHtml(conversation, fallback = initials(conversation.name)) {
    const letters = escapeHtml(fallback);
    if (!conversation.avatarUrl) return letters;
    return `<img class="ui-avatar-photo" src="${escapeHtml(conversation.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode(this.dataset.fallback))" data-fallback="${letters}">`;
  }
  function renderList() {
    const query = document.querySelector('#inbox-search').value.trim().toLowerCase();
    const visible = conversations.filter(conversation => {
      const matchesFilter = activeFilter === 'all' || (activeFilter === 'unread' && conversation.unread) || (activeFilter === 'attention' && conversation.attention) || (activeFilter === 'human' && conversation.human);
      return matchesFilter && (!query || `${conversation.name} ${conversation.handle} ${conversation.preview} ${conversation.channel}`.toLowerCase().includes(query));
    });
    const icons = {'Instagram DM':'instagram','Instagram comment':'comment','WhatsApp':'whatsapp','Phone':'phone'};
    document.querySelector('#conversation-list').innerHTML = visible.length ? visible.map(conversation => {
      const state = conversation.resolved ? '' : conversation.attention ? '<span class="ui-badge red sm">Needs you</span>' : conversation.human ? '<span class="ui-badge amber sm">Your team</span>' : '';
      return `<button class="ui-convo${conversation.id === selectedId ? ' active' : ''}${conversation.unread ? ' unread' : ''}${conversation.resolved ? ' resolved' : ''}" data-conversation-id="${escapeHtml(conversation.id)}" type="button"><span class="ui-convo-avatar">${avatarHtml(conversation)}<i class="ui-convo-channel ${icons[conversation.channel] || ''}">${window.HansoraUI.icon(icons[conversation.channel] || 'message')}</i></span><span class="ui-convo-body"><span class="ui-convo-top"><strong>${escapeHtml(conversation.name)}</strong><time>${escapeHtml(conversation.time)}</time></span><span class="ui-convo-preview">${escapeHtml(conversation.preview)}</span>${state}</span></button>`;
    }).join('') : `<div class="ui-empty">${conversations.length ? 'No conversations match.' : 'New Instagram and WhatsApp conversations appear here.'}</div>`;
    updateTopCounts();
  }

  function renderConversation() {
    const conversation = current();
    if (!conversation) {
      document.querySelector('#conversation-name').textContent = 'No conversations yet';
      document.querySelector('#conversation-status').textContent = 'New Instagram and WhatsApp messages will appear here.';
      document.querySelector('#message-timeline').innerHTML = '';
      document.querySelector('.conversation-controls').hidden = true;
      document.querySelector('#conversation-notice').hidden = true;
      document.querySelector('#human-composer').hidden = true;
      document.querySelector('.customer-panel').hidden = true;
      return;
    }
    document.querySelector('#conversation-channel').textContent = conversation.channel;
    document.querySelector('#conversation-name').textContent = conversation.name;
    document.querySelector('#conversation-status').textContent = conversation.resolved ? 'Resolved' : statusText(conversation);
    document.querySelector('#toggle-ai').textContent = conversation.aiActive ? 'Pause AI' : 'Resume AI';
    document.querySelector('#resolve-conversation').textContent = conversation.resolved ? 'Reopen' : 'Resolve';
    const notice = document.querySelector('#conversation-notice');
    notice.className = `ui-thread-notice${conversation.aiActive ? '' : ' paused'}`;
    notice.innerHTML = conversation.aiActive ? '<i></i><strong>AI is replying</strong><span>using your saved knowledge and rules</span>' : '<i></i><strong>AI is paused</strong><span>your team is handling this conversation</span>';
    renderMessages(); renderCustomer(); setComposerState(); renderUsage();
  }

  function renderMessages() {
    const labels = { customer:current().name, ai:'AI employee', human:'Your team' };
    document.querySelector('#message-timeline').innerHTML = current().messages.map((message, index, all) => {
      const grouped = index > 0 && all[index - 1].role === message.role;
      return `<div class="ui-msg ${message.role}${grouped ? ' grouped' : ''}">${grouped ? '' : `<span class="ui-msg-meta">${escapeHtml(labels[message.role] || '')} · ${escapeHtml(message.time)}${message.role === 'ai' && message.counted ? ' · billed' : ''}</span>`}<p>${escapeHtml(message.text)}</p></div>`;
    }).join('') || '<div class="ui-empty">No messages yet.</div>';
    const timeline = document.querySelector('#message-timeline'); timeline.scrollTop = timeline.scrollHeight;
  }

  function renderCustomer() {
    const conversation = current();
    document.querySelector('#customer-avatar').innerHTML = avatarHtml(conversation, conversation.name.split(' ').map(part => part[0]).join('').slice(0,2).toUpperCase());
    document.querySelector('#customer-name').textContent = conversation.name;
    document.querySelector('#customer-handle').textContent = conversation.handle;
    document.querySelector('#customer-fields').innerHTML = conversation.fields.map(([label,value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    document.querySelector('#customer-summary').textContent = conversation.summary;
    document.querySelector('#detected-intent').textContent = conversation.intent;
    document.querySelector('#record-state').textContent = ''; document.querySelector('#record-state').classList.remove('created');
  }

  function renderUsage() {
    const messages = current().messages;
    const customer = messages.filter(message => message.role === 'customer').length;
    const ai = messages.filter(message => message.role === 'ai').length;
    const human = messages.filter(message => message.role === 'human').length;
    const billable = messages.filter(message => message.role === 'ai' && message.counted).length;
    document.querySelector('#customer-message-count').textContent = customer;
    document.querySelector('#ai-message-count').textContent = ai;
    document.querySelector('#human-message-count').textContent = human;
    document.querySelector('#billable-message-count').textContent = billable;
  }

  async function toggleAi() {
    const conversation = current(); conversation.aiActive = !conversation.aiActive; conversation.human = !conversation.aiActive;
    if (!api.isLocalPreview) {
      const result = await api.db.from('automation_conversations').update({ai_enabled:conversation.aiActive,status:conversation.human?'human_handling':'open'}).eq('id',conversation.id).eq('business_id',businessId);
      if (result.error) return showError(api.displayError(result.error));
    }
    renderConversation(); renderList();
  }
  async function takeOver() { const conversation = current(); conversation.aiActive = false; conversation.human = true; if (!api.isLocalPreview) { const result=await api.db.from('automation_conversations').update({ai_enabled:false,status:'human_handling'}).eq('id',conversation.id).eq('business_id',businessId); if(result.error)return showError(api.displayError(result.error)); } renderConversation(); renderList(); document.querySelector('#human-message').focus(); }
  function setComposerState() {
    const enabled = current().human && !current().resolved;
    const useTemplate = templateMode();
    renderWindow();
    document.querySelector('#human-message').hidden = useTemplate;
    document.querySelector('#template-picker').hidden = !useTemplate;
    if (useTemplate && enabled) loadTemplates();
    document.querySelector('#human-message').disabled = !enabled;
    document.querySelector('#template-select').disabled = !enabled;
    document.querySelector('#human-composer button[type="submit"]').disabled = !enabled;
    document.querySelector('#human-composer button[type="submit"]').textContent = useTemplate ? 'Send template' : 'Send';
    document.querySelector('#composer-help').textContent = !enabled ? 'The AI is replying. Take over to write yourself.' : useTemplate ? 'Meta may charge for template messages.' : 'The AI stays paused until you give the chat back to it.';
    document.querySelector('#take-over').hidden = current().resolved;
    document.querySelector('#take-over').textContent = current().human ? 'Give back to AI' : 'Take over';
  }
  // WhatsApp only allows free-form replies within 24 hours of the customer's last message; after that, approved templates.
  function windowRemaining(conversation) {
    if (!conversation || conversation.channelType !== 'whatsapp' || api.isLocalPreview) return null;
    return conversation.lastCustomerAt ? 24 * 60 * 60 * 1000 - (Date.now() - conversation.lastCustomerAt) : 0;
  }
  function templateMode() { const remaining = windowRemaining(current()); return remaining !== null && remaining <= 0; }
  function renderWindow() {
    const box = document.querySelector('#wa-window'); const remaining = windowRemaining(current());
    box.hidden = remaining === null; if (remaining === null) return;
    if (remaining <= 0) { box.className = 'wa-window closed'; box.textContent = '24-hour window closed · only approved templates can be sent'; return; }
    const hours = Math.floor(remaining / 3600000); const minutes = Math.max(1, Math.floor(remaining % 3600000 / 60000));
    box.className = `wa-window${remaining < 3 * 3600000 ? ' closing' : ''}`;
    box.textContent = `Free-form replies allowed for ${hours ? `${hours}h ` : ''}${minutes}m more`;
  }
  let templates = null; let templatesLoading = false;
  async function loadTemplates(force = false) {
    if (templatesLoading || (templates && !force)) return;
    templatesLoading = true; const select = document.querySelector('#template-select');
    select.innerHTML = '<option value="">Loading templates…</option>';
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-whatsapp-templates',{method:'POST',body:JSON.stringify({business_id:businessId})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(replyError(result.error));
      templates = result.templates || [];
      select.innerHTML = templates.length ? '<option value="">Choose a template</option>' + templates.map((template, index) => `<option value="${index}">${escapeHtml(template.name.replace(/_/g,' '))} · ${escapeHtml(template.language)} · ${escapeHtml(template.category.toLowerCase())}</option>`).join('') : '<option value="">No approved templates yet</option>';
    } catch (error) { templates = null; select.innerHTML = '<option value="">Templates unavailable</option>'; showError(api.displayError(error)); }
    finally { templatesLoading = false; renderTemplateFields(); }
  }
  function renderTemplateFields() {
    const template = templates?.[document.querySelector('#template-select').value];
    const fields = document.querySelector('#template-variables');
    fields.innerHTML = template ? Array.from({length:template.variableCount}, (_, index) => `<input data-variable="${index}" maxlength="1024" placeholder="Variable {{${index + 1}}}" aria-label="Template variable ${index + 1}">`).join('') : '';
    renderTemplatePreview();
  }
  function renderTemplatePreview() {
    const preview = document.querySelector('#template-preview'); const template = selectedTemplate(true);
    if (!template) { preview.className = 'template-preview muted'; preview.textContent = templates && !templates.length ? 'Create and get templates approved in WhatsApp Manager, then reload.' : ''; return; }
    preview.className = 'template-preview'; preview.textContent = template.preview;
  }
  function selectedTemplate(allowEmpty = false) {
    const template = templates?.[document.querySelector('#template-select').value]; if (!template) return null;
    const params = [...document.querySelectorAll('#template-variables input')].map(input => input.value.trim());
    if (!allowEmpty && params.some(value => !value)) return null;
    const preview = template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index) => params[Number(index) - 1] || match);
    return {name:template.name,language:template.language,params,preview};
  }
  document.querySelector('#template-select').addEventListener('change', renderTemplateFields);
  document.querySelector('#template-variables').addEventListener('input', renderTemplatePreview);
  document.querySelector('#template-refresh').addEventListener('click', () => loadTemplates(true));
  setInterval(() => { if (current()?.channelType === 'whatsapp') setComposerState(); }, 60000);
  function replyError(code) {
    return ({whatsapp_template_required:'The 24-hour WhatsApp window has closed. Send an approved template instead.',template_not_approved:'This template is no longer approved. Reload the list and choose another.',template_variables_missing:'Fill in every template variable.',whatsapp_not_connected:'WhatsApp is not connected for this AI employee.',whatsapp_templates_unavailable:'WhatsApp templates could not be loaded. Try again shortly.',take_over_before_replying:'Take over the conversation before replying.'})[code] || code || 'manual_reply_failed';
  }
  function initials(name) { return String(name || '?').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
  function updateTopCounts() {
    const open = conversations.filter(item => !item.resolved);
    const counts = { all:conversations.length, attention:open.filter(item => item.attention).length, human:open.filter(item => item.human).length, unread:conversations.filter(item => item.unread).length };
    document.querySelectorAll('#inbox-filters [data-count]').forEach(element => { element.textContent = counts[element.dataset.count]; });
    document.querySelector('#open-count').textContent = conversations.filter(item => !item.resolved).length;
    document.querySelector('#attention-count').textContent = conversations.filter(item => item.attention && !item.resolved).length;
  }
  function current() { return conversations.find(conversation => conversation.id === selectedId) || conversations[0] || null; }
  async function loadConversations() {
    const result = await api.db.from('automation_conversations').select('id,channel_type,status,ai_enabled,intent,summary,last_message_preview,last_message_at,automation_contacts(display_name,primary_phone,primary_email,language,profile)').eq('business_id',businessId).order('last_message_at',{ascending:false}).limit(100);
    if (result.error) throw result.error;
    return (result.data || []).map(row => {
      const contact = Array.isArray(row.automation_contacts) ? row.automation_contacts[0] : row.automation_contacts || {};
      const name = contact.display_name || contact.profile?.username || (row.channel_type === 'whatsapp' ? 'WhatsApp customer' : 'Instagram customer');
      const avatarUrl = /^https:\/\//.test(String(contact.profile?.profile_pic || '')) ? String(contact.profile.profile_pic) : '';
      return {id:row.id,channelType:row.channel_type,lastCustomerAt:0,avatarUrl,name,handle:contact.primary_phone||contact.primary_email||(contact.profile?.username?`@${contact.profile.username}`:'')||contact.profile?.instagram_scoped_id||'',channel:channelName(row.channel_type),time:relativeTime(row.last_message_at),preview:row.last_message_preview||'',unread:false,attention:row.status==='needs_attention',human:row.status==='human_handling',aiActive:Boolean(row.ai_enabled),resolved:row.status==='resolved',intent:row.intent||'Customer message',summary:row.summary||'Summary will appear as the conversation develops.',fields:[['Language',contact.language||'Detected automatically'],['Channel',channelName(row.channel_type)],['Last activity',relativeTime(row.last_message_at)]],messages:[]};
    });
  }
  async function loadMessages(conversation) {
    const result = await api.db.from('automation_messages').select('sender_type,content,billable,occurred_at').eq('business_id',businessId).eq('conversation_id',conversation.id).order('occurred_at',{ascending:false}).limit(100);
    result.data = (result.data || []).reverse();
    if (result.error) throw result.error;
    const lastCustomer = [...(result.data||[])].reverse().find(row => row.sender_type === 'customer');
    conversation.lastCustomerAt = lastCustomer ? Date.parse(lastCustomer.occurred_at) : 0;
    conversation.messages = (result.data||[]).map(row => ({role:row.sender_type==='customer'?'customer':row.sender_type==='human'?'human':'ai',text:row.content,time:new Date(row.occurred_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),counted:Boolean(row.billable)}));
  }
  function channelName(value) { return ({instagram_dm:'Instagram DM',instagram_comments:'Instagram comment',whatsapp:'WhatsApp',phone:'Phone'}[value]||value); }
  function relativeTime(value) { const delta=Math.max(0,Date.now()-Date.parse(value||new Date())); const minutes=Math.floor(delta/60000); if(minutes<1)return'Now'; if(minutes<60)return`${minutes}m`; const hours=Math.floor(minutes/60); if(hours<24)return`${hours}h`; return new Date(value).toLocaleDateString(); }
  function showError(message) { errorBox.textContent=message; errorBox.hidden=false; }
  function fail(message) { loading.hidden=true; app.hidden=true; showError(message); }
  async function saveOutcome(kind) {
    const conversation = current();
    if (api.isLocalPreview) return null;
    const result = await api.db.from('automation_outcomes').insert({business_id:businessId,conversation_id:conversation.id,outcome_type:kind,title:(kind === 'lead' ? conversation.intent : `Order for ${conversation.name}`).slice(0,300) || 'Customer request',customer_name:conversation.name,customer_phone:conversation.channelType === 'whatsapp' ? conversation.handle : '',created_by:'human',status:'new',summary:conversation.summary,collected_fields:{Customer:conversation.name,Channel:conversation.channel,'AI intent':conversation.intent}}).select('id').single();
    if (result.error) { showError(api.displayError(result.error)); return false; }
    return result.data.id;
  }
  function statusText(conversation) { return conversation.human ? 'Human handling' : conversation.aiActive ? 'AI is replying' : 'AI paused'; }
  function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character])); }
})();
