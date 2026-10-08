(function () {
  'use strict';

  // Every server request is announced (before the database client is created, so it sees those too): the UI uses it
  // to show a spinner on the button that started the request, so no button ever looks frozen.
  if (!window.__hansoraFetchTracked && typeof window.fetch === 'function') {
    window.__hansoraFetchTracked = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (...args) {
      const request = nativeFetch(...args);
      try { window.dispatchEvent(new CustomEvent('hansora:request', { detail: { request } })); } catch (_) {}
      return request;
    };
  }

  const SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
  const isLocalPreview = window.location.protocol === 'file:' || new URLSearchParams(window.location.search).get('preview') === '1';
  const client = window.__HANSORA_SB__ || (
    window.supabase && window.supabase.createClient
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null
  );
  if (client) window.__HANSORA_SB__ = client;
  // Automation tables live in their own "automation" schema; profiles and credits stay in public.
  const db = client && typeof client.schema === 'function' ? client.schema('automation') : null;

  function safeReturnPath(value) {
    const fallback = '/automation-dashboard.html';
    if (!value) return fallback;
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin || !/^\/automation(?:[-a-z]*)(?:\.html)?(?:$|[?#])/.test(url.pathname + url.search + url.hash)) return fallback;
      return url.pathname + url.search + url.hash;
    } catch (_) {
      return fallback;
    }
  }

  async function getUser() {
    if (isLocalPreview) return { id: 'local-preview', email: 'preview@hansora.local' };
    if (!client) return null;
    // The saved login is read instantly (no network wait on every page switch); the server confirms it in the
    // background and an expired or revoked login is sent to sign in again. Data is protected server-side either way.
    const { data } = await client.auth.getSession();
    const user = data && data.session && data.session.user;
    if (!user) return null;
    client.auth.getUser().then(result => {
      if (result.error && [401, 403].includes(Number(result.error.status))) {
        client.auth.signOut().catch(() => {}).finally(() => window.location.replace('/automation.html?login=1&returnTo=' + encodeURIComponent(safeReturnPath(window.location.pathname + window.location.search))));
      }
    }).catch(() => {});
    return user;
  }

  async function requireUser(returnPath) {
    const user = await getUser();
    if (user) return user;
    const target = safeReturnPath(returnPath || (window.location.pathname + window.location.search));
    window.location.replace('/automation.html?login=1&returnTo=' + encodeURIComponent(target));
    return null;
  }

  async function authenticatedFetch(url, options) {
    if (!client) throw new Error('authentication_client_unavailable');
    const sessionResult = await client.auth.getSession();
    const token = sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
    if (!token) throw new Error('authentication_required');
    return fetch(url, {
      ...(options || {}),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...((options && options.headers) || {}) }
    });
  }

  function displayError(error) {
    const message = String(error && error.message ? error.message : error || 'Something went wrong.');
    const code = String(error && error.code ? error.code : '');
    if (code === 'PGRST106' || message.includes('Invalid schema') || message.includes('automation_save_agent') || message.includes('schema cache')) {
      return 'Automation storage is temporarily unavailable. Your information is still on this page. Please try again shortly.';
    }
    if (message.includes('JWT') || message.includes('authentication')) return 'Your session expired. Please log in again.';
    return message;
  }

  // Reply languages the AI employee supports (must match the database constraint and lib/automation/instructions.mjs).
  const languages = [['en','English','English'],['hy','Armenian','Հայերեն'],['ru','Russian','Русский'],['es','Spanish','Español'],['fr','French','Français'],['de','German','Deutsch'],['it','Italian','Italiano'],['pt','Portuguese','Português'],['uk','Ukrainian','Українська'],['pl','Polish','Polski'],['nl','Dutch','Nederlands'],['tr','Turkish','Türkçe'],['ar','Arabic','العربية'],['ka','Georgian','ქართული'],['zh','Chinese','中文'],['ja','Japanese','日本語'],['ko','Korean','한국어'],['hi','Hindi','हिन्दी']];
  const languageName = code => (languages.find(item => item[0] === code) || [code, code])[1];
  // Business types: the owner picks one; it sets starting settings and the names of the tools. Stored in
  // automation_businesses.category as the code (older free-text categories are recognised by keywords).
  const businessTypes = [
    { code:'restaurant', place:'Table', people:'Seats', places:'Tables', label:'Restaurant / café', emoji:'🍽️', booking:'Table reservations', order:'Delivery & takeaway', keywords:/restaurant|cafe|café|bar\b|pizz|sushi|burger|bistro|ресторан|кафе|ռեստորան|սրճարան/i,
      presets:{ calendar:{ enabled:true, config:{ duration_minutes:90, step_minutes:30, step_set:true, min_notice_minutes:30, required_fields:['Customer name','Phone number','Number of guests'] } }, orders:{ enabled:true, config:{ required_fields:['What they order','Customer name','Phone number','Delivery address or pickup','Desired time'] } } } },
    { code:'delivery', place:'Courier', people:'People', places:'Couriers', label:'Food delivery / takeaway', emoji:'🛵', booking:'Pickup times', order:'Deliveries', keywords:/deliver|takeaway|take-away|food|доставк|առաքում/i,
      presets:{ orders:{ enabled:true, config:{ required_fields:['What they order','Customer name','Phone number','Delivery address','Desired delivery time'] } } } },
    { code:'salon', place:'Staff member', people:'People', places:'Staff members', label:'Beauty / salon', emoji:'💇', booking:'Appointments', order:'Orders', keywords:/salon|beauty|hair|nail|barber|spa|lash|brow|салон|красот|գեղեցկ/i,
      presets:{ calendar:{ enabled:true, config:{ duration_minutes:60, step_minutes:15, step_set:true, min_notice_minutes:60 } } } },
    { code:'clinic', place:'Doctor', people:'People', places:'Doctors', label:'Doctor / clinic', emoji:'🩺', booking:'Appointments', order:'Orders', keywords:/clinic|doctor|dent|medical|health|therap|physio|клиник|врач|стомат|կլինիկ|բժիշկ|ատամ/i,
      presets:{ calendar:{ enabled:true, config:{ duration_minutes:30, step_minutes:15, step_set:true, min_notice_minutes:120 } }, handoff:{ enabled:true, config:{ rules:{ asks_person:true, complaint:true, missing_info:true, uncertain:true } } } } },
    { code:'services', place:'Team', people:'People', places:'Teams', label:'Home & local services', emoji:'🛠️', booking:'Visits', order:'Orders', keywords:/repair|clean|install|plumb|electric|renovat|furniture|interior|moving|ремонт|уборк|вերանորոգ|մաքր|կահույք/i,
      presets:{ calendar:{ enabled:true, config:{ duration_minutes:120, step_minutes:60, step_set:true, min_notice_minutes:1440 } }, leads:{ enabled:true } } },
    { code:'shop', place:'Staff member', people:'People', places:'Staff members', label:'Shop / e-commerce', emoji:'🛍️', booking:'Pickup times', order:'Orders', keywords:/shop|store|boutique|clothing|fashion|cosmetic|online store|магазин|խանութ/i,
      presets:{ orders:{ enabled:true, config:{ required_fields:['Product','Quantity','Customer name','Phone number','Delivery address'] } } } },
    { code:'saas', place:'Team member', people:'People', places:'Team members', label:'Online service / SaaS', emoji:'💻', booking:'Demo calls', order:'Orders', keywords:/saas|software|app\b|platform|subscription|startup|ai\b|online service|программ|ծրագր/i,
      presets:{ leads:{ enabled:true } } },
    { code:'realestate', place:'Agent', people:'People', places:'Agents', label:'Real estate', emoji:'🏠', booking:'Viewings', order:'Orders', keywords:/real estate|realty|apartment|property|rent|недвижим|квартир|անշարժ|բնակարան/i,
      presets:{ calendar:{ enabled:true, config:{ duration_minutes:60, step_minutes:30, step_set:true, min_notice_minutes:120 } }, leads:{ enabled:true } } },
    { code:'education', place:'Teacher', people:'Students', places:'Teachers', label:'Education / courses', emoji:'🎓', booking:'Lessons', order:'Enrollments', keywords:/school|course|lesson|tutor|academy|class|training|урок|курс|դասընթաց|դպրոց/i,
      presets:{ calendar:{ enabled:true, config:{ duration_minutes:60, step_minutes:30, step_set:true, min_notice_minutes:120 } }, leads:{ enabled:true } } },
    { code:'other', place:'Place', people:'People', places:'Places', label:'Other', emoji:'✳️', booking:'Bookings', order:'Orders', keywords:null, presets:{} }
  ];
  const businessType = category => {
    const value = String(category || '').trim();
    return businessTypes.find(type => type.code === value) || (value ? businessTypes.find(type => type.keywords && type.keywords.test(value)) : null) || null;
  };
  const suggestBusinessType = text => { const value = String(text || ''); return value.trim() ? businessTypes.find(type => type.keywords && type.keywords.test(value)) || null : null; };
  const browserLanguage = () => { const code = String(navigator.language || 'en').slice(0, 2).toLowerCase(); return languages.some(item => item[0] === code) ? code : 'en'; };
  const browserTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } };

  window.HansoraAutomation = {
    languages,
    languageName,
    businessTypes,
    businessType,
    suggestBusinessType,
    browserLanguage,
    browserTimezone,
    client,
    db,
    isLocalPreview,
    getUser,
    requireUser,
    authenticatedFetch,
    safeReturnPath,
    displayError
  };
})();
