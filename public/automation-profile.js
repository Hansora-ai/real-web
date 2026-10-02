(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const ui = window.HansoraUI;
  const $ = selector => document.querySelector(selector);
  const DISPLAY = 10;
  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const lightning = stored => `${fmt.format(Math.round(Number(stored || 0) * DISPLAY * 100) / 100)}⚡`;
  const user = await api.requireUser('/automation-profile.html');
  if (!user) return;
  const sb = window.__HANSORA_SB__;
  $('#profile-loading').hidden = true;
  $('#profile-app').hidden = false;
  if (new URLSearchParams(location.search).get('checkout') === 'success') $('#checkout-success').hidden = false;

  // Account
  const meta = user.user_metadata || {};
  const name = meta.full_name || meta.name || meta.first_name || (user.email ? user.email.split('@')[0] : 'Your account');
  $('#profile-name').textContent = name;
  $('#profile-email').textContent = user.email || meta.username || '—';
  $('#profile-initial').textContent = String(name).trim().charAt(0).toUpperCase() || 'H';
  const avatar = meta.avatar_url || meta.picture || meta.photo_url;
  if (/^https:\/\//.test(avatar || '')) { const img = $('#profile-avatar'); img.referrerPolicy = 'no-referrer'; img.onload = () => { img.hidden = false; }; img.src = avatar; }
  const providers = [...new Set([user.app_metadata?.provider, ...(user.identities || []).map(identity => identity.provider)].filter(Boolean).map(String))];
  const providerName = value => ({ google: 'Google', email: 'Email & password', telegram: 'Telegram', 'custom:telegram': 'Telegram' }[value] || value);
  $('#profile-provider').textContent = providers.map(providerName).join(', ') || '—';
  $('#profile-joined').textContent = user.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(user.created_at)) : '—';
  if (!api.isLocalPreview) api.db.from('automation_businesses').select('id', { count: 'exact', head: true }).then(result => { $('#profile-employees').textContent = result.error ? 'Open' : `${result.count || 0} · Open`; });
  else $('#profile-employees').textContent = '1 · Open';

  // Credits
  async function loadCredits() {
    let stored = 0;
    if (api.isLocalPreview) stored = 842.3;
    else if (sb) { const { data } = await sb.from('profiles').select('credits').eq('user_id', user.id).maybeSingle(); stored = Number(data?.credits || 0); }
    const shown = stored * DISPLAY;
    $('#profile-balance').textContent = lightning(stored);
    $('#profile-balance-note').textContent = `≈ ${fmt.format(Math.floor(shown))} AI replies or ${fmt.format(Math.floor(shown / 8))} phone minutes`;
  }
  loadCredits().catch(() => {});
  setInterval(() => loadCredits().catch(() => {}), 15000);

  // Credit history (same history as Hansora Creative)
  (async () => {
    const status = $('#history-status'), holder = $('#history-rows');
    if (api.isLocalPreview) { status.textContent = 'Credit history appears here after the first purchase or AI reply.'; return; }
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/credit-history?limit=60', { method: 'GET' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'history_failed');
      const rows = Array.isArray(result.rows) ? result.rows : [];
      if (!rows.length) { status.textContent = 'No credit history yet.'; return; }
      holder.innerHTML = rows.map(row => {
        const delta = Number(row.delta || 0);
        const tone = delta > 0 ? 'plus' : delta < 0 ? 'minus' : '';
        const when = row.changed_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.changed_at)) : '';
        const label = row.label || (delta > 0 ? 'Credits added' : delta < 0 ? 'Credits used' : 'Balance updated');
        return `<div class="ui-history-row"><span class="ui-history-dot ${tone}">${delta > 0 ? '+' : delta < 0 ? '−' : '•'}</span><span class="ui-history-main"><b>${escapeHtml(label)}</b><small>${escapeHtml(when)} · ${lightning(row.old_credits)} → ${lightning(row.new_credits)}</small></span><strong class="${tone}">${delta > 0 ? '+' : ''}${lightning(delta)}</strong></div>`;
      }).join('');
      status.hidden = true; holder.hidden = false;
    } catch (error) { status.textContent = 'Could not load your credit history. Please refresh the page.'; console.warn('credit history failed', error); }
  })();

  // Password (email & password accounts only)
  const emailAccount = providers.includes('email') || meta.hansora_auth_provider === 'email';
  $('#password-card').hidden = !emailAccount || api.isLocalPreview;
  const say = (message, tone = '') => { const el = $('#password-status'); el.textContent = message; el.dataset.tone = tone; };
  $('#password-form').addEventListener('submit', async event => {
    event.preventDefault();
    const current = $('#current-password').value, next = $('#new-password').value, repeat = $('#repeat-password').value;
    if (!current) return say('Enter your current password.', 'error');
    if (next.length < 6) return say('The new password must have at least 6 characters.', 'error');
    if (next !== repeat) return say('The new passwords do not match.', 'error');
    const button = $('#password-save'); button.disabled = true; say('Changing password…');
    try {
      const check = await sb.auth.signInWithPassword({ email: user.email, password: current });
      if (check.error) throw new Error('current');
      const update = await sb.auth.updateUser({ password: next });
      if (update.error) throw update.error;
      event.target.reset(); say('Your password has been changed.', 'success');
    } catch (error) { say(error.message === 'current' ? 'The current password is incorrect.' : 'Could not change the password. Please try again.', 'error'); }
    finally { button.disabled = false; }
  });
  $('#password-reset').addEventListener('click', async () => {
    try {
      const result = await sb.auth.resetPasswordForEmail(user.email, { redirectTo: `${location.origin}/profile.html?password_recovery=1` });
      if (result.error) throw result.error;
      say('We sent a reset link to your email.', 'success');
    } catch (_) { say('Could not send the reset email. Please try again.', 'error'); }
  });

  $('#profile-logout').addEventListener('click', async () => {
    try { await sb?.auth.signOut(); } catch (_) {}
    try { localStorage.setItem('hansora.header.loggedIn', '0'); } catch (_) {}
    location.href = 'automation.html';
  });

  ui?.stagger?.(document);
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
})();
