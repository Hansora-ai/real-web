(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const user = await api.requireUser(location.pathname + location.search); if (!user) return;
  const $ = selector => document.querySelector(selector);
  const params = new URLSearchParams(location.search);
  const preview = api.isLocalPreview;
  const businessId = params.get('business') || (preview ? 'preview' : '');
  const errorBox = $('#tools-error');
  if (!preview && !/^[0-9a-f-]{36}$/i.test(businessId)) return fail('Open business tools from your AI employee workspace.');
  $('#tools-back').href = `automation-agent.html?id=${encodeURIComponent(businessId)}${preview && location.protocol !== 'file:' ? '&preview=1' : ''}`;

  const DAYS = [['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],['thu','Thursday'],['fri','Friday'],['sat','Saturday'],['sun','Sunday']];
  // Every time zone the browser knows, with the owner's own zone as the default.
  const TIMEZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch (_) { return ['UTC','Europe/London','Europe/Berlin','Europe/Moscow','Asia/Dubai','Asia/the city','America/New_York','America/Los_Angeles']; } })();
  const DEFAULT_ORDER_FIELDS = ['Product or service','Quantity or dimensions','Customer name','Phone number','Delivery address'];
  const state = {
    calendar: { enabled:false, config:{ timezone:api.browserTimezone(), weekly_hours:{ mon:[{start:'10:00',end:'19:00'}], tue:[{start:'10:00',end:'19:00'}], wed:[{start:'10:00',end:'19:00'}], thu:[{start:'10:00',end:'19:00'}], fri:[{start:'10:00',end:'19:00'}], sat:[{start:'11:00',end:'17:00'}], sun:[] }, duration_minutes:60, step_minutes:30, buffer_minutes:0, min_notice_minutes:120, max_days_ahead:30, services:[], closed_dates:[], auto_confirm:false } },
    orders: { enabled:false, config:{ required_fields:[...DEFAULT_ORDER_FIELDS], auto_confirm:false } },
    leads: { enabled:false, config:{ signals:'' } },
    handoff: { enabled:true, config:{ rules:{ asks_person:true, complaint:true, missing_info:false, uncertain:true } } },
    notifications: { whatsapp_enabled:false, whatsapp_phone:null, whatsapp_verified:false, email_enabled:true, email:'', events:['order_created','booking_created','handoff_requested'], language:'en' },
    google: { connected:false, calendars:[], selected:'primary' }
  };
  let pendingPhone = '';
  let dirty = false;

  try { if (!preview) await loadSaved(); }
  catch (error) { return fail(api.displayError(error)); }

  const previews = {
    calendar:['Booking an appointment',[['customer','Can I come on Friday?'],['ai','Friday has 11:30, 14:00 and 16:30 free. Which suits you?'],['customer','11:30'],['ai','To confirm: consultation, Friday at 11:30, for Ani. Shall I book it?'],['customer','Yes'],['ai','Booked. Your reference is #1042. See you on Friday!'],['system','Owner notified on WhatsApp · New booking #1042']]],
    orders:['Taking an order',[['customer','I want the white cabinet from your post.'],['ai','Great choice. What width and height do you need, and where should we deliver?'],['customer','120 × 200, 12 Main St'],['ai','To confirm: white cabinet 120 × 200 cm, delivery to 12 Main St. Shall I place the order?'],['customer','Yes please'],['ai','Done! Order #1043. The team will confirm the price shortly.'],['system','Owner notified on WhatsApp · New order #1043']]],
    leads:['Saving an interested customer',[['customer','How much would a custom kitchen cost?'],['ai','It depends on size and materials. What is the room size and your preferred style?'],['customer','About 18 m², modern white. Just planning for now.'],['ai','Thank you! I’ve passed this to our designers so they can prepare options for you.'],['system','Lead saved for the sales team']]],
    handoff:['Handing over to a person',[['customer','This arrived damaged, I want a refund.'],['ai','I’m sorry about that. I’ve passed this to our team and a person will reply here shortly.'],['system','AI paused · Owner notified: customer needs a person']]],
    notifications:['What you receive',[['system','New order #1043 for Luma Studio. Customer: Ana · +1 555 010 0000. Details: White cabinet 120 × 200 cm · 12 Main St'],['system','New booking #1042 for Luma Studio. Customer: Ani. Time: Fri 2 Oct, 11:30'],['system','A customer needs a person at Luma Studio. Reason: refund request']]]
  };

  render();
  showPreview('calendar');
  $('#tools-loading').hidden = true; $('#tools-app').hidden = false;
  if (params.get('google') === 'connected') { showPane('calendar'); setState('Google Calendar connected'); }
  if (params.get('tab')) showPane(params.get('tab'));

  document.querySelector('.tools-nav').addEventListener('click', event => { const button = event.target.closest('button[data-tool]'); if (button) showPane(button.dataset.tool); });
  $('.tool-editor').addEventListener('input', markDirty);
  $('.tool-editor').addEventListener('change', markDirty);
  $('#week-hours').addEventListener('click', event => {
    const add = event.target.closest('[data-add-range]'); const remove = event.target.closest('[data-remove-range]');
    if (!add && !remove) return;
    readWeek();
    if (add) splitDay(state.calendar.config.weekly_hours[add.dataset.addRange]);
    if (remove) { const [day, index] = remove.dataset.removeRange.split(':'); state.calendar.config.weekly_hours[day].splice(Number(index), 1); }
    renderWeek(); markDirty();
  });
  $('#week-hours').addEventListener('change', event => {
    const toggle = event.target.closest('[data-day-open]'); if (!toggle) return;
    readWeek();
    state.calendar.config.weekly_hours[toggle.dataset.dayOpen] = toggle.checked ? [{start:'10:00',end:'19:00'}] : [];
    renderWeek();
  });
  $('#add-service').addEventListener('click', () => { readServices(); state.calendar.config.services.push({name:'',duration_minutes:Number($('#booking-duration').value)}); renderServices(); document.querySelector('#service-list .service-row:last-child input')?.focus(); markDirty(); });
  $('#service-list').addEventListener('click', event => { const button = event.target.closest('[data-remove-service]'); if (!button) return; readServices(); state.calendar.config.services.splice(Number(button.dataset.removeService), 1); renderServices(); markDirty(); });
  $('#add-closed-date').addEventListener('click', () => { const value = $('#closed-date').value; if (!value || state.calendar.config.closed_dates.includes(value)) return; state.calendar.config.closed_dates.push(value); state.calendar.config.closed_dates.sort(); $('#closed-date').value = ''; renderClosedDates(); markDirty(); });
  $('#closed-dates').addEventListener('click', event => { const button = event.target.closest('[data-remove-date]'); if (!button) return; state.calendar.config.closed_dates = state.calendar.config.closed_dates.filter(date => date !== button.dataset.removeDate); renderClosedDates(); markDirty(); });
  $('#add-order-field').addEventListener('click', () => { readOrderFields(); state.orders.config.required_fields.push(''); renderOrderFields(); document.querySelector('#order-fields > div:last-child input')?.focus(); markDirty(); });
  $('#order-fields').addEventListener('click', event => { const button = event.target.closest('button[data-remove]'); if (!button) return; readOrderFields(); state.orders.config.required_fields.splice(Number(button.dataset.remove), 1); renderOrderFields(); markDirty(); });
  ['calendar','orders','leads'].forEach(tool => $(`#${tool}-enabled`).addEventListener('change', event => { state[tool].enabled = event.target.checked; renderStatuses(); }));
  $('#save-tools').addEventListener('click', save);
  $('#google-connect').addEventListener('click', connectGoogle);
  $('#google-disconnect').addEventListener('click', disconnectGoogle);
  $('#google-calendar').addEventListener('change', selectGoogleCalendar);
  $('#wa-phone-form').addEventListener('submit', sendCode);
  $('#wa-code-form').addEventListener('submit', verifyCode);
  $('#wa-change').addEventListener('click', () => { pendingPhone = ''; renderNotifications(); $('#wa-phone').focus(); });
  $('#wa-remove').addEventListener('click', removeWhatsApp);
  $('#wa-notify-enabled').addEventListener('change', event => { state.notifications.whatsapp_enabled = event.target.checked; renderStatuses(); });
  $('#email-notify-enabled').addEventListener('change', renderStatuses);
  $('#notify-test').addEventListener('click', sendTest);
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

  async function loadSaved() {
    const [tools, notifications, business] = await Promise.all([
      api.db.from('automation_tool_configs').select('tool_type,enabled,config').eq('business_id', businessId),
      api.db.from('automation_notification_settings').select('*').eq('business_id', businessId).maybeSingle(),
      api.db.from('automation_businesses').select('timezone').eq('id', businessId).maybeSingle()
    ]);
    for (const result of [tools, notifications, business]) if (result.error) throw result.error;
    if (!business.data) throw new Error('This AI employee was not found.');
    for (const row of tools.data || []) if (state[row.tool_type]) { state[row.tool_type].enabled = row.enabled; state[row.tool_type].config = {...state[row.tool_type].config, ...(row.config || {})}; }
    if (!(tools.data || []).some(row => row.tool_type === 'calendar' && row.config?.timezone) && business.data.timezone) state.calendar.config.timezone = business.data.timezone;
    const n = notifications.data;
    if (n) Object.assign(state.notifications, { whatsapp_enabled:n.whatsapp_enabled, whatsapp_phone:n.whatsapp_phone, whatsapp_verified:Boolean(n.whatsapp_verified_at), email_enabled:n.email_enabled, email:n.email || '', events:n.events || [], language:n.language || 'en' });
    await loadGoogle().catch(() => {});
  }

  async function loadGoogle(action = 'list', extra = {}) {
    const response = await api.authenticatedFetch('/.netlify/functions/automation-google-calendars', {method:'POST', body:JSON.stringify({business_id:businessId, action, ...extra})});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error === 'google_reconnect_required' ? 'Google Calendar access expired. Connect Google again.' : result.error || 'google_calendars_unavailable');
    state.google = { connected:Boolean(result.connected), calendars:result.calendars || [], selected:result.selected || 'primary' };
  }

  function render() {
    const c = state.calendar.config;
    $('#calendar-enabled').checked = state.calendar.enabled;
    $('#orders-enabled').checked = state.orders.enabled;
    $('#leads-enabled').checked = state.leads.enabled;
    setSelect('#booking-duration', c.duration_minutes); setSelect('#booking-step', c.step_minutes); setSelect('#booking-buffer', c.buffer_minutes); setSelect('#booking-notice', c.min_notice_minutes); setSelect('#booking-ahead', c.max_days_ahead);
    const zones = TIMEZONES.includes(c.timezone) ? TIMEZONES : [c.timezone, ...TIMEZONES];
    $('#booking-timezone').innerHTML = zones.map(zone => `<option value="${escapeHtml(zone)}">${escapeHtml(zone.replace(/_/g,' '))}</option>`).join('');
    $('#booking-timezone').value = c.timezone;
    $('#booking-auto-confirm').checked = Boolean(c.auto_confirm);
    $('#orders-auto-confirm').checked = Boolean(state.orders.config.auto_confirm);
    $('#lead-signals').value = state.leads.config.signals || '';
    document.querySelectorAll('#handoff-rules input[data-rule]').forEach(input => { if (!input.disabled) input.checked = Boolean(state.handoff.config.rules?.[input.dataset.rule]); });
    renderWeek(); renderServices(); renderClosedDates(); renderOrderFields(); renderGoogle(); renderNotifications(); renderStatuses();
  }

  function setSelect(selector, value) {
    const select = $(selector); const text = String(value);
    if (![...select.options].some(option => option.value === text)) select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(text)}">${escapeHtml(text)} minutes</option>`);
    select.value = text;
  }

  function renderWeek() {
    const week = state.calendar.config.weekly_hours;
    $('#week-hours').innerHTML = DAYS.map(([key, name]) => {
      const ranges = week[key] || [];
      const body = ranges.length ? ranges.map((range, index) => `<span class="day-range"><input class="ui-input" type="time" value="${escapeHtml(range.start)}" data-time="${key}:${index}:start" aria-label="${name} opens"> – <input class="ui-input" type="time" value="${escapeHtml(range.end)}" data-time="${key}:${index}:end" aria-label="${name} closes">${ranges.length > 1 ? `<button type="button" data-remove-range="${key}:${index}" aria-label="Remove ${name} hours">×</button>` : ''}</span>`).join('') + (ranges.length < 3 ? `<button class="day-add" type="button" data-add-range="${key}">+ Split day</button>` : '') : '<span class="closed">Closed</span>';
      return `<div class="day-row"><label><input class="ui-switch" type="checkbox" data-day-open="${key}"${ranges.length ? ' checked' : ''}>${name}</label><div class="day-ranges">${body}</div></div>`;
    }).join('');
  }
  // "Split day" turns the last block into two with a one-hour break in the middle (a lunch break),
  // or adds an evening block when the day is too short to split.
  function splitDay(ranges) {
    const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const toTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const last = ranges.at(-1);
    if (!last) return ranges.push({start:'10:00', end:'19:00'});
    const start = toMinutes(last.start), end = toMinutes(last.end);
    if (end - start >= 180) { const breakStart = Math.round((start + (end - start) / 2 - 30) / 30) * 30; last.end = toTime(breakStart); ranges.push({start:toTime(breakStart + 60), end:toTime(end)}); }
    else if (end <= 22 * 60) ranges.push({start:toTime(end + 60), end:toTime(Math.min(end + 180, 23 * 60 + 30))});
  }
  function readWeek() {
    const week = Object.fromEntries(DAYS.map(([key]) => [key, []]));
    document.querySelectorAll('#week-hours [data-time]').forEach(input => { const [day, index, edge] = input.dataset.time.split(':'); (week[day][index] ||= {start:'',end:''})[edge] = input.value; });
    state.calendar.config.weekly_hours = Object.fromEntries(Object.entries(week).map(([day, ranges]) => [day, ranges.filter(Boolean)]));
  }
  function renderServices() {
    $('#service-list').innerHTML = state.calendar.config.services.map((service, index) => `<div class="service-row"><input class="ui-input" value="${escapeHtml(service.name)}" maxlength="120" placeholder="Service name, e.g. Haircut" data-service-name="${index}" aria-label="Service ${index + 1}"><select class="ui-select" data-service-duration="${index}" aria-label="Service ${index + 1} length">${[15,30,45,60,90,120,180,240].map(value => `<option value="${value}"${Number(service.duration_minutes) === value ? ' selected' : ''}>${value < 60 ? `${value} min` : `${value / 60} h`}</option>`).join('')}</select><button type="button" data-remove-service="${index}" aria-label="Remove service">×</button></div>`).join('');
  }
  function readServices() {
    state.calendar.config.services = [...document.querySelectorAll('#service-list .service-row')].map(row => ({ name: row.querySelector('[data-service-name]').value.trim(), duration_minutes: Number(row.querySelector('[data-service-duration]').value) }));
  }
  function renderClosedDates() {
    $('#closed-dates').innerHTML = state.calendar.config.closed_dates.map(date => `<span>${escapeHtml(new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'}))}<button type="button" data-remove-date="${escapeHtml(date)}" aria-label="Remove ${escapeHtml(date)}">×</button></span>`).join('');
  }
  function renderOrderFields() {
    $('#order-fields').innerHTML = state.orders.config.required_fields.map((field, index) => `<div><span>${index + 1}</span><input class="ui-input" value="${escapeHtml(field)}" maxlength="80" placeholder="e.g. Colour" aria-label="Required detail ${index + 1}"><button data-remove="${index}" type="button" aria-label="Remove ${escapeHtml(field)}">×</button></div>`).join('');
  }
  function readOrderFields() { state.orders.config.required_fields = [...document.querySelectorAll('#order-fields input')].map(input => input.value.trim()); }

  function renderGoogle() {
    const g = state.google;
    $('#google-connected').hidden = !g.connected;
    $('#google-connect').hidden = g.connected;
    $('#google-title').textContent = g.connected ? 'Google Calendar connected' : 'Google Calendar sync';
    $('#google-copy').textContent = g.connected ? 'Busy times in this calendar block booking slots, and new bookings are added to it.' : 'Optional. Busy times in Google are respected and new bookings are added there.';
    $('#google-calendar').innerHTML = g.calendars.map(calendar => `<option value="${escapeHtml(calendar.id)}"${(calendar.primary && g.selected === 'primary') || calendar.id === g.selected ? ' selected' : ''}>${escapeHtml(calendar.name)}${calendar.primary ? ' (main)' : ''}</option>`).join('');
  }

  function renderNotifications() {
    const n = state.notifications;
    $('#wa-verified').hidden = !n.whatsapp_verified;
    $('#wa-phone-form').hidden = n.whatsapp_verified || Boolean(pendingPhone);
    $('#wa-code-form').hidden = n.whatsapp_verified || !pendingPhone;
    $('#wa-verified-number').textContent = n.whatsapp_phone ? `+${n.whatsapp_phone}` : '';
    $('#wa-notify-enabled').disabled = !n.whatsapp_verified;
    $('#wa-notify-enabled').checked = n.whatsapp_verified && n.whatsapp_enabled;
    $('#wa-notify-copy').textContent = n.whatsapp_verified ? 'Alerts come from the Hansora WhatsApp number.' : pendingPhone ? `Enter the code we sent to +${pendingPhone}.` : 'We send a 6-digit code to confirm the number is yours.';
    $('#email-notify-enabled').checked = n.email_enabled;
    $('#notify-email').value = n.email || '';
    $('#notify-email').placeholder = !preview && user.email ? user.email : 'you@business.com';
    $('#notify-language').value = n.language;
    document.querySelectorAll('#notify-events input').forEach(input => { input.checked = n.events.includes(input.value); });
  }

  function renderStatuses() {
    ['calendar','orders','leads'].forEach(tool => { const on = $(`#${tool}-enabled`).checked; const badge = $(`#${tool}-status`); badge.textContent = on ? 'On' : 'Off'; badge.classList.toggle('on', on); });
    const whatsapp = state.notifications.whatsapp_verified && $('#wa-notify-enabled').checked; const email = $('#email-notify-enabled').checked;
    $('#notify-status').textContent = whatsapp && email ? 'WA + Email' : whatsapp ? 'WhatsApp' : email ? 'Email' : 'Off';
    $('#notify-status').classList.toggle('on', whatsapp || email);
  }

  function collect() {
    readWeek(); readServices(); readOrderFields();
    const c = state.calendar.config;
    Object.assign(c, { timezone:$('#booking-timezone').value, duration_minutes:Number($('#booking-duration').value), step_minutes:Number($('#booking-step').value), buffer_minutes:Number($('#booking-buffer').value), min_notice_minutes:Number($('#booking-notice').value), max_days_ahead:Number($('#booking-ahead').value), auto_confirm:$('#booking-auto-confirm').checked });
    c.services = c.services.filter(service => service.name);
    state.calendar.enabled = $('#calendar-enabled').checked;
    state.orders.enabled = $('#orders-enabled').checked;
    state.orders.config = { required_fields: state.orders.config.required_fields.filter(Boolean), auto_confirm:$('#orders-auto-confirm').checked };
    state.leads.enabled = $('#leads-enabled').checked;
    state.leads.config = { signals: $('#lead-signals').value.trim().slice(0, 800) };
    state.handoff.config = { rules: Object.fromEntries([...document.querySelectorAll('#handoff-rules input[data-rule]')].map(input => [input.dataset.rule, input.checked])) };
    Object.assign(state.notifications, { email_enabled:$('#email-notify-enabled').checked, email:$('#notify-email').value.trim(), language:$('#notify-language').value, whatsapp_enabled:$('#wa-notify-enabled').checked, events:[...document.querySelectorAll('#notify-events input:checked')].map(input => input.value) });
  }

  function validate() {
    const c = state.calendar.config;
    for (const [key, name] of DAYS) for (const range of c.weekly_hours[key]) if (!range.start || !range.end || range.end <= range.start) return [`${name}: closing time must be after opening time.`, 'calendar'];
    for (const [key, name] of DAYS) { const ranges = [...c.weekly_hours[key]].sort((a, b) => a.start.localeCompare(b.start)); for (let i = 1; i < ranges.length; i++) if (ranges[i].start < ranges[i - 1].end) return [`${name}: working hours overlap.`, 'calendar']; }
    if (state.calendar.enabled && !DAYS.some(([key]) => c.weekly_hours[key].length)) return ['Add working hours for at least one day, or turn bookings off.', 'calendar'];
    if (state.orders.enabled && !state.orders.config.required_fields.length) return ['Add at least one required order detail.', 'orders'];
    if (new Set(state.orders.config.required_fields.map(field => field.toLowerCase())).size !== state.orders.config.required_fields.length) return ['Each required order detail must be different.', 'orders'];
    const email = state.notifications.email; if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ['Enter a valid alert email or leave it empty.', 'notifications'];
    return null;
  }

  async function save() {
    errorBox.hidden = true; collect();
    const invalid = validate(); if (invalid) { showPane(invalid[1]); return showError(invalid[0]); }
    if (preview) { dirty = false; setState('All changes saved'); window.HansoraUI.toast('Preview: sign in to save for real'); return; }
    const button = $('#save-tools'); button.disabled = true; setState('Saving…');
    try {
      const rows = ['calendar','orders','leads','handoff'].map(tool => ({ business_id:businessId, tool_type:tool, enabled:state[tool].enabled, config:state[tool].config, updated_at:new Date().toISOString() }));
      const saved = await api.db.from('automation_tool_configs').upsert(rows, { onConflict:'business_id,tool_type' });
      if (saved.error) throw saved.error;
      const n = state.notifications;
      await notificationsCall({action:'save', email_enabled:n.email_enabled, email:n.email, events:n.events, language:n.language, whatsapp_enabled:n.whatsapp_verified && n.whatsapp_enabled});
      // The AI's available actions are part of its provider configuration, so resync after every change.
      const sync = await api.authenticatedFetch('/.netlify/functions/automation-agent-sync', {method:'POST', body:JSON.stringify({business_id:businessId})});
      dirty = false;
      setState('All changes saved');
      window.HansoraUI.toast(sync.ok ? 'Saved. Your AI employee is updated.' : 'Saved. The AI updates on its next sync.');
    } catch (error) { setState('Not saved'); showError(api.displayError(error)); }
    finally { button.disabled = false; }
  }

  async function connectGoogle() {
    if (preview) return showError('Google Calendar can be connected after signing in.');
    if (dirty) { await save(); if (dirty) return; }
    const button = $('#google-connect'); button.disabled = true;
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-google-start', {method:'POST', body:JSON.stringify({business_id:businessId})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.authorization_url) throw new Error(result.error || 'google_connection_unavailable');
      location.href = result.authorization_url;
    } catch (error) { button.disabled = false; showError(api.displayError(error)); }
  }
  async function selectGoogleCalendar(event) {
    try { await loadGoogle('select', {calendar_id:event.target.value}); renderGoogle(); window.HansoraUI.toast('Calendar updated'); }
    catch (error) { showError(api.displayError(error)); }
  }
  async function disconnectGoogle() {
    if (!confirm('Disconnect Google Calendar? Existing bookings stay in Hansora.')) return;
    try { await loadGoogle('disconnect'); renderGoogle(); setState('Google Calendar disconnected'); }
    catch (error) { showError(api.displayError(error)); }
  }

  async function notificationsCall(payload) {
    const response = await api.authenticatedFetch('/.netlify/functions/automation-notifications', {method:'POST', body:JSON.stringify({business_id:businessId, ...payload})});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(notifyError(result.error));
    return result;
  }
  async function sendCode(event) {
    event.preventDefault(); errorBox.hidden = true;
    const phone = $('#wa-phone').value.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
    if (!/^[1-9]\d{7,14}$/.test(phone)) return showError('Enter your WhatsApp number with the country code, for example +1 555 010 0000.');
    if (preview) return showError('WhatsApp verification works after signing in.');
    const button = event.submitter; if (button) button.disabled = true;
    try { const result = await notificationsCall({action:'send_code', phone}); pendingPhone = result.phone; renderNotifications(); $('#wa-code').value = ''; $('#wa-code').focus(); }
    catch (error) { showError(error.message); }
    finally { if (button) button.disabled = false; }
  }
  async function verifyCode(event) {
    event.preventDefault(); errorBox.hidden = true;
    const code = $('#wa-code').value.trim(); if (!/^\d{6}$/.test(code)) return showError('Enter the 6-digit code.');
    const button = event.submitter; if (button) button.disabled = true;
    try { const result = await notificationsCall({action:'verify', phone:pendingPhone, code}); pendingPhone = ''; applyNotificationSettings(result.settings); window.HansoraUI.toast('WhatsApp alerts are on'); }
    catch (error) { showError(error.message); }
    finally { if (button) button.disabled = false; }
  }
  async function removeWhatsApp() {
    if (!confirm('Stop WhatsApp alerts to this number?')) return;
    try { const result = await notificationsCall({action:'remove_whatsapp'}); applyNotificationSettings(result.settings); }
    catch (error) { showError(error.message); }
  }
  async function sendTest() {
    if (preview) return showError('Test notifications can be sent after signing in.');
    if (dirty) { await save(); if (dirty) return; }
    const note = $('#notify-test-state'); note.textContent = 'Sending…';
    try {
      const result = await notificationsCall({action:'test'});
      note.textContent = result.results.length ? result.results.map(item => `${item.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}: ${item.status === 'sent' ? 'sent' : 'failed'}`).join(' · ') : 'No alert channel is turned on.';
    } catch (error) { note.textContent = ''; showError(error.message); }
  }
  function applyNotificationSettings(settings) {
    if (settings) Object.assign(state.notifications, { whatsapp_enabled:settings.whatsapp_enabled, whatsapp_phone:settings.whatsapp_phone, whatsapp_verified:settings.whatsapp_verified, email_enabled:settings.email_enabled, email:settings.email || '', events:settings.events || [], language:settings.language || 'en' });
    renderNotifications(); renderStatuses();
  }
  function notifyError(code) {
    return ({invalid_phone:'Enter your WhatsApp number with the country code.',too_many_codes:'Too many codes were requested. Try again in an hour.',wrong_code:'That code is not correct.',code_expired:'The code expired. Send a new one.',too_many_attempts:'Too many wrong attempts. Send a new code.',whatsapp_not_verified:'Verify your WhatsApp number first.',invalid_email:'Enter a valid alert email.',hansora_whatsapp_sender_not_configured:'WhatsApp alerts are not set up on the server yet.',email_not_configured:'Email alerts are not set up on the server yet.'})[code] || code || 'Something went wrong.';
  }

  function showPane(tool) {
    if (!document.querySelector(`.tool-pane[data-pane="${tool}"]`)) return;
    document.querySelectorAll('.tools-nav button').forEach(item => item.classList.toggle('active', item.dataset.tool === tool));
    document.querySelectorAll('.tool-pane').forEach(pane => pane.hidden = pane.dataset.pane !== tool);
    showPreview(tool);
  }
  function showPreview(kind) { const data = previews[kind] || previews.calendar; $('#tool-preview-title').textContent = data[0]; $('#tool-preview-chat').innerHTML = data[1].map(([role, text]) => `<div class="${role}"><span>${role === 'customer' ? 'Customer' : role === 'ai' ? 'AI employee' : 'Hansora'}</span><p>${escapeHtml(text)}</p></div>`).join(''); }
  function markDirty() { dirty = true; setState('Unsaved changes'); renderStatuses(); }
  function setState(text) { const pill = $('#tools-state'); pill.textContent = text; pill.classList.toggle('dirty', /unsaved|not saved/i.test(text)); pill.classList.toggle('busy', /saving/i.test(text)); }
  function showError(message) { errorBox.textContent = message; errorBox.hidden = false; errorBox.scrollIntoView({behavior:'smooth', block:'center'}); }
  function fail(message) { $('#tools-loading').hidden = true; showError(message); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
})();
