(function () {
  'use strict';

  const SESSION_KEY = 'hansora.sales_agent.session.v1';
  const OPEN_KEY = 'hansora.sales_agent.open.v1';
  const POSITION_KEY = 'hansora.sales_agent.launcher_bottom.v1';
  const QUICK_REPLY_DELAY_MS = 1800;
  const language = detectLanguage();
  const copy = {
    en: {
      launcher: 'Ask Hansora AI', title: 'Hansora AI Assistant', online: 'Ready to help', close: 'Close chat',
      welcome: 'Hello. I can help you choose the right image or video model, calculate credits, or check your Hansora account.',
      placeholder: 'Describe what you want to create…', send: 'Send message', note: 'AI can make mistakes. Check important purchase details.',
      error: 'The assistant is temporarily unavailable. Please try again.', login: 'Please sign in to check account-specific information.',
      faqLabel: 'Top questions', telegram: 'Continue with a person on Telegram',
      faqs: [
        { question: 'What can I do with Hansora AI?', answer: 'Hansora AI brings multiple AI tools together in one platform. You can create images and videos, make speaking or lip-sync videos, use different AI models, get help with prompts, and learn how to use AI through Hansora courses. Tell me what you want to create, and I will guide you to the right tool and model.' },
        { question: 'How can I create an English-speaking video?', answer: 'All major Hansora video models support English, so you have several strong options depending on the video you want to create. For generated speech, you can use models such as Gemini Omni or Veo 3.1. For a longer speaking video with minimal extra movement, use Lipsync Avatar: upload the character or model image and an audio file. No prompt is required.' },
        { question: 'I have an idea, but I do not know which model or tool to use. Can you help me?', answer: 'Yes. Tell me what you want to create—for example, an advertisement, product video, talking character, realistic image, cinematic scene, or something else. I will recommend the most suitable Hansora model or tool and explain exactly what you need to upload or write.' },
        { question: 'What is the most affordable but still powerful video model?', answer: 'Grok Video is one of the most affordable and most-used video models on Hansora while still being very powerful. It can generate videos from around 6 to 30 seconds. It is a strong choice for good quality without spending too many credits and offers a good balance of price, speed, and quality.' },
        { question: 'How do I buy credits on Hansora AI?', answer: 'Hansora uses a credit system. On the Pricing page, you can choose a credit package and use those credits whenever you want across Hansora tools and models. Different models use different amounts of credits depending on the generation type, duration, and quality.' }
      ]
    },
    hy: {
      launcher: 'Հարցնել Hansora AI-ին', title: 'Hansora AI օգնական', online: 'Պատրաստ է օգնել', close: 'Փակել զրույցը',
      welcome: 'Բարև Ձեզ։ Կարող եմ օգնել ընտրել պատկերի կամ տեսանյութի ճիշտ մոդելը, հաշվարկել կրեդիտները կամ ստուգել Ձեր Hansora հաշիվը։',
      placeholder: 'Նկարագրեք՝ ինչ եք ցանկանում ստեղծել…', send: 'Ուղարկել հաղորդագրությունը', note: 'AI-ը կարող է սխալվել։ Ստուգեք գնման կարևոր տվյալները։',
      error: 'Օգնականը ժամանակավորապես հասանելի չէ։ Խնդրում ենք կրկին փորձել։', login: 'Ձեր հաշվի տվյալները ստուգելու համար խնդրում ենք մուտք գործել։',
      faqLabel: 'Հաճախ տրվող հարցեր', telegram: 'Շարունակել մասնագետի հետ Telegram-ում',
      faqs: [
        { question: 'Ի՞նչ կարող եմ անել Hansora AI-ի միջոցով։', answer: 'Hansora AI-ն մեկ հարթակում միավորում է տարբեր AI գործիքներ։ Դուք կարող եք ստեղծել պատկերներ և տեսանյութեր, պատրաստել խոսող կամ lip sync տեսանյութեր, օգտագործել տարբեր AI մոդելներ, ստանալ օգնություն պրոմտերի հարցում և սովորել AI գործիքների կիրառումը Hansora-ի դասընթացների միջոցով։ Պարզապես ասեք՝ ինչ եք ցանկանում ստեղծել, և ես կօգնեմ ընտրել ճիշտ գործիքն ու մոդելը։' },
        { question: 'Ինչպե՞ս կարող եմ ստեղծել հայերեն խոսող տեսանյութ։', answer: 'Կարող եք օգտագործել Gemini Omni կամ Veo 3.1 մոդելները․ դրանք Hansora-ում հայերեն խոսող տեսանյութեր ստեղծելու լավագույն տարբերակներից են։ Եթե ցանկանում եք ավելի երկար խոսող տեսանյութ՝ առանց ավելորդ շարժումների, ընտրեք Lipsync Avatar գործիքը։ Պարզապես վերբեռնեք կերպարի կամ մոդելի նկարը և աուդիո ֆայլը։ Պրոմտ գրել պետք չէ։' },
        { question: 'Գաղափար ունեմ, բայց չգիտեմ՝ որ մոդելը կամ գործիքը ընտրեմ։ Կարո՞ղ եք օգնել։', answer: 'Այո։ Պարզապես ասեք՝ ինչ եք ցանկանում ստեղծել՝ գովազդ, ապրանքի տեսանյութ, խոսող կերպար, իրատեսական պատկեր, cinematic տեսարան կամ այլ բան։ Ես կառաջարկեմ Hansora-ի ամենահարմար մոդելը կամ գործիքը և կասեմ՝ ինչ է պետք վերբեռնել կամ գրել։' },
        { question: 'Ո՞րն է ամենամատչելի, բայց միաժամանակ ուժեղ վիդեո մոդելը։', answer: 'Grok Video-ն Hansora-ի ամենամատչելի և ամենաշատ օգտագործվող վիդեո մոդելներից մեկն է, բայց միաժամանակ շատ հզոր է։ Այն կարող է ստեղծել մոտավորապես 6-ից մինչև 30 վայրկյանանոց տեսանյութեր և լավ ընտրություն է, եթե ցանկանում եք ստանալ բարձր որակ՝ առանց շատ կրեդիտ ծախսելու։ Այն ապահովում է գնի, արագության և որակի լավ հավասարակշռություն։' },
        { question: 'Ինչպե՞ս կարող եմ գնել կրեդիտներ Hansora AI-ում։', answer: 'Hansora-ն աշխատում է կրեդիտային համակարգով։ «Գներ» բաժնում կարող եք ընտրել համապատասխան կրեդիտային փաթեթ և օգտագործել կրեդիտները ցանկացած ժամանակ Hansora-ի տարբեր գործիքների և մոդելների համար։ Տարբեր մոդելներ օգտագործում են տարբեր քանակի կրեդիտներ՝ կախված գեներացման տեսակից, տևողությունից և որակից։' }
      ]
    },
    ru: {
      launcher: 'Спросить Hansora AI', title: 'AI-ассистент Hansora', online: 'Готов помочь', close: 'Закрыть чат',
      welcome: 'Здравствуйте. Я помогу выбрать модель для изображения или видео, рассчитать кредиты или проверить Ваш аккаунт Hansora.',
      placeholder: 'Опишите, что Вы хотите создать…', send: 'Отправить сообщение', note: 'ИИ может ошибаться. Проверяйте важные данные о покупке.',
      error: 'Ассистент временно недоступен. Пожалуйста, попробуйте ещё раз.', login: 'Войдите в аккаунт, чтобы проверить персональные данные.',
      faqLabel: 'Частые вопросы', telegram: 'Продолжить с человеком в Telegram',
      faqs: [
        { question: 'Что я могу делать с помощью Hansora AI?', answer: 'Hansora AI объединяет разные AI-инструменты на одной платформе. Вы можете создавать изображения и видео, делать говорящие и lip sync видео, использовать разные AI-модели, получать помощь с промптами и обучаться работе с AI через курсы Hansora. Просто расскажите, что хотите создать, и я помогу выбрать подходящий инструмент и модель.' },
        { question: 'Как создать видео, где персонаж говорит на русском языке?', answer: 'Вы можете использовать Gemini Omni или Veo 3.1 — это одни из лучших моделей Hansora для генерации видео с русской речью. Если Вам нужно более длинное говорящее видео без лишних движений, выберите функцию Lipsync Avatar. Просто загрузите изображение персонажа или модели и аудиофайл. Промпт не требуется.' },
        { question: 'У меня есть идея, но я не знаю, какую модель или инструмент выбрать. Можете помочь?', answer: 'Да. Просто расскажите, что хотите создать: рекламу, видео продукта, говорящего персонажа, реалистичное изображение, cinematic-сцену или что-то другое. Я порекомендую наиболее подходящую модель или инструмент Hansora и объясню, что нужно загрузить или написать.' },
        { question: 'Какая видеомодель самая доступная, но при этом мощная?', answer: 'Grok Video — одна из самых доступных и самых популярных видеомоделей в Hansora, при этом она остается очень мощной. Она может создавать видео примерно от 6 до 30 секунд и подходит для качественного результата без большого расхода кредитов. Это хороший баланс цены, скорости и качества.' },
        { question: 'Как купить кредиты в Hansora AI?', answer: 'Hansora использует кредитную систему. В разделе «Цены» можно выбрать подходящий пакет кредитов и использовать их в любое время для разных инструментов и моделей Hansora. Разные модели расходуют разное количество кредитов в зависимости от типа генерации, длительности и качества.' }
      ]
    }
  }[language];

  let root;
  let launcher;
  let panel;
  let messages;
  let form;
  let input;
  let send;
  let sessionId = readSession();
  let initPromise = null;
  let loading = false;
  let suppressLauncherClick = false;

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
    root = document.createElement('div');
    root.id = 'hansora-sales-agent';
    root.innerHTML = '<button class="hsa-launcher" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="' + escapeAttribute(copy.launcher) + '">' +
      '<span class="hsa-launcher-label">' + escapeAttribute(copy.launcher) + '</span>' +
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l1.4 5.1L18 9l-4.6 1.9L12 16l-1.4-5.1L6 9l4.6-1.9L12 2Z" fill="currentColor"/><path d="M18.5 15l.8 2.7L22 18.5l-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7ZM5 13l.7 2.3L8 16l-2.3.7L5 19l-.7-2.3L2 16l2.3-.7L5 13Z" fill="currentColor"/></svg></button>' +
      '<section class="hsa-panel" role="dialog" aria-modal="false" aria-label="' + escapeAttribute(copy.title) + '" data-open="false">' +
      '<header class="hsa-head"><div class="hsa-avatar" aria-hidden="true">✦</div><div class="hsa-title"><strong>' + escapeAttribute(copy.title) + '</strong><span><i class="hsa-status-dot"></i>' + escapeAttribute(copy.online) + '</span></div><button class="hsa-close" type="button" aria-label="' + escapeAttribute(copy.close) + '">×</button></header>' +
      '<div class="hsa-messages" aria-live="polite"></div><footer class="hsa-foot"><div class="hsa-quick"><button class="hsa-faq-toggle" type="button" aria-expanded="false">' + escapeAttribute(copy.faqLabel) + '<span aria-hidden="true">⌄</span></button><div class="hsa-suggestions" hidden></div></div><form class="hsa-form"><textarea class="hsa-input" rows="1" maxlength="4000" placeholder="' + escapeAttribute(copy.placeholder) + '" aria-label="' + escapeAttribute(copy.placeholder) + '"></textarea><button class="hsa-send" type="submit" aria-label="' + escapeAttribute(copy.send) + '"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Zm3.7 7h7.9L6.9 6.9 7.7 11Zm-.8 6.1 8.7-4.1H7.7l-.8 4.1Z" fill="currentColor"/></svg></button></form><a class="hsa-telegram" href="https://t.me/Hansora_support" target="_self"><span aria-hidden="true">➤</span>' + escapeAttribute(copy.telegram) + '</a><p class="hsa-note">' + escapeAttribute(copy.note) + '</p></footer></section>';
    document.body.appendChild(root);
    launcher = root.querySelector('.hsa-launcher');
    panel = root.querySelector('.hsa-panel');
    messages = root.querySelector('.hsa-messages');
    form = root.querySelector('.hsa-form');
    input = root.querySelector('.hsa-input');
    send = root.querySelector('.hsa-send');
    const faqToggle = root.querySelector('.hsa-faq-toggle');
    const suggestions = root.querySelector('.hsa-suggestions');
    copy.faqs.forEach(function (faq) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hsa-suggestion';
      button.textContent = faq.question;
      button.addEventListener('click', function () {
        suggestions.hidden = true;
        faqToggle.setAttribute('aria-expanded', 'false');
        submitQuickAnswer(faq);
      });
      suggestions.appendChild(button);
    });
    faqToggle.addEventListener('click', function () {
      const opening = suggestions.hidden;
      suggestions.hidden = !opening;
      faqToggle.setAttribute('aria-expanded', String(opening));
    });
    restoreLauncherPosition();
    installLauncherDrag();
    launcher.addEventListener('click', function () {
      if (!suppressLauncherClick) open();
    });
    root.querySelector('.hsa-close').addEventListener('click', close);
    root.querySelector('.hsa-telegram').addEventListener('click', close);
    form.addEventListener('submit', function (event) { event.preventDefault(); submitMessage(input.value); });
    input.addEventListener('input', resizeInput);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
    });
    if (sessionStorage.getItem(OPEN_KEY) === '1') open();
  }

  function launcherBounds() {
    const minimum = matchMedia('(max-width:600px)').matches ? 76 : 12;
    return { minimum: minimum, maximum: Math.max(minimum, innerHeight - launcher.offsetHeight - 12) };
  }

  function setLauncherBottom(value, save) {
    const bounds = launcherBounds();
    const bottom = Math.max(bounds.minimum, Math.min(bounds.maximum, Number(value) || bounds.minimum));
    launcher.style.bottom = bottom + 'px';
    if (save) localStorage.setItem(POSITION_KEY, String(Math.round(bottom)));
  }

  function restoreLauncherPosition() {
    const saved = Number(localStorage.getItem(POSITION_KEY));
    if (Number.isFinite(saved) && saved > 0) setLauncherBottom(saved, false);
    addEventListener('resize', function () {
      if (launcher.style.bottom) setLauncherBottom(parseFloat(launcher.style.bottom), false);
    }, { passive: true });
  }

  function installLauncherDrag() {
    let drag = null;
    launcher.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      drag = {
        id: event.pointerId,
        startY: event.clientY,
        startBottom: parseFloat(getComputedStyle(launcher).bottom) || 20,
        moved: false
      };
      launcher.setPointerCapture(event.pointerId);
    });
    launcher.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      const delta = event.clientY - drag.startY;
      if (Math.abs(delta) > 5) drag.moved = true;
      if (drag.moved) {
        event.preventDefault();
        launcher.classList.add('hsa-dragging');
        setLauncherBottom(drag.startBottom - delta, false);
      }
    });
    function finishDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.moved) {
        suppressLauncherClick = true;
        setLauncherBottom(parseFloat(getComputedStyle(launcher).bottom), true);
        setTimeout(function () { suppressLauncherClick = false; }, 0);
      }
      launcher.classList.remove('hsa-dragging');
      drag = null;
    }
    launcher.addEventListener('pointerup', finishDrag);
    launcher.addEventListener('pointercancel', finishDrag);
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
    launcher.setAttribute('aria-expanded', 'true');
    sessionStorage.setItem(OPEN_KEY, '1');
    await initialize();
    input.focus();
    if (sessionId) recordEvent('chat_opened', { page: location.pathname }, 'open:' + sessionId).catch(function () {});
  }

  function close() {
    panel.dataset.open = 'false';
    launcher.setAttribute('aria-expanded', 'false');
    sessionStorage.removeItem(OPEN_KEY);
  }

  async function submitQuickAnswer(faq) {
    if (loading) return;
    loading = true;
    send.disabled = true;
    await initialize();
    addMessage('user', faq.question);
    const indicator = typing();
    await new Promise(function (resolve) { setTimeout(resolve, QUICK_REPLY_DELAY_MS); });
    indicator.remove();
    addMessage('agent', faq.answer);
    loading = false;
    send.disabled = false;
    input.focus();
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

  function handleAction(action) {
    if (action.type === 'open_login') {
      close();
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
      if (eventType) recordEvent(eventType, { model: action.model || null, package: action.package || null }, eventType + ':' + uid()).catch(function () {});
    }
    root.classList.add('hsa-navigating');
    close();
    location.assign(url);
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
