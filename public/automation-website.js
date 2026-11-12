// Website chat settings: which websites, how the bubble looks, visitor details, replies, and the line to paste.
// Saved through /.netlify/functions/automation-website-setup (it checks everything and keeps the widget key).
// The preview on the right is the real bubble (chat.js) in preview mode, so what the owner sees is what visitors get.
(async function () {
  'use strict';
  const api = window.HansoraAutomation; const ui = window.HansoraUI;
  const params = new URLSearchParams(location.search);
  const businessId = params.get('business') || (api.isLocalPreview ? 'preview' : '');
  const $ = selector => document.querySelector(selector);
  const COLORS = ['#7c3aed', '#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#111827'];
  const user = await api.requireUser(location.pathname + location.search); if (!user) return;
  if (!api.isLocalPreview && !/^[0-9a-f-]{36}$/i.test(businessId)) return fail('This link is invalid.');
  $('#web-back').href = `automation-agent.html?id=${encodeURIComponent(businessId)}${api.isLocalPreview ? '&preview=1' : ''}`;

  let state = null; let dirty = false; let frameReady = false;
  try { state = await call('get'); } catch (error) { return fail(api.displayError(error)); }
  $('#web-loading').hidden = true; $('#web-app').hidden = false;
  ui.hydrateIcons?.(document);
  renderColors(); fill(); bind(); renderStatus(); renderPreview();
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

  async function call(action, extra = {}) {
    if (api.isLocalPreview) {
      const base = state || { status: 'not_connected', business_name: 'Oak & Co', settings: { widget_key: 'hw_000000000000000000000000', allowed_domains: [], title: 'Oak & Co', greeting: 'Hi! 👋 How can we help?', color: '#7c3aed', position: 'right', ask_details: 'off', detail_fields: [], daily_limit: 500, automatic_replies: true, reply_delay: 0, show_branding: true } };
      if (action === 'save') base.settings = { ...base.settings, ...extra.settings };
      if (action === 'live') base.status = 'connected'; if (action === 'pause') base.status = 'paused';
      base.snippet = `<script src="${location.origin}/chat.js" data-key="${base.settings.widget_key}" async></script>`;
      return JSON.parse(JSON.stringify(base));
    }
    const response = await api.authenticatedFetch('/.netlify/functions/automation-website-setup', { method: 'POST', body: JSON.stringify({ business_id: businessId, action, ...extra }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.error || 'website_setup_failed');
    return result;
  }

  function fill() {
    const s = state.settings || {};
    $('#web-domains').value = (s.allowed_domains || []).join('\n');
    $('#web-title').value = s.title || state.business_name || '';
    $('#web-greeting').value = s.greeting || '';
    setColor(s.color || COLORS[0]);
    document.querySelectorAll('input[name="web-position"]').forEach(input => { input.checked = input.value === (s.position || 'right'); });
    $('#web-branding').checked = s.show_branding !== false;
    document.querySelectorAll('input[name="web-ask"]').forEach(input => { input.checked = input.value === (s.ask_details || 'off'); });
    const fields = (s.detail_fields || []).length ? s.detail_fields : ['name', 'phone'];
    document.querySelectorAll('#web-fields input').forEach(input => { input.checked = fields.includes(input.value); });
    $('#web-fields').hidden = (s.ask_details || 'off') === 'off';
    $('#web-auto').checked = s.automatic_replies !== false;
    $('#web-delay').value = String(s.reply_delay || 0);
    $('#web-limit').value = String(s.daily_limit || 500);
    $('#web-snippet').textContent = state.snippet;
    $('#web-preview-domain').textContent = (s.allowed_domains || [])[0] || 'yourwebsite.com';
  }

  function collect() {
    const ask = document.querySelector('input[name="web-ask"]:checked')?.value || 'off';
    return {
      allowed_domains: $('#web-domains').value.split(/[\s,]+/).filter(Boolean),
      title: $('#web-title').value,
      greeting: $('#web-greeting').value,
      color: $('#web-color').value,
      position: document.querySelector('input[name="web-position"]:checked')?.value || 'right',
      show_branding: $('#web-branding').checked,
      ask_details: ask,
      detail_fields: [...document.querySelectorAll('#web-fields input:checked')].map(input => input.value),
      automatic_replies: $('#web-auto').checked,
      reply_delay: Number($('#web-delay').value) || 0,
      daily_limit: Number($('#web-limit').value) || 500
    };
  }

  function bind() {
    // Only changes to how the bubble looks redraw the preview; the website, limits and reply settings don't.
    const touched = () => { dirty = true; $('#web-save-state').textContent = 'Unsaved changes'; };
    const changed = () => { touched(); renderPreview(); };
    $('#web-domains').addEventListener('input', () => { touched(); $('#web-preview-domain').textContent = $('#web-domains').value.split(/[\s,]+/).filter(Boolean)[0]?.replace(/^https?:\/\//, '').split('/')[0] || 'yourwebsite.com'; });
    $('#web-limit').addEventListener('input', touched);
    ['#web-title', '#web-greeting'].forEach(selector => $(selector).addEventListener('input', changed));
    ['#web-branding', '#web-color'].forEach(selector => $(selector).addEventListener('change', changed));
    ['#web-auto', '#web-delay'].forEach(selector => $(selector).addEventListener('change', touched));
    $('#web-color').addEventListener('input', () => { setColor($('#web-color').value); changed(); });
    document.querySelectorAll('input[name="web-position"]').forEach(input => input.addEventListener('change', changed));
    document.querySelectorAll('input[name="web-ask"]').forEach(input => input.addEventListener('change', () => { $('#web-fields').hidden = input.value === 'off' && input.checked; changed(); }));
    document.querySelectorAll('#web-fields input').forEach(input => input.addEventListener('change', changed));
    $('#web-colors').addEventListener('click', event => { const button = event.target.closest('button[data-color]'); if (!button) return; setColor(button.dataset.color); changed(); });
    $('#web-save').addEventListener('click', () => save());
    $('#web-live').addEventListener('click', async () => { if (!(await save(true))) return; await setLive('live'); });
    $('#web-pause').addEventListener('click', () => setLive('pause'));
    $('#web-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.snippet); ui.toast?.('Copied. Paste it into your website.'); }
      catch (_) { const range = document.createRange(); range.selectNodeContents($('#web-snippet')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
    });
  }

  async function save(quiet = false) {
    const settings = collect();
    const button = $('#web-save'); button.disabled = true; $('#web-save-state').textContent = 'Saving…';
    try {
      state = await call('save', { settings });
      dirty = false; fill(); renderStatus(); renderPreview();
      $('#web-save-state').textContent = 'Saved';
      const typed = $('#web-domains').value.split(/[\s,]+/).filter(Boolean).length;
      if (typed > (state.settings.allowed_domains || []).length) ui.toast?.('Some website addresses were not valid and were left out.', 'warning', 4500);
      else if (!quiet) ui.toast?.('Saved');
      return true;
    } catch (error) {
      $('#web-save-state').textContent = ''; ui.toast?.(api.displayError(error), 'error', 5000); return false;
    } finally { button.disabled = false; }
  }

  async function setLive(action) {
    if (action === 'live' && !(state.settings.allowed_domains || []).length) { $('#web-domains').setAttribute('aria-invalid', 'true'); $('#web-domains').focus(); ui.toast?.('Add the website where you put the chat bubble first.', 'error', 4500); return; }
    $('#web-domains').removeAttribute('aria-invalid');
    const button = action === 'live' ? $('#web-live') : $('#web-pause'); button.disabled = true;
    try { state = await call(action); renderStatus(); ui.toast?.(action === 'live' ? 'Live. Visitors of your website can now chat with your AI employee.' : 'Paused. The chat bubble is hidden on your website.'); }
    catch (error) { ui.toast?.(api.displayError(error), 'error', 5000); }
    finally { button.disabled = false; }
  }

  function renderStatus() {
    const live = state.status === 'connected', paused = state.status === 'paused';
    $('#web-dot').className = `web-dot${live ? ' live' : paused ? ' paused' : ''}`;
    $('#web-status').textContent = live ? 'Live' : paused ? 'Paused' : 'Not live yet';
    $('#web-live').hidden = live; $('#web-pause').hidden = !live;
    $('#web-live').textContent = paused ? 'Resume' : 'Go live';
  }

  function renderColors() {
    const box = $('#web-colors');
    COLORS.forEach(color => { const button = document.createElement('button'); button.type = 'button'; button.dataset.color = color; button.style.background = color; button.setAttribute('aria-label', `Colour ${color}`); box.insertBefore(button, $('#web-color')); });
  }
  function setColor(color) {
    $('#web-color').value = /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[0];
    document.querySelectorAll('#web-colors button[data-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === $('#web-color').value)));
  }

  // The preview frame runs the real chat.js in preview mode with the settings on screen.
  function previewConfig() {
    const s = collect();
    return { title: s.title || state.business_name || 'Chat with us', greeting: s.greeting, color: s.color, position: s.position, ask_details: s.ask_details, detail_fields: s.ask_details === 'off' ? [] : (s.detail_fields.length ? s.detail_fields : ['name', 'phone']), branding: s.show_branding };
  }
  function renderPreview() {
    const frame = $('#web-preview');
    if (frameReady && frame.contentWindow?.HansoraChatPreview) { frame.contentWindow.HansoraChatPreview.update(previewConfig()); return; }
    if (frame.dataset.loading) return;
    frame.dataset.loading = '1';
    const config = JSON.stringify(previewConfig()).replace(/</g, '\\u003c').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui,sans-serif;background:#fafafa;color:#9ca3af}.fake{padding:28px}.fake div{height:14px;background:#e5e7eb;border-radius:7px;margin:0 0 12px}.fake .h{height:26px;width:55%;background:#d1d5db;margin-bottom:22px}</style></head><body><div class="fake"><div class="h"></div><div style="width:90%"></div><div style="width:80%"></div><div style="width:85%"></div><div style="width:60%"></div></div><script src="${location.origin}/chat.js?v=20261112b" data-preview data-config="${config}"><\/script></body></html>`;
    frame.addEventListener('load', () => { frameReady = true; delete frame.dataset.loading; renderPreview(); }, { once: true });
  }

  function fail(message) { $('#web-loading').hidden = true; const box = $('#web-error'); box.textContent = message; box.hidden = false; }
})();
