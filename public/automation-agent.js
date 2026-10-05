(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const ui = window.HansoraUI;
  const $ = selector => document.querySelector(selector);
  const loading = $('#agent-loading');
  const errorBox = $('#agent-error');
  const workspace = $('#agent-workspace');
  const id = new URLSearchParams(location.search).get('id');
  const user = await api.requireUser(location.pathname + location.search);
  if (!user) return;
  const previewLinks = api.isLocalPreview && location.protocol !== 'file:';

  if (api.isLocalPreview) {
    loading.hidden = true;
    workspace.hidden = false;
    render(getPreviewBusiness());
    return;
  }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return fail('This AI employee link is invalid.');
  const result = await api.db
    .from('automation_businesses')
    .select('id,name,category,description,status,automation_agents(*),automation_business_knowledge(*),automation_channel_connections(*)')
    .eq('id', id)
    .maybeSingle();
  loading.hidden = true;
  if (result.error) return fail(api.displayError(result.error));
  if (!result.data) return fail('AI employee not found, or you do not have access to it.');
  workspace.hidden = false;
  render(result.data);
  showInstagramIdentity(result.data);

  // The connected Instagram photo and @name replace the letter, so each AI employee is easy to recognise.
  async function showInstagramIdentity(business) {
    const instagram = (business.automation_channel_connections || []).find(item => item.channel_type === 'instagram_dm' && item.status !== 'not_connected');
    if (!instagram) return;
    const showName = username => {
      const label = String(username || '').replace(/^@/, '');
      if (!label || document.querySelector('#agent-instagram')) return;
      const tag = document.createElement('span');
      tag.id = 'agent-instagram';
      tag.className = 'ui-agent-ig';
      tag.innerHTML = window.HansoraUI?.icon('instagram') || '';
      tag.append(`@${label}`);
      $('#business-name').after(' · ', tag);
    };
    showName(instagram.connected_account_label);
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-instagram-profile', { method:'POST', body:JSON.stringify({ business_ids:[business.id] }) });
      const card = (await response.json().catch(() => ({})))?.profiles?.[business.id];
      if (!card) return;
      showName(card.username);
      if (card.picture) {
        const image = new Image(); image.className = 'ui-avatar-photo'; image.alt = ''; image.referrerPolicy = 'no-referrer';
        image.onload = () => $('#agent-avatar').prepend(image);
        image.src = card.picture;
      }
    } catch (error) { console.warn('Instagram profile lookup failed', error); }
  }

  function render(business) {
    const agent = Array.isArray(business.automation_agents) ? business.automation_agents[0] : business.automation_agents;
    const profile = Array.isArray(business.automation_business_knowledge) ? business.automation_business_knowledge[0] || {} : business.automation_business_knowledge || {};
    const name = agent?.display_name || business.name;
    document.title = `${name} — Hansora Automation`;
    $('#agent-name').textContent = name;
    $('#crumb-name').textContent = name;
    $('#agent-initial').textContent = name.trim().charAt(0).toUpperCase() || 'A';
    $('#business-name').textContent = business.name;
    const status = String(agent?.status || business.status || 'draft');
    const statusBadge = $('#agent-status');
    statusBadge.textContent = capitalize(status);
    statusBadge.classList.add(status === 'active' ? 'green' : status === 'paused' ? 'amber' : 'blue');
    if (status === 'active') { statusBadge.classList.add('live'); $('#agent-presence').classList.add('on'); }
    const providerState = $('#provider-state');
    if (api.isLocalPreview) providerState.textContent = 'Preview mode';
    else {
      const notice = sessionStorage.getItem('hansora_automation_sync_notice');
      providerState.textContent = notice || 'AI provider syncs when you save';
      sessionStorage.removeItem('hansora_automation_sync_notice');
    }
    const previewSuffix = previewLinks ? '&preview=1' : '';
    const editUrl = `automation-setup.html?id=${encodeURIComponent(business.id)}${previewSuffix}`;
    $('#edit-agent').href = editUrl;
    $('#voice-talk-name').textContent = name;
    window.HansoraVoiceTest.mount({
      api, businessId:business.id, preview:api.isLocalPreview,
      elements:{ root:$('#voice-talk'), button:$('#voice-talk-call'), orb:$('#voice-talk-orb'), status:$('#voice-talk-status'), timer:$('#voice-talk-timer'), error:$('#voice-talk-error'), audio:$('#voice-talk-audio') }
    });
    $('#edit-knowledge').href = editUrl;
    $('#crumb-home').href = `automation-dashboard.html${previewLinks ? '?preview=1' : ''}`;
    const sharedQuery = new URLSearchParams({business:business.id});
    if (previewLinks) sharedQuery.set('preview','1');
    const appQuery = `?${sharedQuery}`;
    $('#inbox-link').href = `automation-inbox.html${appQuery}`;
    $('#operations-link').href = `automation-operations.html${appQuery}`;
    $('#usage-link').href = `automation-usage.html${appQuery}`;
    $('#usage-log-link').href = `automation-usage.html${appQuery}`;
    $('#tools-link').href = `automation-tools.html${appQuery}`;
    $('#actions-link').href = `automation-tools.html${appQuery}`;

    renderKnowledge(business, agent, profile);
    setupKnowledgeFiles(business.id);
    renderChannels(business);
    renderActions(appQuery, api.isLocalPreview ? {calendar:true, orders:true, leads:false, notifications:'WhatsApp + email'} : null);
    if (!api.isLocalPreview) loadActions(business.id, appQuery);

    const usage = api.isLocalPreview ? {messages:1284,resolved_rate:91,handoffs:3,credits:162.9,phone_credits:34.5,balance:84.2,phone_minutes:43} : {messages:0,resolved_rate:0,handoffs:0,credits:0,phone_credits:0,balance:null,phone_minutes:0};
    renderUsage(usage);
    initializeLiveTest(business, profile);
    if (!api.isLocalPreview) loadUsageSummary(business.id);
  }

  // Knowledge files live in the ElevenLabs knowledge base (automation-knowledge); the AI searches them per question.
  function setupKnowledgeFiles(businessId) {
    const list = $('#kfiles-list'), status = $('#kfiles-status'), hint = status.textContent;
    const controls = ['#kfiles-file', '#kfiles-link-toggle', '#kfiles-text-toggle', '#kfiles-link-form button', '#kfiles-text-form button'];
    const typeLabel = { file:'File', url:'Web', text:'Text' };
    let busy = false;
    const setBusy = value => { busy = value; controls.forEach(selector => { const element = $(selector); if (element) element.disabled = value; }); $('.ui-kfiles-upload').classList.toggle('is-busy', value); };
    const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const render = documents => {
      list.innerHTML = documents.length ? documents.map(document => `<div class="ui-kfile"><span class="ui-kfile-type">${typeLabel[document.type] || 'Doc'}</span><span class="ui-kfile-main"><strong>${escapeHtml(document.name)}</strong><small>${escapeHtml(document.url || (document.size_bytes ? size(document.size_bytes) : document.characters ? `${Number(document.characters).toLocaleString()} characters` : ''))}</small></span><button class="ui-btn ghost sm" type="button" data-remove-knowledge="${escapeHtml(document.id)}">Remove</button></div>`).join('')
        : '<p class="ui-faint">No files yet. Add your menu, price list or website pages.</p>';
    };
    const message = result => ({
      knowledge_file_type_not_supported:'This file type is not supported. Use PDF, Word, TXT, Markdown, HTML or EPUB.',
      knowledge_file_too_large:'This file is larger than 4 MB. Split it or remove large images, then try again.',
      knowledge_file_empty:'This file is empty.',
      knowledge_url_invalid:'Enter a full web address that starts with https://',
      knowledge_text_empty:'Paste some text first.',
      knowledge_text_too_long:'This text is too long. Split it into a few parts.',
      knowledge_limit_reached:'You have reached 50 items. Remove one to add another.',
      ai_employee_not_ready:'Save your AI employee first, then add knowledge files.',
      elevenlabs_request_failed:`The AI provider could not add this${result.detail ? `: ${result.detail}` : '.'}`
    }[result.error] || 'Knowledge could not be updated. Please try again.');
    const call = async payload => {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-knowledge', { method:'POST', body:JSON.stringify({ business_id:businessId, ...payload }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(message(result));
      return result.documents || [];
    };
    const run = async (label, payload, done) => {
      if (busy) return;
      setBusy(true); status.textContent = label; ui.busy(label);
      try { render(await call(payload)); status.textContent = hint; if (done) done(); ui.toast('Knowledge updated. Your AI employee uses it right away.'); }
      catch (error) { status.textContent = error.message; }
      finally { setBusy(false); ui.busy(false); }
    };

    if (api.isLocalPreview) {
      render([{ id:'p1', type:'file', name:'Price list 2026.pdf', size_bytes:482000 }, { id:'p2', type:'url', name:'Delivery page', url:'https://example.com/delivery' }]);
      status.textContent = 'Preview mode: files are not uploaded.'; setBusy(true);
      return;
    }
    call({ action:'list' }).then(render).catch(error => { list.innerHTML = ''; status.textContent = error.message; });

    $('#kfiles-file').addEventListener('change', event => {
      const file = event.target.files[0]; event.target.value = '';
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) { status.textContent = 'This file is larger than 4 MB. Split it or remove large images, then try again.'; return; }
      const reader = new FileReader();
      reader.onload = () => run(`Uploading ${file.name}…`, { action:'add', kind:'file', filename:file.name, content_base64:String(reader.result).split(',')[1] || '' });
      reader.onerror = () => { status.textContent = 'This file could not be read.'; };
      reader.readAsDataURL(file);
    });
    $('#kfiles-link-toggle').addEventListener('click', () => { $('#kfiles-link-form').hidden = !$('#kfiles-link-form').hidden; $('#kfiles-text-form').hidden = true; });
    $('#kfiles-text-toggle').addEventListener('click', () => { $('#kfiles-text-form').hidden = !$('#kfiles-text-form').hidden; $('#kfiles-link-form').hidden = true; });
    $('#kfiles-link-form').addEventListener('submit', event => {
      event.preventDefault();
      run('Reading the web page…', { action:'add', kind:'url', url:$('#kfiles-url').value.trim() }, () => { $('#kfiles-url').value = ''; $('#kfiles-link-form').hidden = true; });
    });
    $('#kfiles-text-form').addEventListener('submit', event => {
      event.preventDefault();
      run('Adding text…', { action:'add', kind:'text', name:$('#kfiles-text-name').value.trim(), text:$('#kfiles-text').value }, () => { $('#kfiles-text-name').value = ''; $('#kfiles-text').value = ''; $('#kfiles-text-form').hidden = true; });
    });
    list.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-knowledge]');
      if (!button || busy || !confirm('Remove this from your AI employee’s knowledge?')) return;
      run('Removing…', { action:'remove', document_id:button.dataset.removeKnowledge });
    });
  }

  function renderKnowledge(business, agent, profile) {
    const languages = (agent?.supported_languages || []).map(api.languageName).join(', ');
    const checks = [
      ['Business description', Boolean(business.description), api.businessType(business.category)?.label || business.category || ''],
      ['Products and prices', Boolean(profile.services_and_prices), ''],
      ['Opening hours', Boolean(profile.opening_hours), ''],
      ['Delivery and service areas', Boolean(profile.delivery_and_service_areas), ''],
      ['Questions and answers', Boolean(profile.frequently_asked_questions), ''],
      ['Rules and policies', Boolean(profile.policies), ''],
      ['Languages', Boolean(languages), languages]
    ];
    $('#knowledge-summary').innerHTML = checks.map(([label, done, detail]) => `<div class="ui-check${done ? ' done' : ''}"><i>${done ? ui.icon('check') : ''}</i>${escapeHtml(label)}${detail ? `<em>${escapeHtml(detail)}</em>` : done ? '' : '<em>Not added</em>'}</div>`).join('');
  }

  function renderChannels(business) {
    const meta = {
      instagram_dm: ['Instagram DMs', 'Answer private messages with your business knowledge', 'instagram', 'instagram'],
      instagram_comments: ['Instagram comments', 'Reply to comments and follow up in DMs', 'comment', 'instagram'],
      whatsapp: ['WhatsApp', 'Handle customer chats on your business number', 'whatsapp', 'whatsapp'],
      phone: ['Phone calls', 'Answer calls with a natural voice', 'phone', 'phone'],
      telegram: ['Telegram', 'Answer chats on your Telegram account (Telegram Business)', 'telegram', 'telegram'],
      messenger: ['Messenger', 'Answer Facebook Messenger chats of your Page', 'messenger', 'messenger']
    };
    const businessQuery = `business=${encodeURIComponent(business.id)}${previewLinks ? '&preview=1' : ''}`;
    const destinations = {
      instagram_dm: `automation-connect.html?channel=instagram&${businessQuery}`,
      instagram_comments: `automation-workflows.html?${businessQuery}`,
      whatsapp: `automation-connect.html?channel=whatsapp&${businessQuery}`,
      phone: `automation-phone.html?${businessQuery}`,
      telegram: `automation-connect.html?channel=telegram&${businessQuery}`,
      messenger: `automation-connect.html?channel=messenger&${businessQuery}`
    };
    const channels = (business.automation_channel_connections || []).sort((a, b) => a.setup_order - b.setup_order);
    $('#channel-stack').innerHTML = channels.map(channel => {
      const [title, description, iconName, tone] = meta[channel.channel_type] || [channel.channel_type, '', 'message', ''];
      const badge = channel.status === 'connected' ? '<span class="ui-badge dot green live">Live</span>'
        : channel.status === 'connecting' ? '<span class="ui-badge dot amber">Finish setup</span>'
        : channel.status === 'error' ? '<span class="ui-badge dot red">Needs attention</span>'
        : `<span class="ui-badge">${channel.channel_type === 'instagram_comments' ? 'Build flow' : 'Connect'}</span>`;
      return `<a class="ui-row" href="${destinations[channel.channel_type] || '#'}"><span class="ui-icon-tile ${tone}">${ui.icon(iconName)}</span><span class="ui-row-main"><span class="ui-row-title">${escapeHtml(title)}</span><span class="ui-row-sub">${escapeHtml(description)}</span></span>${badge}<span class="ui-chevron">${ui.icon('chevron')}</span></a>`;
    }).join('');
    const connected = channels.filter(channel => channel.status === 'connected').length;
    const count = $('#channel-count');
    count.textContent = `${connected} of ${channels.length || 6} live`;
    count.classList.toggle('green', connected > 0);
  }

  function renderActions(appQuery, state) {
    const rows = [
      ['calendar', 'Bookings', 'Check free times and book appointments', 'calendar', 'calendar'],
      ['orders', 'Orders', 'Collect every detail and create orders', 'bag', 'orders'],
      ['leads', 'Leads', 'Save interested customers for sales', 'spark', 'leads'],
      ['notifications', 'Notifications', 'WhatsApp and email alerts to you', 'bell', 'notifications']
    ];
    $('#actions-list').innerHTML = rows.map(([key, title, description, iconName, tab]) => {
      const value = state ? state[key] : undefined;
      const badge = value === undefined ? '<span class="ui-skeleton" style="width:44px;height:22px;border-radius:999px"></span>'
        : value ? `<span class="ui-badge dot green">${key === 'notifications' ? escapeHtml(value) : 'On'}</span>` : '<span class="ui-badge">Off</span>';
      return `<a class="ui-row" href="automation-tools.html${appQuery}&tab=${tab}"><span class="ui-icon-tile">${ui.icon(iconName)}</span><span class="ui-row-main"><span class="ui-row-title">${title}</span><span class="ui-row-sub">${description}</span></span>${badge}<span class="ui-chevron">${ui.icon('chevron')}</span></a>`;
    }).join('');
  }

  async function loadActions(businessId, appQuery) {
    const [tools, notifications] = await Promise.all([
      api.db.from('automation_tool_configs').select('tool_type,enabled').eq('business_id', businessId),
      api.db.from('automation_notification_settings').select('whatsapp_enabled,whatsapp_verified_at,email_enabled').eq('business_id', businessId).maybeSingle()
    ]);
    const enabled = Object.fromEntries((tools.data || []).map(row => [row.tool_type, row.enabled]));
    const n = notifications.data;
    const whatsapp = n?.whatsapp_enabled && n?.whatsapp_verified_at; const email = !n || n.email_enabled;
    renderActions(appQuery, { calendar:Boolean(enabled.calendar), orders:Boolean(enabled.orders), leads:Boolean(enabled.leads), notifications: whatsapp && email ? 'WhatsApp + email' : whatsapp ? 'WhatsApp' : email ? 'Email' : '' });
  }

  // Stored credits are shown ×10 as ⚡, like the Hansora header.
  function bolt(credits) { return `${new Intl.NumberFormat(undefined, {maximumFractionDigits:1}).format(Math.round(Number(credits || 0) * 100) / 10)}⚡`; }
  function renderUsage(usage) {
    ui.countUp($('#metric-messages'), usage.messages);
    ui.countUp($('#metric-resolved'), usage.resolved_rate, value => `${value}%`);
    ui.countUp($('#metric-handoffs'), usage.handoffs);
    if (usage.balance !== null) { ui.countUp($('#metric-cost'), Math.round(usage.balance * 10), value => `${formatNumber(value)}⚡`); $('#metric-cost-note').textContent = usage.balance < 1 ? 'Low balance · the AI stops at 0' : 'Shared with Hansora Creative'; $('#metric-cost-note').classList.toggle('ui-balance-low', usage.balance < 1); }
    $('#usage-messages').textContent = formatNumber(usage.messages);
    $('#usage-line-minutes').textContent = formatNumber(usage.phone_minutes || 0);
    $('#usage-line-messages').textContent = bolt(Math.max(0, usage.credits - usage.phone_credits));
    $('#usage-line-phone').textContent = bolt(usage.phone_credits);
    $('#usage-line-total').textContent = bolt(usage.credits);
  }

  function initializeLiveTest(business, profile) {
    const form = $('#test-form');
    const input = $('#test-message');
    const conversation = $('#test-conversation');
    const button = form.querySelector('button[type="submit"]');
    const initial = conversation.innerHTML;
    $('#open-live-test').addEventListener('click', () => { $('#live-test').scrollIntoView({behavior:'smooth', block:'center'}); setTimeout(() => input.focus({preventScroll:true}), 350); });
    $('#clear-test').addEventListener('click', () => { conversation.innerHTML = initial; input.focus(); });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question || button.disabled) return;
      append(question, 'customer');
      input.value = ''; input.style.height = '';
      const dots = ui.typing(); conversation.appendChild(dots); conversation.scrollTop = conversation.scrollHeight;
      button.disabled = true;
      try {
        if (api.isLocalPreview) {
          await new Promise(resolve => setTimeout(resolve, 700));
          const normalized = question.toLowerCase();
          let answer = `Thanks for contacting ${business.name}. I can help with services, prices, hours and delivery.`;
          if (/price|cost|how much/.test(normalized) && profile.services_and_prices) answer = profile.services_and_prices;
          else if (/open|hour|time/.test(normalized) && profile.opening_hours) answer = profile.opening_hours;
          else if (/deliver|area|location/.test(normalized) && profile.delivery_and_service_areas) answer = profile.delivery_and_service_areas;
          dots.remove(); append(answer, 'assistant');
          return;
        }
        const response = await api.authenticatedFetch('/.netlify/functions/automation-test-chat', {method:'POST', body:JSON.stringify({business_id:business.id, message:question})});
        const result = await response.json().catch(() => ({}));
        if (response.status === 402) { dots.remove(); append('You’re out of credits. Buy credits to keep testing — your AI employee also stops answering customers at 0⚡.', 'action'); return; }
        if (!response.ok || !result.reply) throw new Error(result.error || 'test_chat_failed');
        dots.remove();
        // Test chat runs actions in test mode; show which ones the AI used so owners can check the behaviour.
        const labels = {check_availability:'Checked availability',create_booking:'Booking (test, not saved)',cancel_booking:'Cancellation (test)',create_order:'Order (test, not saved)',create_lead:'Lead (test, not saved)',handoff_to_human:'Handoff to a person (test)'};
        if (Array.isArray(result.actions)) result.actions.forEach(action => append(`${labels[action.name] || action.name}${action.ok ? '' : ' — not completed'}`, 'action'));
        append(result.reply, 'assistant');
        await loadUsageSummary(business.id);
      } catch (error) { dots.remove(); append(`Unable to answer: ${api.displayError(error)}`, 'assistant'); }
      finally { button.disabled = false; input.focus(); }
    });
    function append(text, type) {
      const message = document.createElement('div');
      message.className = `ui-bubble ${type}`;
      message.textContent = text;
      conversation.appendChild(message);
      conversation.scrollTop = conversation.scrollHeight;
    }
  }

  async function loadUsageSummary(businessId) {
    const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [usageResult, phoneResult, profileResult, handoffResult, resolvedResult, totalResult] = await Promise.all([
      api.db.from('automation_usage_monthly_v').select('billable_ai_messages,billable_voice_seconds,credits_used').eq('business_id', businessId).eq('billing_month', start.toISOString()).maybeSingle(),
      api.db.from('automation_usage_monthly_channel_v').select('credits_used').eq('business_id', businessId).eq('billing_month', start.toISOString()).eq('channel_type', 'phone').maybeSingle(),
      api.client.from('profiles').select('credits').eq('user_id', user.id).maybeSingle(),
      api.db.from('automation_conversations').select('id', {count:'exact', head:true}).eq('business_id', businessId).in('status', ['human_handling','needs_attention']),
      api.db.from('automation_conversations').select('id', {count:'exact', head:true}).eq('business_id', businessId).eq('status', 'resolved'),
      api.db.from('automation_conversations').select('id', {count:'exact', head:true}).eq('business_id', businessId)
    ]);
    if (usageResult.error) return;
    const total = Number(totalResult.count || 0); const resolved = Number(resolvedResult.count || 0);
    renderUsage({ messages:Number(usageResult.data?.billable_ai_messages || 0), resolved_rate:total ? Math.round(resolved / total * 100) : 0, handoffs:Number(handoffResult.count || 0), credits:Number(usageResult.data?.credits_used || 0), phone_credits:Number(phoneResult.data?.credits_used || 0), balance:Number(profileResult.data?.credits || 0), phone_minutes:Math.ceil(Number(usageResult.data?.billable_voice_seconds || 0) / 60) });
  }

  function fail(message) { loading.hidden = true; errorBox.textContent = message; errorBox.hidden = false; }
  function getPreviewBusiness() {
    try {
      const saved = JSON.parse(localStorage.getItem('hansora_automation_preview_business') || 'null');
      if (saved) return withPreviewChannels(saved);
    } catch (_) {}
    return withPreviewChannels({
      id: 'preview', name: 'Luma Studio', category: 'Home services', description: 'Custom interiors and renovation services.', status: 'draft',
      automation_agents: [{display_name:'Luma Assistant',primary_language:'en',supported_languages:['en','es','ru'],tone:'friendly',custom_instructions:'Be warm, concise and accurate.',prohibited_instructions:'Never invent a price.',status:'active'}],
      automation_business_knowledge: [{services_and_prices:'Kitchen measurement — $25',opening_hours:'Monday–Saturday: 10:00–19:00',delivery_and_service_areas:'The city and nearby areas',frequently_asked_questions:'Do you offer warranty? | Yes, for 12 months.',policies:'Confirm availability before promising a date.'}]
    });
  }
  function withPreviewChannels(business) {
    // Preview shows every channel state: Instagram live, comments mid-setup, the rest from the connect wizards.
    let whatsapp = null; let phoneReady = false;
    try { whatsapp = JSON.parse(localStorage.getItem('hansora_whatsapp_connection_preview') || 'null'); } catch (_) {}
    try { phoneReady = localStorage.getItem('hansora_automation_phone_ready') === '1'; } catch (_) {}
    business.automation_channel_connections = [
      {channel_type:'instagram_dm',setup_order:1,status:'connected'},
      {channel_type:'instagram_comments',setup_order:2,status:'connecting'},
      {channel_type:'whatsapp',setup_order:3,status:whatsapp?.status === 'connected' ? 'connected' : 'not_connected'},
      {channel_type:'phone',setup_order:4,status:phoneReady ? 'connecting' : 'not_connected'}
    ];
    return business;
  }
  function capitalize(value) { return String(value || '').replace(/_/g, ' ').replace(/^./, character => character.toUpperCase()); }
  function formatNumber(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character])); }
})();
