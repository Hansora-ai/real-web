(function () {
  'use strict';

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
    const result = await client.auth.getUser();
    return result.data && result.data.user ? result.data.user : null;
  }

  async function requireUser(returnPath) {
    const user = await getUser();
    if (user) return user;
    const target = safeReturnPath(returnPath || (window.location.pathname + window.location.search));
    window.location.replace('/login.html?returnTo=' + encodeURIComponent(target));
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
  const browserLanguage = () => { const code = String(navigator.language || 'en').slice(0, 2).toLowerCase(); return languages.some(item => item[0] === code) ? code : 'en'; };
  const browserTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } };

  window.HansoraAutomation = {
    languages,
    languageName,
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
