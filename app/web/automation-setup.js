(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const form = document.querySelector('#setup-form');
  const loading = document.querySelector('#setup-loading');
  const errorBox = document.querySelector('#setup-error');
  const nextButton = document.querySelector('#next-button');
  const backButton = document.querySelector('#back-button');
  const saveButton = document.querySelector('#save-button');
  const saveStepButton = document.querySelector('#save-step-button');
  const saveState = document.querySelector('#save-state');
  const steps = [...document.querySelectorAll('[data-step]')];
  const progress = [...document.querySelectorAll('[data-progress]')];
  const params = new URLSearchParams(location.search);
  let businessId = params.get('id');
  let currentStep = 0;

  const user = await api.requireUser(location.pathname + location.search);
  if (!user) return;
  // Languages come from the shared list; new AI employees start in the browser's language.
  document.querySelector('#language-chips').innerHTML = api.languages.map(([code, name, native]) => `<label class="ui-chip"><input type="checkbox" name="languages" value="${code}"${code === api.browserLanguage() ? ' checked' : ''}><span>${native}${native !== name ? ` <small>${name}</small>` : ''}</span></label>`).join('');
  document.querySelector('#primary-language').innerHTML = api.languages.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
  document.querySelector('#primary-language').value = api.browserLanguage();
  // Type of business: required card picker; suggested from the description until the owner picks one.
  let typeChosenByOwner = false;
  const typeGrid = document.querySelector('#type-grid');
  typeGrid.innerHTML = api.businessTypes.map(type => `<button type="button" class="type-card" role="radio" aria-checked="false" data-type="${type.code}"><span aria-hidden="true">${type.emoji}</span><strong>${escapeHtml(type.label)}</strong></button>`).join('');
  function selectType(code, byOwner) {
    form.elements.category.value = code || '';
    typeGrid.querySelectorAll('.type-card').forEach(card => card.setAttribute('aria-checked', String(card.dataset.type === code)));
    if (byOwner) typeChosenByOwner = true;
    if (code) typeGrid.removeAttribute('aria-invalid');
  }
  typeGrid.addEventListener('click', event => {
    const card = event.target.closest('.type-card'); if (!card) return;
    selectType(card.dataset.type, true); errorBox.hidden = true;
    document.querySelector('#type-hint').textContent = 'This sets up the right tools and names for your business. You can change everything later.';
    saveState.textContent = 'Unsaved changes';
  });
  form.elements.description.addEventListener('input', () => {
    if (typeChosenByOwner) return;
    const suggested = api.suggestBusinessType(`${form.elements.business_name.value} ${form.elements.description.value}`);
    if (suggested && suggested.code !== form.elements.category.value) { selectType(suggested.code, false); document.querySelector('#type-hint').textContent = `Suggested from your description: ${suggested.label}. Change it if it is not right.`; }
  });
  if (businessId && !api.isLocalPreview && !/^[0-9a-f-]{36}$/i.test(businessId)) return fail('This AI employee link is invalid.');

  if (businessId && api.isLocalPreview) {
    fillExisting(getPreviewBusiness());
    document.querySelector('#setup-title').textContent = 'Edit your AI employee';
  } else if (businessId) {
    const result = await api.db
      .from('automation_businesses')
      .select('id,name,category,description,contact_phone,contact_email,automation_agents(*),automation_business_knowledge(*)')
      .eq('id', businessId)
      .maybeSingle();
    if (result.error) return fail(api.displayError(result.error));
    if (!result.data) return fail('AI employee not found, or you do not have access to it.');
    fillExisting(result.data);
    document.querySelector('#setup-title').textContent = 'Edit your AI employee';
  }
  loading.hidden = true;
  form.hidden = false;
  showStep(0);

  nextButton.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    if (currentStep === 2) renderReview();
    showStep(Math.min(3, currentStep + 1));
  });
  backButton.addEventListener('click', () => showStep(Math.max(0, currentStep - 1)));
  progress.forEach((item, index) => item.addEventListener('click', () => { if (index < currentStep) showStep(index); }));
  form.addEventListener('submit', save);
  // Editing an existing AI employee: every step can be saved on its own (the page stays open).
  saveStepButton.addEventListener('click', event => save(event, { stay: true }));
  let unsaved = false;
  const markUnsaved = () => { unsaved = true; saveState.textContent = 'Unsaved changes'; saveState.classList.remove('error'); };
  window.addEventListener('beforeunload', event => { if (unsaved) { event.preventDefault(); event.returnValue = ''; } });
  form.addEventListener('input', event => {
    markUnsaved();
    if (event.target.matches('input,textarea,select')) event.target.removeAttribute('aria-invalid');
  });

  function showStep(index) {
    currentStep = index;
    steps.forEach((step, stepIndex) => step.hidden = stepIndex !== index);
    progress.forEach((item, itemIndex) => { item.classList.toggle('active', itemIndex === index); item.classList.toggle('done', itemIndex < index); });
    document.querySelector('.ui-stepper').style.setProperty('--progress-num', String(index / (steps.length - 1)));
    backButton.hidden = index === 0;
    nextButton.hidden = index === steps.length - 1;
    saveButton.hidden = index !== steps.length - 1;
    saveStepButton.hidden = !businessId || index === steps.length - 1;
    if (window.scrollY > 200) document.querySelector('.ui-stepper').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Files and one long text are kept here and uploaded to the AI's knowledge base right after saving.
  const KNOWLEDGE_TYPES = ['pdf','docx','txt','md','html','htm','epub'];
  const pendingFiles = [];
  // Saved knowledge marked for removal: nothing is deleted until the owner saves (leaving the page keeps it).
  const pendingRemovals = new Set();
  function renderPendingFiles(existing = []) {
    const list = document.querySelector('#setup-files-list');
    list.innerHTML = [
      ...existing.map(document => pendingRemovals.has(document.id)
        ? `<div class="ui-kfile is-removing"><span class="ui-kfile-type">Remove</span><span class="ui-kfile-main"><strong>${escapeHtml(document.name)}</strong><small>Removed when you save</small></span><button class="ui-btn ghost sm" type="button" data-undo-remove="${escapeHtml(document.id)}">Undo</button></div>`
        : `<div class="ui-kfile"><span class="ui-kfile-type">Added</span><span class="ui-kfile-main"><strong>${escapeHtml(document.name)}</strong></span><button class="ui-btn ghost sm ui-kfile-remove" type="button" data-remove-existing="${escapeHtml(document.id)}" aria-label="Remove ${escapeHtml(document.name)}" title="Remove">×</button></div>`),
      ...pendingFiles.map((file, index) => `<div class="ui-kfile"><span class="ui-kfile-type">New</span><span class="ui-kfile-main"><strong>${escapeHtml(file.name)}</strong><small>${Math.max(1, Math.round(file.size / 1024))} KB · uploads when you save</small></span><button class="ui-btn ghost sm ui-kfile-remove" type="button" data-remove-pending="${index}" aria-label="Remove ${escapeHtml(file.name)}" title="Remove">×</button></div>`)
    ].join('');
  }
  document.querySelector('#setup-files').addEventListener('change', event => {
    const rejected = [];
    for (const file of event.target.files) {
      const extension = file.name.toLowerCase().split('.').pop();
      if (!KNOWLEDGE_TYPES.includes(extension)) rejected.push(`${file.name} (file type not supported)`);
      else if (file.size > 4 * 1024 * 1024) rejected.push(`${file.name} (larger than 4 MB)`);
      else if (pendingFiles.length < 20) pendingFiles.push(file);
    }
    event.target.value = '';
    renderPendingFiles(existingKnowledge);
    if (rejected.length) inlineError(`Not added: ${rejected.join(', ')}.`); else errorBox.hidden = true;
  });
  document.querySelector('#setup-files-list').addEventListener('click', async event => {
    const marked = event.target.closest('[data-remove-existing]');
    const undo = event.target.closest('[data-undo-remove]');
    if (marked || undo) {
      const row = (marked || undo).closest('.ui-kfile');
      if (marked) pendingRemovals.add(marked.dataset.removeExisting); else pendingRemovals.delete(undo.dataset.undoRemove);
      row?.classList.add('is-changing');
      setTimeout(() => { renderPendingFiles(existingKnowledge); markUnsaved(); }, 180);
      return;
    }
    const button = event.target.closest('[data-remove-pending]');
    if (!button) return;
    pendingFiles.splice(Number(button.dataset.removePending), 1);
    renderPendingFiles(existingKnowledge);
  });
  let existingKnowledge = [];
  if (businessId && !api.isLocalPreview) {
    api.authenticatedFetch('/.netlify/functions/automation-knowledge', { method:'POST', body:JSON.stringify({ business_id:businessId, action:'list' }) })
      .then(response => response.ok ? response.json() : { documents: [] })
      .then(result => { existingKnowledge = result.documents || []; renderPendingFiles(existingKnowledge); })
      .catch(() => {});
  }
  const readAsBase64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('file_unreadable')); reader.readAsDataURL(file); });
  // Returns the names that could not be added (the rest of the save is never blocked by a file).
  // Why a knowledge file was not added, in words the owner can act on.
  function knowledgeReason(result) {
    return ({
      knowledge_file_type_not_supported:'file type not supported – use PDF, Word, TXT, Markdown, HTML or EPUB',
      knowledge_file_too_large:'larger than 4 MB',
      knowledge_file_empty:'the file is empty',
      knowledge_text_too_long:'text too long – split it into parts',
      knowledge_limit_reached:'50 items limit reached',
      ai_employee_not_ready:'AI employee not ready yet',
      elevenlabs_request_failed:`the AI provider refused it${result?.detail ? `: ${String(result.detail).slice(0, 160)}` : ''}`
    })[result?.error] || (result?.error ? String(result.error).replace(/_/g, ' ') : 'unknown error');
  }

  // Removes the knowledge the owner marked, now that they saved. Returns what could not be removed.
  async function applyRemovals(savedBusinessId) {
    const failed = [];
    for (const id of [...pendingRemovals]) {
      const name = existingKnowledge.find(document => document.id === id)?.name || 'A file';
      try {
        const response = await api.authenticatedFetch('/.netlify/functions/automation-knowledge', { method:'POST', body:JSON.stringify({ business_id:savedBusinessId, action:'remove', document_id:id }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok && result.error !== 'knowledge_document_not_found') { failed.push(`${name} (${knowledgeReason(result)})`); continue; }
        if (Array.isArray(result.documents)) existingKnowledge = result.documents; else existingKnowledge = existingKnowledge.filter(document => document.id !== id);
        pendingRemovals.delete(id);
      } catch (_) { failed.push(`${name} (connection problem)`); }
    }
    return failed;
  }

  async function uploadKnowledge(savedBusinessId) {
    const generalText = document.querySelector('#general-info').value.trim();
    const jobs = [...pendingFiles.map(file => ({ file, label:file.name, build:async () => ({ kind:'file', filename:file.name, content_base64:await readAsBase64(file) }) })),
      ...(generalText ? [{ label:'Business information text', build:async () => ({ kind:'text', name:'General business information', text:generalText }) }] : [])];
    const failed = [];
    for (const [index, job] of jobs.entries()) {
      saveState.textContent = `Adding knowledge ${index + 1} of ${jobs.length}…`;
      window.HansoraUI.busy(`Adding knowledge ${index + 1} of ${jobs.length}…`);
      try {
        const response = await api.authenticatedFetch('/.netlify/functions/automation-knowledge', { method:'POST', body:JSON.stringify({ business_id:savedBusinessId, action:'add', ...(await job.build()) }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) { failed.push(`${job.label} (${knowledgeReason(result)})`); continue; }
        // Added: it is not sent again on the next save.
        if (Array.isArray(result.documents)) existingKnowledge = result.documents;
        if (job.file) { const at = pendingFiles.indexOf(job.file); if (at >= 0) pendingFiles.splice(at, 1); }
        else document.querySelector('#general-info').value = '';
      } catch (_) { failed.push(`${job.label} (connection problem)`); }
    }
    return failed;
  }

  function validateStep(index) {
    const visible = steps[index];
    if (index === 0 && !form.elements.category.value) {
      typeGrid.setAttribute('aria-invalid', 'true'); inlineError('Choose the type of your business.');
      typeGrid.scrollIntoView({behavior:'smooth', block:'center'}); return false;
    }
    const required = [...visible.querySelectorAll('[required]')];
    for (const input of required) {
      if (!String(input.value || '').trim()) return fieldError(input, requiredMessage(input));
      if (!input.checkValidity()) return fieldError(input, input.type === 'email' ? 'Enter a valid business email address.' : 'Check this field and try again.');
    }
    if (index === 2) {
      const selected = selectedLanguages();
      if (!selected.length) return inlineError('Choose at least one supported language.');
      if (selected.length > 10) return inlineError('Choose up to 10 languages.');
      const primary = form.elements.primary_language.value;
      if (!selected.includes(primary)) return inlineError('The primary language must also be selected above.');
    }
    errorBox.hidden = true;
    return true;
  }

  function selectedLanguages() {
    return [...form.querySelectorAll('input[name="languages"]:checked')].map(input => input.value);
  }

  function renderReview() {
    const data = new FormData(form);
    const items = [
      ['Business', data.get('business_name')],
      ['AI employee', data.get('display_name')],
      ['Type of business', api.businessType(data.get('category'))?.label || 'Not chosen'],
      ['Languages', selectedLanguages().map(api.languageName).join(', ')],
      ['Tone', capitalize(data.get('tone'))],
      ['Knowledge', [`${knowledgeCount()} of 5 sections filled`, pendingFiles.length ? `${pendingFiles.length} file${pendingFiles.length === 1 ? '' : 's'} to upload` : '', document.querySelector('#general-info').value.trim() ? 'business text added' : ''].filter(Boolean).join(' · ')]
    ];
    document.querySelector('#review-grid').innerHTML = items.map(item => `<div><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong></div>`).join('');
  }

  function knowledgeCount() {
    return ['services','hours','delivery','faq','policies'].filter(name => String(form.elements[name].value || '').trim()).length;
  }

  // Button feedback for saving: a spinner, then "✓ Saved" (the per-step button) – never a frozen button.
  function setSaving(on, stay, done = false) {
    const button = stay ? saveStepButton : saveButton;
    button.disabled = on;
    button.classList.toggle('is-busy', on);
    if (!stay) return;
    if (on) { button.innerHTML = '<span class="ui-spinner" aria-hidden="true"></span>Saving…'; return; }
    if (done) { button.textContent = '✓ Saved'; button.classList.add('is-saved'); setTimeout(() => { button.classList.remove('is-saved'); button.textContent = 'Save changes'; }, 1800); return; }
    button.textContent = 'Save changes';
  }

  async function save(event, options = {}) {
    event.preventDefault();
    const stay = Boolean(options.stay && businessId);
    for (const stepIndex of [0, 2]) {
      if (!validateStep(stepIndex)) { showStep(stepIndex); validateStep(stepIndex); return; }
    }
    const data = new FormData(form);
    setSaving(true, stay);
    saveState.textContent = 'Saving…';
    if (!stay) window.HansoraUI.busy('Saving your AI employee…');
    saveState.classList.remove('error');
    if (api.isLocalPreview) {
      const previewBusiness = {
        id: 'preview',
        name: data.get('business_name'),
        category: data.get('category') || '',
        description: data.get('description') || '',
        contact_phone: data.get('contact_phone') || '',
        contact_email: data.get('contact_email') || '',
        automation_agents: [{
          display_name: data.get('display_name'),
          primary_language: data.get('primary_language'),
          supported_languages: selectedLanguages(),
          tone: data.get('tone'),
          custom_instructions: data.get('custom_instructions') || '',
          prohibited_instructions: data.get('prohibited_instructions') || '',
          status: 'draft'
        }],
        automation_business_knowledge: [{
          services_and_prices: data.get('services') || '',
          opening_hours: data.get('hours') || '',
          delivery_and_service_areas: data.get('delivery') || '',
          frequently_asked_questions: data.get('faq') || '',
          policies: data.get('policies') || ''
        }]
      };
      try { localStorage.setItem('hansora_automation_preview_business', JSON.stringify(previewBusiness)); } catch (_) {}
      unsaved = false;
      if (stay) { await new Promise(resolve => setTimeout(resolve, 500)); pendingRemovals.clear(); renderPendingFiles(existingKnowledge); setSaving(false, true, true); saveState.textContent = 'All changes saved'; return; }
      window.location.href = window.location.protocol === 'file:'
        ? 'automation-agent.html?id=preview'
        : 'automation-agent.html?id=preview&preview=1';
      return;
    }
    const result = await api.db.rpc('automation_save_agent', {
      p_business_id: businessId || null,
      p_business_name: data.get('business_name'),
      p_category: data.get('category') || '',
      p_description: data.get('description') || '',
      p_contact_phone: data.get('contact_phone') || '',
      p_contact_email: data.get('contact_email') || '',
      p_display_name: data.get('display_name'),
      p_primary_language: data.get('primary_language'),
      p_supported_languages: selectedLanguages(),
      p_tone: data.get('tone'),
      p_business_profile: {
        services_and_prices: data.get('services') || '',
        opening_hours: data.get('hours') || '',
        delivery_and_service_areas: data.get('delivery') || '',
        frequently_asked_questions: data.get('faq') || '',
        policies: data.get('policies') || ''
      },
      p_custom_instructions: data.get('custom_instructions') || '',
      p_prohibited_instructions: data.get('prohibited_instructions') || ''
    });
    if (result.error) {
      setSaving(false, stay);
      window.HansoraUI.busy(false);
      const message = api.displayError(result.error);
      saveState.textContent = 'Not saved';
      saveState.classList.add('error');
      inlineError(message);
      return;
    }
    if (!businessId) await api.db.from('automation_businesses').update({ timezone: api.browserTimezone() }).eq('id', result.data);
    saveState.textContent = stay ? 'Saving…' : 'Preparing your AI employee…';
    if (!stay) window.HansoraUI.busy('Preparing your AI employee…');
    try {
      const syncResponse = await api.authenticatedFetch('/.netlify/functions/automation-agent-sync', {
        method: 'POST', body: JSON.stringify({ business_id: result.data })
      });
      const syncResult = await syncResponse.json().catch(() => ({}));
      const hasKnowledge = pendingFiles.length || document.querySelector('#general-info').value.trim();
      const failed = [...(syncResponse.ok && pendingRemovals.size ? await applyRemovals(result.data) : []), ...(syncResponse.ok && hasKnowledge ? await uploadKnowledge(result.data) : [])];
      // A file that was not added stops here, on this page, so the owner sees why and can retry right away.
      if (syncResponse.ok && failed.length) {
        if (!businessId) { businessId = result.data; history.replaceState(null, '', `automation-setup.html?id=${encodeURIComponent(result.data)}${location.hash}`); }
        renderPendingFiles(existingKnowledge);
        window.HansoraUI.busy(false); setSaving(false, stay);
        saveState.textContent = 'Saved · some knowledge was not added';
        errorBox.innerHTML = `<div><strong>Your AI employee is saved, but this was not added:</strong><ul>${failed.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p>Fix or remove it in the Knowledge step and press Save again – only what failed is sent again.</p><a class="ui-btn secondary sm" href="automation-agent.html?id=${encodeURIComponent(result.data)}">Continue without it</a></div>`;
        errorBox.hidden = false; errorBox.scrollIntoView({ behavior:'smooth', block:'center' });
        return;
      }
      if (stay) {
        unsaved = false; renderPendingFiles(existingKnowledge); setSaving(false, true, true);
        saveState.textContent = syncResponse.ok ? 'All changes saved' : 'Saved · the AI will update on the next message';
        return;
      }
      sessionStorage.setItem('hansora_automation_sync_notice', !syncResponse.ok
        ? `Business saved, but the AI could not be prepared: ${syncResult.detail || syncResult.error || 'sync unavailable'}${hasKnowledge ? ' Your files were not added yet.' : ''}`
        : failed.length ? `AI employee saved. Not added: ${failed.join(', ')}. Add them again under Knowledge files.` : 'AI provider agent synchronized.');
    } catch (_) {
      if (stay) { unsaved = false; setSaving(false, true, true); saveState.textContent = 'Saved · the AI will update on the next message'; return; }
      sessionStorage.setItem('hansora_automation_sync_notice', 'Business saved. Provider setup is pending.');
    }
    unsaved = false;
    window.location.href = 'automation-agent.html?id=' + encodeURIComponent(result.data);
  }

  function fillExisting(business) {
    const agent = Array.isArray(business.automation_agents) ? business.automation_agents[0] : business.automation_agents;
    const profile = Array.isArray(business.automation_business_knowledge)
      ? business.automation_business_knowledge[0] || {}
      : business.automation_business_knowledge || {};
    const values = {
      business_name: business.name, category: business.category, description: business.description,
      contact_phone: business.contact_phone, contact_email: business.contact_email,
      display_name: agent?.display_name, primary_language: agent?.primary_language,
      tone: agent?.tone, services: profile.services_and_prices, hours: profile.opening_hours,
      delivery: profile.delivery_and_service_areas, faq: profile.frequently_asked_questions,
      policies: profile.policies, custom_instructions: agent?.custom_instructions,
      prohibited_instructions: agent?.prohibited_instructions
    };
    Object.entries(values).forEach(([name, value]) => { if (form.elements[name]) form.elements[name].value = value || ''; });
    // Older free-text categories ("Home services") are matched to a type; unknown ones must be chosen again.
    const type = api.businessType(business.category);
    selectType(type ? type.code : '', Boolean(type));
    const supported = agent?.supported_languages || [api.browserLanguage()];
    form.querySelectorAll('input[name="languages"]').forEach(input => input.checked = supported.includes(input.value));
    saveState.textContent = 'Saved draft';
  }

  function getPreviewBusiness() {
    try {
      const saved = JSON.parse(localStorage.getItem('hansora_automation_preview_business') || 'null');
      if (saved) return saved;
    } catch (_) {}
    return {
      id: 'preview', name: 'Luma Studio', category: 'Home services',
      description: 'Custom interiors and renovation services.', contact_phone: '', contact_email: '',
      automation_agents: [{display_name:'Luma Assistant',primary_language:'en',supported_languages:['en','es','ru'],tone:'friendly',custom_instructions:'Be warm, concise and accurate.',prohibited_instructions:'Never invent a price.',status:'draft'}],
      automation_business_knowledge: [{services_and_prices:'Kitchen measurement — $25',opening_hours:'Monday–Saturday: 10:00–19:00',delivery_and_service_areas:'The city and nearby areas',frequently_asked_questions:'Do you offer warranty? | Yes, for 12 months.',policies:'Confirm availability before promising a date.'}]
    };
  }

  function requiredMessage(input) {
    return ({
      business_name: 'Enter your business name.',
      display_name: 'Give your AI employee a name.',
      description: 'Briefly describe what your business does.'
    })[input.name] || 'Complete this required field.';
  }

  function fieldError(input, message) {
    input.setAttribute('aria-invalid', 'true');
    inlineError(message);
    input.focus({preventScroll:true});
    input.scrollIntoView({behavior:'smooth',block:'center'});
    return false;
  }

  function inlineError(message) { errorBox.textContent = message; errorBox.hidden = false; errorBox.scrollIntoView({behavior:'smooth',block:'center'}); return false; }
  function fail(message) { loading.hidden = true; form.hidden = true; inlineError(message); }
  function capitalize(value) { return String(value || '').replace(/^./, character => character.toUpperCase()); }
  function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character])); }
})();
