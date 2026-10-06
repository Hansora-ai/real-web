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

  // Day view: every time of one day with taken and free places (tables, staff…), from the same calculation the AI uses.
  // The owner can reserve or free places right here (phone and walk-in bookings); the AI counts them immediately.
  const pad = number => String(number).padStart(2, '0');
  const isoDay = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const SELECT_ROW = '*, automation_conversations(channel_type), automation_contacts(display_name,primary_phone,profile,channel_type)';
  let dayData = null, dayKind = params.get('kind') === 'delivery' ? 'delivery' : '';
  const dayEdits = new Map(); // slot start → { reserve:Set(cell), free:Set(booking id), people:number }
  $('#day-date').value = isoDay(new Date());
  if (params.get('view') === 'day') setTimeout(() => showDayView(true));
  const shiftDay = days => { const date = new Date(`${$('#day-date').value || isoDay(new Date())}T12:00:00`); date.setDate(date.getDate() + days); $('#day-date').value = isoDay(date); loadDay(); };
  $('#day-prev').addEventListener('click', () => shiftDay(-1));
  $('#day-next').addEventListener('click', () => shiftDay(1));
  $('#day-date').addEventListener('change', loadDay);
  $('#open-day').addEventListener('click', () => showDayView(true));
  setupDayButton();
  // The day view button is named after the business type ("Tables today", "Doctors today", "Deliveries today")
  // and only shown when bookings or delivery times are on; online services without a calendar don't get it.
  async function setupDayButton() {
    const dayTab = document.querySelector('#operations-tabs [data-kind="day"]');
    if (preview) { $('#open-day').hidden = false; $('#open-day').lastChild.textContent = 'Tables today'; return; }
    try {
      const [business, tools] = await Promise.all([
        api.db.from('automation_businesses').select('category').eq('id', businessId).maybeSingle(),
        api.db.from('automation_tool_configs').select('tool_type,enabled,config').eq('business_id', businessId).in('tool_type', ['calendar','orders'])
      ]);
      const type = api.businessType(business.data?.category);
      const calendar = (tools.data || []).find(row => row.tool_type === 'calendar'), orders = (tools.data || []).find(row => row.tool_type === 'orders');
      const bookings = Boolean(calendar?.enabled), deliveries = Boolean(orders?.enabled && orders?.config?.delivery_slots?.enabled);
      if (!bookings && !deliveries) { if (dayTab) dayTab.hidden = true; return; }
      const label = bookings ? `${type && type.code !== 'other' ? type.places : 'Bookings'} today` : 'Deliveries today';
      $('#open-day').lastChild.textContent = label; $('#open-day').hidden = false;
      if (dayTab) dayTab.textContent = label;
    } catch (_) { /* the Day view tab still works */ }
  }
  $('#day-kind').addEventListener('click', event => { const button = event.target.closest('[data-day-kind]'); if (!button || button.dataset.dayKind === dayKind) return; dayKind = button.dataset.dayKind; loadDay(); });
  $('#day-slots').addEventListener('click', event => {
    const link = event.target.closest('[data-open-record]');
    if (link) { showDayView(false); selectedId = link.dataset.openRecord; render(); return; }
    const row = event.target.closest('[data-slot]'); if (!row) return;
    const slot = dayData.slots.find(item => item.start === row.dataset.slot); if (!slot) return;
    const edit = dayEdits.get(slot.start) || { reserve:new Set(), free:new Set(), people:0 };
    const cell = event.target.closest('[data-cell]'), free = event.target.closest('[data-free]');
    if (cell) { const key = cell.dataset.cell; edit.reserve.has(key) ? edit.reserve.delete(key) : edit.reserve.add(key); }
    else if (free) { const id = free.dataset.free; edit.free.has(id) ? edit.free.delete(id) : edit.free.add(id); }
    else if (event.target.closest('[data-day-cancel]')) { dayEdits.delete(slot.start); return renderDay(dayData); }
    else if (event.target.closest('[data-day-save]')) return saveDayEdit(slot);
    else return;
    dayEdits.set(slot.start, edit); renderDay(dayData);
  });
  $('#day-slots').addEventListener('input', event => {
    const input = event.target.closest('[data-people-input]'); if (!input) return;
    const start = input.closest('[data-slot]').dataset.slot;
    const edit = dayEdits.get(start) || { reserve:new Set(), free:new Set(), people:0 };
    edit.people = Math.max(0, Math.round(Number(input.value)) || 0); dayEdits.set(start, edit);
    const bar = input.closest('[data-slot]').querySelector('.day-edit'); if (bar) bar.hidden = !editCount(edit);
  });
  function showDayView(on) {
    $('#day-view').hidden = !on; $('#records-list').hidden = on; $('.ui-records-tools').hidden = on;
    document.querySelectorAll('#operations-tabs button').forEach(item => item.classList.toggle('active', on ? item.dataset.kind === 'day' : item.dataset.kind === activeKind));
    if (on) { loadDay(); $('#day-view').scrollIntoView({block:'nearest'}); }
  }
  async function loadDay() {
    const date = $('#day-date').value; if (!date) return;
    dayEdits.clear();
    $('#day-slots').innerHTML = '<div class="ui-empty">Loading…</div>';
    try {
      const data = preview ? previewDay(date) : await api.authenticatedFetch('/.netlify/functions/automation-day-view', {method:'POST', body:JSON.stringify({business_id:businessId, date, ...(dayKind ? {kind:dayKind} : {})})}).then(async response => { const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'day_view_unavailable'); return result; });
      dayKind = data.kind || 'booking';
      renderDay(data);
    } catch (error) { $('#day-slots').innerHTML = `<div class="ui-empty">${escapeHtml(api.displayError(error))}</div>`; }
  }
  const editCount = edit => edit ? edit.reserve.size + edit.free.size + (edit.people > 0 ? 1 : 0) : 0;
  function renderDay(data) {
    dayData = data;
    const delivery = data.kind === 'delivery', people = data.count_by === 'people';
    const both = data.kinds && data.kinds.booking && data.kinds.delivery;
    $('#day-kind').hidden = !both;
    document.querySelectorAll('[data-day-kind]').forEach(button => button.classList.toggle('active', button.dataset.dayKind === (data.kind || 'booking')));
    const unique = new Set(data.slots.flatMap(slot => slot.bookings.map(item => item.id)));
    const noun = delivery ? ['delivery', 'deliveries'] : ['booking', 'bookings'];
    $('#day-summary').textContent = data.slots.length ? `${unique.size} ${unique.size === 1 ? noun[0] : noun[1]} · ${data.capacity} ${people ? 'people' : delivery ? 'deliveries per window' : `place${data.capacity === 1 ? '' : 's'}`} at the same time${data.enabled ? '' : ` · ${noun[1]} are off`}` : '';
    $('#day-help').textContent = people ? 'Type how many people to reserve for a time (phone or walk-in), or press × on a booking to free it, then Save. The AI sees the change right away.' : `Click a free square to reserve it (for example a phone or walk-in ${noun[0]}), or a taken one to free it, then press Save. The AI sees the change right away.`;
    if (!data.slots.length) { $('#day-slots').innerHTML = '<div class="ui-empty">Closed on this day, or no working hours are set.</div>'; return; }
    $('#day-slots').innerHTML = data.slots.map(slot => {
      const edit = dayEdits.get(slot.start);
      // "free" comes from the same calculation the AI uses, so a place still in its break is not counted as free.
      const free = Number.isFinite(slot.free) ? slot.free : Math.max(0, slot.capacity - slot.booked);
      const inBreak = Number(slot.break_blocked) || 0;
      const freeSet = Array.isArray(slot.free_places) ? new Set(slot.free_places) : null;
      const chip = item => `<button type="button" class="day-booking" data-open-record="${escapeHtml(item.id)}" title="Open">${escapeHtml(item.customer)}${people ? ` ×${escapeHtml(item.people)}` : ''}${item.reference ? ` #${escapeHtml(item.reference)}` : ''}</button><button type="button" class="day-x" data-free="${escapeHtml(item.id)}" title="Free this place" aria-label="Free">×</button>`;
      // Squares: one per place. Named places keep their own number; otherwise bookings fill the first squares.
      const cells = slot.blocked || people ? [] : slot.places ? slot.places.map(place => ({ key:`p${place.index}`, index:place.index, name:place.name, booking:place.booking })) : slot.capacity <= 60 ? unnamedCells(slot) : [];
      const resting = cell => !cell.booking && freeSet && !freeSet.has(cell.index);
      const cellClass = cell => cell.booking ? (edit?.free.has(cell.booking.id) ? 'to-free' : 'taken') : edit?.reserve.has(cell.key) ? 'to-reserve' : resting(cell) ? 'break' : '';
      const squares = cells.length ? `<span class="day-dots">${cells.map(cell => `<button type="button" class="day-cell ${cellClass(cell)}" ${cell.booking ? `data-free="${escapeHtml(cell.booking.id)}" title="${escapeHtml(cell.name)}: ${escapeHtml(cell.booking.customer)} (click to free)"` : `data-cell="${escapeHtml(cell.key)}" title="${escapeHtml(cell.name)}: ${resting(cell) ? 'blocked by the break between bookings, the AI will not offer it (you can still reserve it)' : 'free'} (click to reserve)"`}></button>`).join('')}</span>`
        : `<span class="day-bar"><i style="width:${Math.round(slot.booked / Math.max(1, slot.capacity) * 100)}%"></i></span>`;
      const breakNote = inBreak ? ` · ${inBreak} blocked by the break between bookings` : '';
      const state = slot.blocked ? 'Closed' : people ? `${slot.booked} of ${slot.capacity} people · ${free} free${free < slot.capacity - slot.booked ? ' (break between bookings)' : ''}` : free === 0 ? `${slot.booked === slot.capacity ? 'Full' : `${slot.booked} of ${slot.capacity} taken · none free`}${breakNote}` : slot.capacity === 1 ? 'Free' : `${slot.booked} of ${slot.capacity} taken · ${free} free${breakNote}`;
      const names = slot.places
        ? slot.places.map(place => place.booking ? `<span class="day-place taken${edit?.free.has(place.booking.id) ? ' to-free' : ''}"><b>${escapeHtml(place.name)}</b>${chip(place.booking)}</span>` : `<span class="day-place${edit?.reserve.has(`p${place.index}`) ? ' to-reserve' : freeSet && !freeSet.has(place.index) ? ' break' : ''}"><b>${escapeHtml(place.name)}</b><button type="button" class="day-free" data-cell="p${place.index}">${edit?.reserve.has(`p${place.index}`) ? 'reserve ✓' : freeSet && !freeSet.has(place.index) ? 'break' : 'free'}</button></span>`).join('')
        : slot.bookings.map(item => `<span class="day-place taken${edit?.free.has(item.id) ? ' to-free' : ''}">${chip(item)}</span>`).join('');
      const peopleInput = people && !slot.blocked && free > 0 ? `<label class="day-people">Reserve <input class="ui-input" type="number" min="0" max="${free}" value="${edit?.people || ''}" placeholder="0" data-people-input> people</label>` : '';
      const count = editCount(edit);
      const parts = edit ? [edit.reserve.size && `reserve ${edit.reserve.size}`, edit.people > 0 && `reserve ${edit.people} people`, edit.free.size && `free ${edit.free.size}`].filter(Boolean).join(' · ') : '';
      return `<div class="day-slot${free === 0 ? ' full' : ''}" data-slot="${escapeHtml(slot.start)}"><strong>${escapeHtml(slot.time)}</strong>${squares}<span class="day-state">${escapeHtml(state)}</span><span class="day-names">${names}${peopleInput}</span><div class="day-edit"${count ? '' : ' hidden'}><span>${escapeHtml(parts ? `${capitalize(parts)} at ${slot.time}` : `Changes at ${slot.time}`)}</span><button class="ui-btn ghost sm" type="button" data-day-cancel>Cancel</button><button class="ui-btn primary sm" type="button" data-day-save>Save</button></div></div>`;
    }).join('');
  }
  // Squares for places without names: each booking sits on its own place number; older bookings without a
  // number fill the remaining squares.
  function unnamedCells(slot) {
    const cells = Array.from({length:slot.capacity}, (_, index) => ({ key:`c${index}`, index, name:`${index + 1}`, booking:null }));
    const left = [];
    for (const booking of slot.bookings) { const cell = cells[booking.slot_index]; if (cell && !cell.booking) cell.booking = booking; else left.push(booking); }
    for (const booking of left) { const cell = cells.find(item => !item.booking); if (cell) cell.booking = booking; }
    return cells;
  }
  async function saveDayEdit(slot) {
    const edit = dayEdits.get(slot.start); if (!editCount(edit)) return;
    const delivery = dayData.kind === 'delivery', people = dayData.count_by === 'people';
    const freeing = slot.bookings.filter(item => edit.free.has(item.id));
    const customers = freeing.filter(item => !item.by_team);
    if (customers.length && !confirm(`This cancels ${customers.map(item => `${item.customer}${item.reference ? ` #${item.reference}` : ''}`).join(', ')}. The customer is not told automatically, so message them if needed. Continue?`)) return;
    const reserveCount = people ? edit.people : edit.reserve.size;
    if (people && reserveCount > Math.max(0, slot.capacity - slot.booked)) return alert(`Only ${Math.max(0, slot.capacity - slot.booked)} people are free at ${slot.time}.`);
    if (preview) { dayEdits.delete(slot.start); window.HansoraUI.toast('Saved (preview)'); return renderDay(dayData); }
    window.HansoraUI.busy('Saving…');
    try {
      for (const item of freeing) {
        const result = await api.db.from('automation_outcomes').update({status:'cancelled'}).eq('id', item.id).eq('business_id', businessId);
        if (result.error) throw result.error;
        const record = records.find(entry => entry.id === item.id); if (record) record.status = 'cancelled';
      }
      const label = dayData.place_label || 'Place';
      const base = {business_id:businessId, outcome_type:delivery ? 'order' : 'booking', title:`Reserved by your team · ${slot.time}`, customer_name:'Reserved', customer_phone:'', scheduled_start:slot.start, scheduled_end:slot.end, created_by:'human', status:'confirmed', summary:`Reserved from the day view for ${slot.time}.`, collected_fields:{Reserved:'By your team', Time:slot.time}};
      // Place numbers still taken at this time (freed ones become available again).
      const used = new Set(slot.bookings.filter(item => !edit.free.has(item.id)).map(item => item.slot_index));
      // Places that are really free (not in a break) first, then any other free number.
      const freeIndexes = () => [...new Set([...(slot.free_places || []), ...Array.from({length:500}, (_, index) => index)])].filter(index => !used.has(index));
      const wanted = people ? (reserveCount > 0 ? [{ people:reserveCount }] : []) : [...edit.reserve].map(key => key.startsWith('p') ? { index:Number(key.slice(1)), name:(slot.places || []).find(place => `p${place.index}` === key)?.name } : {});
      for (const want of wanted) {
        const row = {...base, collected_fields:{...base.collected_fields}};
        if (want.name) row.collected_fields[label] = want.name;
        if (want.people) { row.party_size = want.people; row.collected_fields.People = String(want.people); row.title = `${row.title} · ${want.people} people`; }
        let result;
        if (delivery) result = await api.db.from('automation_outcomes').insert(row).select(SELECT_ROW).single();
        else {
          const tries = Number.isInteger(want.index) ? [want.index] : freeIndexes();
          for (const index of tries) {
            result = await api.db.from('automation_outcomes').insert({...row, slot_index:index}).select(SELECT_ROW).single();
            // Database not updated yet (SQL files 8/9): save without the place number.
            if (/slot_index|party_size/.test(String(result.error?.message || ''))) { const plain = {...row}; delete plain.party_size; result = await api.db.from('automation_outcomes').insert(plain).select(SELECT_ROW).single(); break; }
            if (result.error?.code !== '23P01') break;
          }
        }
        if (result.error) throw result.error.code === '23P01' ? new Error('That place was just taken. The day view is refreshed.') : result.error;
        used.add(result.data.slot_index);
        records.unshift(mapRecord(result.data));
      }
      window.HansoraUI.busy(false);
      window.HansoraUI.toast('Saved. The AI sees it now.');
      render(); loadDay();
    } catch (error) { window.HansoraUI.busy(false); alert(api.displayError(error)); loadDay(); }
  }
  function previewDay(date) {
    const times = ['18:00','19:00','20:00','21:00','22:00'];
    const names = ['Table 1','Table 2','Table 3','Window','Terrace'];
    return { kind:'booking', kinds:{booking:true, delivery:true}, enabled:true, capacity:5, count_by:'bookings', place_label:'Table', date, slots: times.map((time, index) => {
      const start = `${date}T${time}:00.000Z`, end = `${date}T${pad(Number(time.slice(0, 2)) + 1)}:00:00.000Z`;
      const bookings = Array.from({length:[5,4,2,1,0][index]}, (_, n) => ({ id:`p${index}${n}`, customer:['Anna','Carlos','Maria','Noah','Sam'][n], reference:1040 + index * 5 + n, people:1, slot_index:n, by_team:n === 1 }));
      return { start, end, time, capacity:5, booked:bookings.length, blocked:false, bookings, places: names.map((name, n) => ({ index:n, name, booking: bookings[n] || null })) };
    }) };
  }

  $('#operations-tabs').addEventListener('click', event => {
    const button = event.target.closest('button[data-kind]'); if (!button) return;
    if (button.dataset.kind === 'day') return showDayView(true);
    activeKind = button.dataset.kind;
    showDayView(false);
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
  $('#record-type').addEventListener('change', async event => {
    const booking = event.target.value === 'booking';
    document.querySelectorAll('.booking-only').forEach(field => { field.hidden = !booking; });
    // People / place fields appear only when Business tools count by people or name the places.
    const config = booking && !preview ? await bookingConfig() : {};
    $('#record-people-field').hidden = !booking || config.count_by !== 'people';
    const places = config.count_by === 'people' ? [] : placeList(config);
    $('#record-place-field').hidden = !booking || !places.some(place => place.name);
    $('#record-place-label').textContent = config.place_label || 'Place';
    $('#record-place').innerHTML = '<option value="">Any free</option>' + places.filter(place => place.name).map(place => `<option value="${place.index}">${escapeHtml(place.name)}</option>`).join('');
  });
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
      // Bookings take the first free place (table, staff member…); the database refuses a taken place.
      const row = {business_id:businessId,outcome_type:kind,title,customer_name:customer,customer_phone:phone,estimated_value_minor:Math.round(value * 100),currency,scheduled_start:start?.toISOString() || null,scheduled_end:end?.toISOString() || null,conversation_id:/^[0-9a-f-]{36}$/i.test(params.get('conversation') || '') ? params.get('conversation') : null,created_by:'human',status:kind === 'booking' ? 'confirmed' : 'new',summary:`Created manually for ${customer}.`,collected_fields:{Customer:customer,Phone:phone || '—'}};
      const config = kind === 'booking' ? await bookingConfig() : {};
      const people = config.count_by === 'people';
      if (people) { const size = Math.min(5000, Math.max(1, Math.round(Number($('#record-people').value)) || 1)); row.party_size = size; row.collected_fields.People = String(size); }
      // People mode: the team decides, any free place number is used. Named place chosen: only that one.
      const chosen = !people && $('#record-place').value !== '' ? placeList(config).filter(place => String(place.index) === $('#record-place').value) : null;
      const places = kind !== 'booking' ? [] : chosen || (people ? Array.from({length:500}, (_, index) => ({index})) : placeList(config));
      if (chosen?.[0]?.name) row.collected_fields[config.place_label || 'Place'] = chosen[0].name;
      const select = '*, automation_conversations(channel_type), automation_contacts(display_name,primary_phone,profile,channel_type)';
      let result;
      if (!places.length) result = await api.db.from('automation_outcomes').insert(row).select(select).single();
      for (const place of places) {
        const insert = {...row, slot_index:place.index};
        if (place.name && !chosen) insert.collected_fields = {...row.collected_fields, [config.place_label || 'Place']:place.name};
        result = await api.db.from('automation_outcomes').insert(insert).select(select).single();
        // Database not updated yet (SQL files 8/9): save as before.
        if (/slot_index|party_size/.test(String(result.error?.message || ''))) { const plain = {...row}; delete plain.party_size; result = await api.db.from('automation_outcomes').insert(plain).select(select).single(); break; }
        if (result.error?.code !== '23P01') break;
      }
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
  async function bookingConfig() {
    const result = await api.db.from('automation_tool_configs').select('config').eq('business_id', businessId).eq('tool_type', 'calendar').maybeSingle();
    return result.data?.config || {};
  }
  // Named places keep their own numbers; otherwise places are 0 … capacity-1.
  function placeList(config) {
    const named = (Array.isArray(config.places) ? config.places : []).filter(place => place?.name && Number.isInteger(Number(place.index))).map(place => ({index:Number(place.index), name:String(place.name)}));
    if (named.length) return named;
    return Array.from({length:Math.min(500, Math.max(1, Number(config.capacity) || 1))}, (_, index) => ({index}));
  }
  function mapRecord(row) {
    const conversation = Array.isArray(row.automation_conversations) ? row.automation_conversations[0] : row.automation_conversations;
    const contact = Array.isArray(row.automation_contacts) ? row.automation_contacts[0] : row.automation_contacts;
    const channel = row.created_by === 'human' ? 'Manual' : CHANNELS[conversation?.channel_type || contact?.channel_type] || 'AI employee';
    // Who ordered: the Instagram @username, otherwise the phone number (WhatsApp, phone calls).
    const handle = contact?.profile?.username ? `@${contact.profile.username}` : contact?.primary_phone || row.customer_phone || '';
    const fields = Object.entries(row.collected_fields || {}).filter(([label]) => !label.startsWith('_')).map(([label, value]) => [label, String(value ?? '')]);
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
