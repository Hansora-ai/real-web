(function () {
  'use strict';
  if (window.HansoraFeedback) return;
  const SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
  const COPY = {
    en: { title: 'Share your feedback', placeholder: 'What could we make better?', note: 'Your feedback helps us improve Hansora.', send: 'Send feedback', sending: 'Sending…', close: 'Close feedback', thanks: 'Thank you!', sent: 'Your feedback has been sent.', done: 'Done', error: 'Could not send. Your message is still here—please try again.', login: 'Log in to send', auth: 'Please log in to send feedback.', empty: 'Write your feedback first.', limit: 'You’ve sent several messages. Please try again in an hour.' },
    ru: { title: 'Поделитесь мнением', placeholder: 'Что нам стоит улучшить?', note: 'Ваши отзывы помогают нам улучшать Hansora.', send: 'Отправить отзыв', sending: 'Отправляем…', close: 'Закрыть форму отзыва', thanks: 'Спасибо!', sent: 'Ваш отзыв отправлен.', done: 'Готово', error: 'Не удалось отправить. Текст сохранён в форме — попробуйте ещё раз.', login: 'Войти и отправить', auth: 'Войдите в аккаунт, чтобы отправить отзыв.', empty: 'Сначала напишите отзыв.', limit: 'Вы уже отправили несколько сообщений. Попробуйте снова через час.' },
    hy: { title: 'Կիսվեք ձեր կարծիքով', placeholder: 'Ի՞նչը կցանկանայիք բարելավել։', note: 'Ձեր կարծիքն օգնում է մեզ բարելավել Hansora-ն։', send: 'Ուղարկել կարծիքը', sending: 'Ուղարկվում է…', close: 'Փակել կարծիքի պատուհանը', thanks: 'Շնորհակալություն։', sent: 'Ձեր կարծիքն ուղարկվել է։', done: 'Պատրաստ է', error: 'Չհաջողվեց ուղարկել։ Ձեր գրածը պահպանվել է այս դաշտում․ փորձեք կրկին։', login: 'Մուտք գործել և ուղարկել', auth: 'Կարծիքն ուղարկելու համար մուտք գործեք ձեր հաշիվ։', empty: 'Նախ գրեք ձեր կարծիքը։', limit: 'Դուք արդեն մի քանի հաղորդագրություն եք ուղարկել։ Փորձեք կրկին մեկ ժամից։' }
  };
  const path = location.pathname;
  const declared = document.documentElement.lang || '';
  const language = /_arm(?:\.html)?\/?$/.test(path) || /^hy\b/i.test(declared) ? 'hy' : /_ru(?:\.html)?\/?$/.test(path) || /^ru\b/i.test(declared) ? 'ru' : 'en';
  const copy = COPY[language];
  let dialog, form, input, status, send, login, success, opener;
  let busy = false, requestId = '', requestMessage = '', requestUser = '';

  function mount() {
    if (dialog) return;
    const style = document.createElement('style');
    style.textContent = `
      #hansora-feedback{box-sizing:border-box;position:fixed;inset:84px 24px auto auto;margin:0;width:min(400px,calc(100vw - 32px));max-height:calc(100dvh - 108px);overflow:auto;overscroll-behavior:contain;padding:22px;border:1px solid #343542;border-radius:20px;background:#171820;color:#f7f7fb;box-shadow:0 24px 80px #0008;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color-scheme:dark;text-align:left;}
      #hansora-feedback::backdrop{background:rgba(0,0,0,.32)}
      #hansora-feedback *{box-sizing:border-box;}
      #hansora-feedback [hidden]{display:none!important;}
      #hansora-feedback h2{margin:0 30px 18px 0;color:#fff;font:700 19px/1.35 system-ui,sans-serif;letter-spacing:-.02em;}
      #hansora-feedback .hf-close{position:absolute;right:14px;top:14px;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:9px;background:transparent;color:#a8a9ba;cursor:pointer;font:24px/1 system-ui;}
      #hansora-feedback .hf-close:hover{background:#ffffff0d;color:#fff;}
      #hansora-feedback textarea{display:block;width:100%;min-height:140px;max-height:260px;resize:vertical;padding:14px;border:1px solid #444553;border-radius:12px;background:#101117;color:#fff;font:400 15px/1.6 system-ui,sans-serif;letter-spacing:normal;}
      #hansora-feedback textarea::placeholder{color:#9193a5;}
      #hansora-feedback :focus-visible{outline:2px solid #a78bfa;outline-offset:3px;}
      #hansora-feedback .hf-footer{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:14px;}
      #hansora-feedback .hf-note{margin:0;color:#a4a6b6;font-size:12px;line-height:1.5;}
      #hansora-feedback .hf-send{flex-shrink:0;min-height:42px;padding:10px 15px;border:1px solid #c4b5fd;border-radius:10px;background:#c4b5fd;color:#181226;cursor:pointer;font:650 13px/1.4 system-ui,sans-serif;white-space:normal;}
      #hansora-feedback button:disabled{opacity:.6;cursor:wait;}
      #hansora-feedback .hf-status{margin:12px 0 0;color:#fca5a5;font-size:13px;overflow-wrap:anywhere;}
      #hansora-feedback .hf-status:empty{display:none;}
      #hansora-feedback .hf-login{margin-top:12px;}
      #hansora-feedback .hf-success{text-align:center;padding:18px 0 4px;}
      #hansora-feedback .hf-success svg{width:42px;height:42px;color:#a78bfa;margin-bottom:12px;}
      #hansora-feedback .hf-success h2{margin:0 0 8px;}
      #hansora-feedback .hf-success p{color:#b8bac9;margin:0 0 22px;}
      @media(max-width:900px){#hansora-feedback{inset:0;margin:auto;width:min(400px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:20px;}#hansora-feedback textarea{max-height:200px;}#hansora-feedback .hf-footer{align-items:flex-start;}#hansora-feedback .hf-send{max-width:52%;}}
    `;
    document.head.appendChild(style);
    dialog = document.createElement('dialog');
    dialog.id = 'hansora-feedback';
    dialog.setAttribute('aria-labelledby', 'hf-title');
    dialog.innerHTML = `<button type="button" class="hf-close" aria-label="${copy.close}">×</button>
      <form><h2 id="hf-title">${copy.title}</h2>
      <textarea aria-label="${copy.title}" placeholder="${copy.placeholder}" maxlength="5000" required></textarea>
      <div class="hf-footer"><p class="hf-note">${copy.note}</p><button type="submit" class="hf-send">${copy.send}</button></div>
      <p class="hf-status" role="status" aria-live="polite"></p><button type="button" class="hf-send hf-login" hidden>${copy.login}</button></form>
      <div class="hf-success" hidden role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7 12 3 3 7-7"/></svg><h2 id="hf-thanks">${copy.thanks}</h2><p>${copy.sent}</p><button class="hf-send" type="button">${copy.done}</button></div>`;
    document.body.appendChild(dialog);
    form = dialog.querySelector('form'); input = dialog.querySelector('textarea'); status = dialog.querySelector('.hf-status');
    send = form.querySelector('[type=submit]'); login = dialog.querySelector('.hf-login'); success = dialog.querySelector('.hf-success');
    dialog.querySelector('.hf-close').addEventListener('click', close);
    success.querySelector('button').addEventListener('click', close);
    dialog.addEventListener('cancel', function (event) { if (busy) event.preventDefault(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    dialog.addEventListener('close', function () {
      const target = opener && opener.isConnected && opener.getClientRects().length ? opener : document.getElementById('hs-menu-btn');
      if (target) target.focus();
    });
    login.addEventListener('click', function () { const header = window.HansoraHeader; if (header && header.openAuth) { close(); header.openAuth('login'); } });
    input.addEventListener('input', function () { status.textContent = ''; login.hidden = true; });
    form.addEventListener('submit', submit);
  }
  function open(trigger) {
    mount();
    if (dialog.open) return;
    opener = trigger || document.activeElement;
    dialog.setAttribute('aria-labelledby', 'hf-title');
    form.hidden = false; success.hidden = true; status.textContent = ''; login.hidden = true;
    dialog.showModal(); input.focus();
  }
  function close() { if (!busy) dialog.close(); }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const message = input.value.trim();
    if (!message) { status.textContent = copy.empty; input.focus(); return; }
    busy = true; send.disabled = true; input.disabled = true; send.textContent = copy.sending; status.textContent = ''; login.hidden = true;
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 20000);
    try {
      const header = window.HansoraHeader;
      const token = header && header.getAccessToken ? await header.getAccessToken() : '';
      if (!token) { status.textContent = copy.auth; login.hidden = !(header && header.openAuth); return; }
      const user = header.getCurrentUser ? header.getCurrentUser() : null;
      const userId = user ? user.id : '';
      if (!requestId || requestMessage !== message || requestUser !== userId) { requestId = crypto.randomUUID(); requestMessage = message; requestUser = userId; }
      const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/submit_user_feedback', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
        body: JSON.stringify({ p_request_id: requestId, p_message: message, p_page_path: location.pathname.slice(0, 500), p_language: language })
      });
      if (!response.ok) {
        const error = await response.json().catch(function () { return {}; });
        if (response.status === 401 || /FEEDBACK_AUTH_REQUIRED/.test(error.message || '')) { status.textContent = copy.auth; login.hidden = !(header && header.openAuth); return; }
        if (/FEEDBACK_RATE_LIMITED/.test(error.message || '')) { status.textContent = copy.limit; return; }
        throw new Error('Feedback was not saved');
      }
      const savedId = await response.json();
      if (savedId !== requestId) throw new Error('Feedback save was not confirmed');
      input.value = ''; requestId = ''; requestMessage = ''; requestUser = ''; form.hidden = true; success.hidden = false; dialog.setAttribute('aria-labelledby', 'hf-thanks'); success.querySelector('button').focus();
    } catch (_) { status.textContent = copy.error; }
    finally { clearTimeout(timer); busy = false; send.disabled = false; input.disabled = false; send.textContent = copy.send; }
  }
  window.HansoraFeedback = { open: open };
  document.addEventListener('click', function (event) {
    const trigger = event.target.closest && event.target.closest('[data-hansora-feedback]');
    if (!trigger) return;
    event.preventDefault(); open(trigger);
  });
})();
