(function () {
  'use strict';

  const SESSION_KEY = 'hansora.sales_agent.session.v1';
  const OPEN_KEY = 'hansora.sales_agent.open.v1';
  const language = detectLanguage();
  const copy = {
    en: {
      launcher: 'Ask Hansora AI', title: 'Hansora AI Sales Agent', online: 'Ready to help', close: 'Close chat',
      welcome: 'Hello. I can help you choose the right image or video model, calculate credits, or check your Hansora account.',
      placeholder: 'Describe what you want to create…', send: 'Send message', note: 'AI can make mistakes. Check important purchase details.',
      error: 'The assistant is temporarily unavailable. Please try again.', login: 'Please sign in to check account-specific information.',
      suggestions: ['Cheapest video model', 'Create Armenian-speaking video', 'Which credit package fits?']
    },
    hy: {
      launcher: 'Հարցնել Hansora AI-ին', title: 'Hansora AI վաճառքի օգնական', online: 'Պատրաստ է օգնել', close: 'Փակել զրույցը',
      welcome: 'Բարև Ձեզ։ Կարող եմ օգնել ընտրել պատկերի կամ տեսանյութի ճիշտ մոդելը, հաշվարկել կրեդիտները կամ ստուգել Ձեր Hansora հաշիվը։',
      placeholder: 'Նկարագրեք՝ ինչ եք ցանկանում ստեղծել…', send: 'Ուղարկել հաղորդագրությունը', note: 'AI-ը կարող է սխալվել։ Ստուգեք գնման կարևոր տվյալները։',
      error: 'Օգնականը ժամանակավորապես հասանելի չէ։ Խնդրում ենք կրկին փորձել։', login: 'Ձեր հաշվի տվյալները ստուգելու համար խնդրում ենք մուտք գործել։',
      suggestions: ['Ամենամատչելի վիդեո մոդելը', 'Հայերեն խոսող տեսանյութ', 'Ո՞ր կրեդիտային փաթեթն ընտրել']
    },
    ru: {
      launcher: 'Спросить Hansora AI', title: 'ИИ-консультант Hansora', online: 'Готов помочь', close: 'Закрыть чат',
      welcome: 'Здравствуйте. Я помогу выбрать модель для изображения или видео, рассчитать кредиты или проверить Ваш аккаунт Hansora.',
      placeholder: 'Опишите, что Вы хотите создать…', send: 'Отправить сообщение', note: 'ИИ может ошибаться. Проверяйте важные данные о покупке.',
      error: 'Ассистент временно недоступен. Пожалуйста, попробуйте ещё раз.', login: 'Войдите в аккаунт, чтобы проверить персональные данные.',
      suggestions: ['Самая доступная видеомодель', 'Видео с армянской речью', 'Какой пакет кредитов выбрать?']
    }
  }[language];

  let panel;
  let messages;
  let form;
  let input;
  let send;
  let sessionId = readSession();
  let initPromise = null;
  let loading = false;

  function detectLanguage() {
    const path = location.pathname.toLowerCase();
    const stored = localStorage.getItem('hansora.language.v1');
    if (path.includes('_arm.') || path === '/course_arm' || path === '/course_arm/') return 'hy';
    if (path.includes('_ru.') || path === '/course_ru' || path === '/course_ru/') return 'ru';
    if (stored === 'hy' || stored === 'ru') return stored;
    return 'en';
  }

  function readSession() {
    const value = localStorage.getItem(SESSION_KEY) || '';
    return /^[0-9a-f-]{36}$/i.test(value) ? value : '';
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      const number = Math.random() * 16 | 0;
      return (char === 'x' ? number : (number & 3 | 8)).toString(16);
    });
  }

  function escapeAttribute(value) {
    return String(value).replace(/[&"<>]/g, function (char) { return ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]; });
  }

  async function authHeaders() {
    const token = await window.HansoraHeader?.getAccessToken?.().catch(function () { return ''; });
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function build() {
    const root = document.createElement('div');
    root.id = 'hansora-sales-agent';
    root.innerHTML = '<button class="hsa-launcher" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="' + escapeAttribute(copy.launcher) + '">' +
      '<span class="hsa-launcher-label">' + escapeAttribute(copy.launcher) + '</span>' +
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l1.4 5.1L18 9l-4.6 1.9L12 16l-1.4-5.1L6 9l4.6-1.9L12 2Z" fill="currentColor"/><path d="M18.5 15l.8 2.7L22 18.5l-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7ZM5 13l.7 2.3L8 16l-2.3.7L5 19l-.7-2.3L2 16l2.3-.7L5 13Z" fill="currentColor"/></svg></button>' +
      '<section class="hsa-panel" role="dialog" aria-modal="false" aria-label="' + escapeAttribute(copy.title) + '" data-open="false">' +
      '<header class="hsa-head"><div class="hsa-avatar" aria-hidden="true">✦</div><div class="hsa-title"><strong>' + escapeAttribute(copy.title) + '</strong><span><i class="hsa-status-dot"></i>' + escapeAttribute(copy.online) + '</span></div><button class="hsa-close" type="button" aria-label="' + escapeAttribute(copy.close) + '">×</button></header>' +
      '<div class="hsa-messages" aria-live="polite"></div><footer class="hsa-foot"><div class="hsa-suggestions"></div><form class="hsa-form"><textarea class="hsa-input" rows="1" maxlength="4000" placeholder="' + escapeAttribute(copy.placeholder) + '" aria-label="' + escapeAttribute(copy.placeholder) + '"></textarea><button class="hsa-send" type="submit" aria-label="' + escapeAttribute(copy.send) + '"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Zm3.7 7h7.9L6.9 6.9 7.7 11Zm-.8 6.1 8.7-4.1H7.7l-.8 4.1Z" fill="currentColor"/></svg></button></form><p class="hsa-note">' + escapeAttribute(copy.note) + '</p></footer></section>';
    document.body.appendChild(root);
    panel = root.querySelector('.hsa-panel');
    messages = root.querySelector('.hsa-messages');
    form = root.querySelector('.hsa-form');
    input = root.querySelector('.hsa-input');
    send = root.querySelector('.hsa-send');
    copy.suggestions.forEach(function (label) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hsa-suggestion';
      button.textContent = label;
      button.addEventListener('click', function () { submitMessage(label); });
      root.querySelector('.hsa-suggestions').appendChild(button);
    });
    root.querySelector('.hsa-launcher').addEventListener('click', open);
    root.querySelector('.hsa-close').addEventListener('click', close);
    form.addEventListener('submit', function (event) { event.preventDefault(); submitMessage(input.value); });
    input.addEventListener('input', resizeInput);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
    });
    if (sessionStorage.getItem(OPEN_KEY) === '1') open();
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(112, input.scrollHeight) + 'px';
  }

  function addMessage(role, text, response, error) {
    const bubble = document.createElement('div');
    bubble.className = 'hsa-message hsa-message-' + role + (error ? ' hsa-message-error' : '');
    bubble.textContent = text;
    messages.appendChild(bubble);
    if (response?.actions?.length) addActions(response.actions);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function addActions(actions) {
    const row = document.createElement('div');
    row.className = 'hsa-actions';
    actions.forEach(function (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hsa-action';
      button.textContent = action.label;
      button.addEventListener('click', function () { handleAction(action); });
      row.appendChild(button);
    });
    messages.appendChild(row);
  }

  function typing() {
    const bubble = document.createElement('div');
    bubble.className = 'hsa-message hsa-message-agent hsa-typing';
    bubble.setAttribute('aria-label', '…');
    bubble.innerHTML = '<i></i><i></i><i></i>';
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function initialize() {
    if (initPromise) return initPromise;
    initPromise = (async function () {
      addMessage('agent', copy.welcome);
      try {
        const headers = await authHeaders();
        const query = new URLSearchParams({ language: language });
        if (sessionId) query.set('session_id', sessionId);
        const response = await fetch('/.netlify/functions/sales-chat?' + query.toString(), { credentials: 'same-origin', headers: headers });
        if (!response.ok) return;
        const payload = await response.json();
        sessionId = payload.session_id;
        localStorage.setItem(SESSION_KEY, sessionId);
        if (payload.messages?.length) {
          messages.textContent = '';
          payload.messages.forEach(function (item) { addMessage(item.role === 'user' ? 'user' : 'agent', item.content, item.response); });
        }
      } catch (_) {}
    })();
    return initPromise;
  }

  async function open() {
    panel.dataset.open = 'true';
    panel.parentElement.querySelector('.hsa-launcher').setAttribute('aria-expanded', 'true');
    sessionStorage.setItem(OPEN_KEY, '1');
    await initialize();
    input.focus();
    if (sessionId) recordEvent('chat_opened', { page: location.pathname }, 'open:' + sessionId).catch(function () {});
  }

  function close() {
    panel.dataset.open = 'false';
    panel.parentElement.querySelector('.hsa-launcher').setAttribute('aria-expanded', 'false');
    sessionStorage.removeItem(OPEN_KEY);
  }

  async function submitMessage(value) {
    const text = String(value || '').trim();
    if (!text || loading) return;
    loading = true;
    send.disabled = true;
    await initialize();
    input.value = '';
    resizeInput();
    addMessage('user', text);
    const indicator = typing();
    try {
      const headers = await authHeaders();
      headers['Content-Type'] = 'application/json';
      const response = await fetch('/.netlify/functions/sales-chat', {
        method: 'POST', credentials: 'same-origin', headers: headers,
        body: JSON.stringify({ session_id: sessionId || null, request_id: uid(), language: language, message: text })
      });
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok || !payload.reply) throw new Error(payload.error || 'request_failed');
      sessionId = payload.session_id;
      localStorage.setItem(SESSION_KEY, sessionId);
      indicator.remove();
      addMessage('agent', payload.reply.message, payload.reply);
    } catch (error) {
      indicator.remove();
      addMessage('agent', error.message === 'authentication_failed' ? copy.login : copy.error, null, true);
    } finally {
      loading = false;
      send.disabled = false;
      input.focus();
    }
  }

  function localized(base) {
    if (language === 'hy') return base.replace('.html', '_arm.html');
    if (language === 'ru') return base.replace('.html', '_ru.html');
    return base;
  }

  async function handleAction(action) {
    if (action.type === 'open_login') {
      if (window.HansoraHeader?.openAuth) window.HansoraHeader.openAuth();
      return;
    }
    let url = '';
    let eventType = '';
    if (action.type === 'open_pricing') { url = localized('/pricing.html'); eventType = 'pricing_link_clicked'; }
    if (action.type === 'open_model') { url = localized('/search-models.html') + '?model=' + encodeURIComponent(action.model); eventType = 'generate_link_clicked'; }
    if (action.type === 'open_course') { url = language === 'ru' ? '/course_ru' : '/course_arm'; }
    if (action.type === 'contact_support') { url = localized('/contact.html'); }
    if (!url) return;
    if (sessionId) {
      const separator = url.includes('?') ? '&' : '?';
      url += separator + 'chat_session=' + encodeURIComponent(sessionId);
      if (eventType) await recordEvent(eventType, { model: action.model || null, package: action.package || null }, eventType + ':' + uid()).catch(function () {});
    }
    location.href = url;
  }

  async function recordEvent(type, metadata, idempotencyKey) {
    if (!sessionId) return;
    const headers = await authHeaders();
    headers['Content-Type'] = 'application/json';
    await fetch('/.netlify/functions/sales-chat-events', {
      method: 'POST', credentials: 'same-origin', keepalive: true, headers: headers,
      body: JSON.stringify({ session_id: sessionId, type: type, language: language, model_id: metadata?.model || null, package_id: metadata?.package || null, metadata: metadata || {}, idempotency_key: idempotencyKey })
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
