(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const $ = selector => document.querySelector(selector);
  const loading = $('#operations-loading');
  const app = $('#operations-app');
  const errorBox = $('#operations-error');
  const user = await api.requireUser(location.pathname + location.search);
  if (!user) return;
  const params = new URLSearchParams(location.search);
  const preview = api.isLocalPreview;
  const businessId = params.get('business') || (preview ? 'preview' : '');
  const previewSuffix = preview && location.protocol !== 'file:' ? '&preview=1' : '';
  if (!preview && !/^[0-9a-f-]{36}$/i.test(businessId)) { loading.hidden = true; return showError('Open leads, orders and bookings from your AI employee workspace.'); }
  $('#operations-back').href = `automation-agent.html?id=${encodeURIComponent(businessId)}${previewSuffix}`;
  const CHANNELS = {instagram_dm:'Instagram DM',instagram_comments:'Instagram comment',whatsapp:'WhatsApp',phone:'Phone',test:'Test chat'};

  const seeded = [
    {id:'o1',kind:'lead',customer:'Anna Miller',title:'Custom cabinet quote',channel:'Instagram DM',owner:'Sales team',status:'new',value:600,when:'Today · 14:04',summary:'Anna asked for the cabinet from the latest post and needs a quote after sending width and height.',fields:[['Product','Custom cabinet'],['Delivery','Main Street, the city'],['Missing','Width and height']]},
    {id:'o2',kind:'booking',customer:'Carlos Ruiz',title:'Move consultation',channel:'WhatsApp',owner:'Support team',status:'waiting',value:0,when:'Friday · after 15:00',summary:'Carlos wants to move tomorrow’s appointment. The requested replacement is Friday after 3 PM.',fields:[['Original date','Tomorrow'],['Requested','Friday after 15:00'],['Calendar','Needs confirmation']]},
    {id:'o3',kind:'order',customer:'Noah Brooks',title:'Custom kitchen',channel:'WhatsApp',owner:'Anna',status:'in_progress',value:4500,when:'Updated yesterday',summary:'Noah wants a custom kitchen and will send room measurements before the final quote.',fields:[['Product','Custom kitchen'],['Stage','Waiting for measurements'],['Area','the city']]},
    {id:'o4',kind:'lead',customer:'Maria Rossi',title:'White kitchen pricing',channel:'Instagram comment',owner:'Unassigned',status:'new',value:0,when:'Today · 13:36',summary:'Mariam entered through the comment-to-DM automation and asked for the price of the white kitchen.',fields:[['Source','Newest post'],['Automation','Product questions'],['Missing','Exact kitchen size']]},
    {id:'o5',kind:'booking',customer:'Sam A.',title:'Measurement visit',channel:'Instagram DM',owner:'David',status:'confirmed',value:25,when:'Oct 2 · 11:30',summary:'Measurement visit confirmed. The AI collected the address and preferred time, then the team approved it.',fields:[['Service','Measurement visit'],['Date','Oct 2 · 11:30'],['Address','Komitas, the city']]},
    {id:'o6',kind:'order',customer:'Lusine H.',title:'Bedroom wardrobe',channel:'WhatsApp',owner:'Sales team',status:'completed',value:1050,when:'Sep 25',summary:'The customer approved the wardrobe specification and paid the required deposit.',fields:[['Product','Bedroom wardrobe'],['Finish','Light oak'],['Outcome','Deposit paid']]}
  ];

  seeded.forEach(item => { item.currency = item.currency || 'USD'; });
  let records;
  try { records = preview ? seeded.map(item => ({...item, conversationId:null})) : await loadRecords(); }
  catch (error) { loading.hidden = true; return showError(api.displayError(error)); }
  let selectedId = (params.get('record') && records.some(item => item.id === params.get('record'))) ? params.get('record') : records[0]?.id || null;
  let activeKind = 'all';
  loading.hidden = true; app.hidden = false;
  render();
  if (params.get('record')) document.querySelector('.record-row.active')?.scrollIntoView({block:'center'});
  if (['lead','order','booking'].includes(params.get('new'))) {
    $('#record-type').value = params.get('new'); $('#record-customer').value = params.get('customer') || '';
    document.querySelectorAll('.booking-only').forEach(field => { field.hidden = params.get('new') !== 'booking'; });
    $('#record-dialog').showModal();
  }

  $('#operations-tabs').addEventListener('click', event => {
    const button = event.target.closest('button[data-kind]'); if (!button) return;
    activeKind = button.dataset.kind;
    document.querySelectorAll('#operations-tabs button').forEach(item => item.classList.toggle('active', item === button));
    renderList();
  });
  $('#status-filter').addEventListener('change', renderList);
  $('#operations-search').addEventListener('input', renderList);
  $('#records-list').addEventListener('click', event => {
    const row = event.target.closest('[data-record-id]'); if (!row) return;
    selectedId = row.dataset.recordId; renderList(); renderDetail();
  });
  $('#detail-status').addEventListener('change', async event => {
    const record = selected(); const previous = record.status;
    if (event.target.value === 'cancelled' && record.kind === 'booking' && !confirm('Cancel this booking? The time becomes free again. Tell the customer yourself if needed.')) { event.target.value = previous; return; }
    record.status = event.target.value; renderMetrics(); renderList();
    const ok = await update(record, {status:record.status});
    if (ok) window.HansoraUI.toast(`Marked as ${statusLabel(record.status).toLowerCase()}`);
    if (!ok) { record.status = previous; event.target.value = previous; renderMetrics(); renderList(); }
  });
  $('#detail-owner').addEventListener('change', event => { const record = selected(); record.owner = event.target.value.trim() || 'Unassigned'; update(record, {assignee:event.target.value.trim()}); renderList(); renderOwners(); });
  $('#save-note').addEventListener('click', async () => {
    const record = selected(); record.note = $('#detail-note').value.trim();
    if (await update(record, {private_note:record.note})) window.HansoraUI.toast('Note saved');
  });
  $('#open-conversation').addEventListener('click', () => {
    const record = selected();
    location.href = `automation-inbox.html?business=${encodeURIComponent(businessId)}${record?.conversationId ? `&conversation=${encodeURIComponent(record.conversationId)}` : ''}${previewSuffix}`;
  });
  const dialog = $('#record-dialog');
  try { $('#record-currency').value = localStorage.getItem('hansora_automation_currency') || 'USD'; } catch (_) {}
  $('#new-record').addEventListener('click', () => dialog.showModal());
  document.querySelectorAll('[data-close-record]').forEach(button => button.addEventListener('click', () => { dialog.close(); $('#record-form').reset(); document.querySelectorAll('.booking-only').forEach(field => { field.hidden = true; }); }));
  $('#record-type').addEventListener('change', event => document.querySelectorAll('.booking-only').forEach(field => { field.hidden = event.target.value !== 'booking'; }));
  $('#record-form').addEventListener('submit', async event => {
    if (event.submitter?.value !== 'default') return;
    event.preventDefault();
    const kind = $('#record-type').value, customer = $('#record-customer').value.trim(), title = $('#record-title').value.trim(), phone = $('#record-phone').value.trim();
    const value = Math.max(0, Math.round(Number($('#record-value').value || 0) * 100) / 100);
    const currency = $('#record-currency').value || 'USD';
    try { localStorage.setItem('hansora_automation_currency', currency); } catch (_) {}
    if (!customer || !title) return;
    let start = null, end = null;
    if (kind === 'booking') {
      const when = $('#record-when').value; if (!when) return alert('Choose the booking date and time.');
      start = new Date(when); end = new Date(start.getTime() + Number($('#record-duration').value) * 60000);
    }
    let record;
    if (preview) record = {id:`local-${Date.now()}`,kind,customer,title,channel:'Manual',owner:'Unassigned',status:'new',value,currency,when:start ? formatWhen(start.toISOString()) : 'Just now',summary:`Manually created ${kind} for ${customer}.`,fields:[['Created by','Your team'],['Phone',phone || '—']],conversationId:null};
    else {
      const result = await api.db.from('automation_outcomes').insert({business_id:businessId,outcome_type:kind,title,customer_name:customer,customer_phone:phone,estimated_value_minor:Math.round(value * 100),currency,scheduled_start:start?.toISOString() || null,scheduled_end:end?.toISOString() || null,conversation_id:/^[0-9a-f-]{36}$/i.test(params.get('conversation') || '') ? params.get('conversation') : null,created_by:'human',status:kind === 'booking' ? 'confirmed' : 'new',summary:`Created manually for ${customer}.`,collected_fields:{Customer:customer,Phone:phone || '—'}}).select('*, automation_conversations(channel_type)').single();
      if (result.error) return alert(result.error.code === '23P01' ? 'That time overlaps another booking.' : api.displayError(result.error));
      record = mapRecord(result.data);
    }
    records.unshift(record); selectedId = record.id; dialog.close(); window.HansoraUI.toast(`${capitalize(kind)} added`); event.target.reset(); $('#record-currency').value = currency; document.querySelectorAll('.booking-only').forEach(field => { field.hidden = true; }); render();
  });

  async function loadRecords() {
    const result = await api.db.from('automation_outcomes').select('*, automation_conversations(channel_type), automation_contacts(display_name,primary_phone,profile,channel_type)').eq('business_id', businessId).order('created_at', {ascending:false}).limit(300);
    if (result.error) throw result.error;
    return (result.data || []).map(mapRecord);
  }
  function mapRecord(row) {
    const conversation = Array.isArray(row.automation_conversations) ? row.automation_conversations[0] : row.automation_conversations;
    const contact = Array.isArray(row.automation_contacts) ? row.automation_contacts[0] : row.automation_contacts;
    const channel = row.created_by === 'human' ? 'Manual' : CHANNELS[conversation?.channel_type || contact?.channel_type] || 'AI employee';
    // Who ordered: the Instagram @username, otherwise the phone number (WhatsApp, phone calls).
    const handle = contact?.profile?.username ? `@${contact.profile.username}` : contact?.primary_phone || row.customer_phone || '';
    const fields = Object.entries(row.collected_fields || {}).map(([label, value]) => [label, String(value ?? '')]);
    const top = [];
    if (row.reference_number) top.push(['Reference', `#${row.reference_number}`]);
    top.push(['Channel', channel]);
    if (handle) top.push([channel.startsWith('Instagram') ? 'Instagram' : 'Contact', handle]);
    if (row.created_at) top.push([row.outcome_type === 'booking' ? 'Booked at' : row.outcome_type === 'order' ? 'Ordered at' : 'Created at', formatWhen(row.created_at)]);
    fields.unshift(...top);
    if (row.customer_phone && !fields.some(([label]) => /phone/i.test(label))) fields.push(['Phone', row.customer_phone]);
    return {id:row.id,reference:row.reference_number,kind:row.outcome_type,customer:row.customer_name || contact?.display_name || 'Customer',handle,title:row.title,channel,owner:row.assignee || 'Unassigned',status:row.status,value:Number(row.estimated_value_minor || 0) / 100,currency:row.currency || 'USD',when:row.scheduled_start ? formatWhen(row.scheduled_start) : relative(row.created_at),start:row.scheduled_start,createdAt:row.created_at,summary:row.summary || '',fields,note:row.private_note || '',conversationId:row.conversation_id};
  }
  async function update(record, patch) {
    if (preview) return true;
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-outcome-update', {method:'POST', body:JSON.stringify({business_id:businessId, outcome_id:record.id, ...patch})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error === 'time_already_booked' ? 'Another booking already uses this time.' : result.error || 'record_update_failed');
      errorBox.hidden = true; return true;
    } catch (error) { showError(api.displayError(error)); return false; }
  }

  function render() { renderMetrics(); renderList(); renderDetail(); renderOwners(); }
  function renderMetrics() {
    const now = Date.now(); const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const open = item => !['completed','cancelled'].includes(item.status);
    const ui = window.HansoraUI;
    ui.countUp($('#metric-leads'), records.filter(item => item.kind === 'lead' && open(item)).length);
    ui.countUp($('#metric-orders'), records.filter(item => item.kind === 'order' && item.status !== 'cancelled' && (preview || Date.parse(item.createdAt) >= monthStart.getTime())).length);
    ui.countUp($('#metric-bookings'), records.filter(item => item.kind === 'booking' && open(item) && (preview || Date.parse(item.start) >= now)).length);
    // Open value is shown in the currency most records use (records in other currencies are not mixed in).
    const openRecords = records.filter(open); const counts = {}; openRecords.forEach(item => { counts[item.currency || 'USD'] = (counts[item.currency || 'USD'] || 0) + 1; });
    const mainCurrency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'USD';
    ui.countUp($('#metric-value'), Math.round(openRecords.filter(item => (item.currency || 'USD') === mainCurrency).reduce((sum, item) => sum + Number(item.value || 0), 0)), value => money(value, mainCurrency));
  }
  function renderList() {
    const status = $('#status-filter').value;
    const query = $('#operations-search').value.trim().toLowerCase();
    const visible = records.filter(item => (activeKind === 'all' || item.kind === activeKind) && (status === 'all' || item.status === status) && (!query || `${item.customer} ${item.title} ${item.channel} ${item.handle || ''} ${item.reference || ''}`.toLowerCase().includes(query)));
    const icons = {order:'bag', booking:'calendar', lead:'spark'};
    $('#records-list').innerHTML = visible.length ? visible.map(item => `<button class="ui-record-row${item.id === selectedId ? ' active' : ''}${item.status === 'cancelled' ? ' cancelled' : ''}" data-record-id="${escapeHtml(item.id)}" type="button"><span class="ui-record-icon ${item.kind}">${window.HansoraUI.icon(icons[item.kind])}</span><span class="ui-record-main"><strong>${escapeHtml(item.title)}${item.reference ? ` <em>#${item.reference}</em>` : ''}</strong><small>${escapeHtml(item.customer)} · ${escapeHtml(item.channel)}${item.handle ? ` · ${escapeHtml(item.handle)}` : ''}${item.owner && item.owner !== 'Unassigned' ? ` · ${escapeHtml(item.owner)}` : ''}</small></span><span class="ui-record-when">${item.value ? `<b>${money(item.value, item.currency)}</b>` : ''}<small>${escapeHtml(item.when)}</small></span><span class="ui-status ${item.status}">${statusLabel(item.status)}</span></button>`).join('') : `<div class="ui-empty">${records.length ? 'Nothing matches these filters.' : 'Orders, bookings and leads from your AI employee appear here.'}</div>`;
  }
  function statusLabel(status) { return ({new:'New',in_progress:'In progress',waiting:'Waiting',confirmed:'Confirmed',completed:'Done',cancelled:'Cancelled'})[status] || capitalize(status); }
  function renderDetail() {
    const record = selected();
    $('#detail-empty').hidden = Boolean(record);
    $('#detail-content').hidden = !record;
    if (!record) return;
    $('#detail-kind').textContent = capitalize(record.kind);
    $('#detail-kind').className = `ui-kind ${record.kind}`;
    $('#detail-title').textContent = record.title;
    $('#detail-customer').textContent = [record.customer, record.channel, record.handle].filter(Boolean).join(' · ');
    $('#detail-status').value = record.status;
    $('#detail-owner').value = record.owner === 'Unassigned' ? '' : record.owner;
    $('#detail-fields').innerHTML = record.fields.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    $('#detail-summary').textContent = record.summary;
    $('#detail-note').value = record.note || '';
    $('#open-conversation').hidden = !preview && !record.conversationId;
  }
  function renderOwners() { $('#owner-options').innerHTML = [...new Set(records.map(item => item.owner).filter(owner => owner && owner !== 'Unassigned'))].map(owner => `<option value="${escapeHtml(owner)}">`).join(''); }
  function selected() { return records.find(item => item.id === selectedId); }
  function money(value, currency = 'USD') { try { return new Intl.NumberFormat(undefined, { style:'currency', currency, maximumFractionDigits:2 }).format(Number(value || 0)); } catch (_) { return `${new Intl.NumberFormat().format(Number(value || 0))} ${currency}`; } }
  function formatWhen(value) { return new Date(value).toLocaleString(undefined, {weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}); }
  function relative(value) { const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000)); if (minutes < 1) return 'Just now'; if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; return new Date(value).toLocaleDateString(undefined, {day:'numeric', month:'short'}); }
  function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
  function capitalize(value) { return String(value || '').replace(/_/g,' ').replace(/^./, char => char.toUpperCase()); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character])); }
})();
