(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const form = document.querySelector('#setup-form');
  const loading = document.querySelector('#setup-loading');
  const errorBox = document.querySelector('#setup-error');
  const nextButton = document.querySelector('#next-button');
  const backButton = document.querySelector('#back-button');
  const saveButton = document.querySelector('#save-button');
  const saveState = document.querySelector('#save-state');
  const steps = [...document.querySelectorAll('[data-step]')];
  const progress = [...document.querySelectorAll('[data-progress]')];
  const params = new URLSearchParams(location.search);
  const businessId = params.get('id');
  let currentStep = 0;

  const user = await api.requireUser(location.pathname + location.search);
  if (!user) return;
  // Languages come from the shared list; new AI employees start in the browser's language.
  document.querySelector('#language-chips').innerHTML = api.languages.map(([code, name, native]) => `<label class="ui-chip"><input type="checkbox" name="languages" value="${code}"${code === api.browserLanguage() ? ' checked' : ''}><span>${native}${native !== name ? ` <small>${name}</small>` : ''}</span></label>`).join('');
  document.querySelector('#primary-language').innerHTML = api.languages.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
  document.querySelector('#primary-language').value = api.browserLanguage();
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
  form.addEventListener('input', event => {
    saveState.textContent = 'Unsaved changes';
    saveState.classList.remove('error');
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
    if (window.scrollY > 200) document.querySelector('.ui-stepper').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validateStep(index) {
    const visible = steps[index];
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
      ['Category', data.get('category') || 'Not added'],
      ['Languages', selectedLanguages().map(api.languageName).join(', ')],
      ['Tone', capitalize(data.get('tone'))],
      ['Knowledge', `${knowledgeCount()} of 5 sections filled`]
    ];
    document.querySelector('#review-grid').innerHTML = items.map(item => `<div><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong></div>`).join('');
  }

  function knowledgeCount() {
    return ['services','hours','delivery','faq','policies'].filter(name => String(form.elements[name].value || '').trim()).length;
  }

  async function save(event) {
    event.preventDefault();
    for (const stepIndex of [0, 2]) {
      if (!validateStep(stepIndex)) { showStep(stepIndex); validateStep(stepIndex); return; }
    }
    const data = new FormData(form);
    saveButton.disabled = true;
    saveState.textContent = 'Saving…';
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
      saveButton.disabled = false;
      const message = api.displayError(result.error);
      saveState.textContent = 'Not saved';
      saveState.classList.add('error');
      inlineError(message);
      return;
    }
    if (!businessId) await api.db.from('automation_businesses').update({ timezone: api.browserTimezone() }).eq('id', result.data);
    saveState.textContent = 'Preparing your AI employee…';
    try {
      const syncResponse = await api.authenticatedFetch('/.netlify/functions/automation-agent-sync', {
        method: 'POST', body: JSON.stringify({ business_id: result.data })
      });
      const syncResult = await syncResponse.json().catch(() => ({}));
      sessionStorage.setItem('hansora_automation_sync_notice', syncResponse.ok
        ? 'AI provider agent synchronized.'
        : `Business saved, but the AI could not be prepared: ${syncResult.detail || syncResult.error || 'sync unavailable'}`);
    } catch (_) {
      sessionStorage.setItem('hansora_automation_sync_notice', 'Business saved. Provider setup is pending.');
    }
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
