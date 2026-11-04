// Hansora Automation landing page: word-by-word title, the live phone demo (three businesses), scroll reveals,
// build-up cards, comment → DM, counters, magnetic buttons and the cursor spotlight.
(function () {
  'use strict';
  const ui = window.HansoraUI;
  const reduce = Boolean(ui?.reduceMotion);
  const $ = selector => document.querySelector(selector);
  const wait = ms => new Promise(resolve => setTimeout(resolve, reduce ? Math.min(ms, 120) : ms));

  // Keep preview mode when browsing the local preview.
  if (new URLSearchParams(location.search).get('preview') === '1') document.querySelectorAll('[data-start]').forEach(link => { link.href = 'automation-setup.html?preview=1'; });

  // Title: words rise in one after another.
  const title = $('[data-words]');
  if (title) {
    let index = 0;
    const wrap = node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const parts = node.textContent.split(/(\s+)/);
        const fragment = document.createDocumentFragment();
        parts.forEach(part => {
          if (!part.trim()) { fragment.appendChild(document.createTextNode(part)); return; }
          const word = document.createElement('span'); word.className = 'lx-word'; word.style.setProperty('--i', index++); word.textContent = part;
          fragment.appendChild(word);
        });
        node.replaceWith(fragment);
      } else [...node.childNodes].forEach(wrap);
    };
    [...title.childNodes].forEach(wrap);
    requestAnimationFrame(() => title.classList.add('in'));
  }

  // Scroll reveal without relying on IntersectionObserver alone: scroll/resize checks plus a timer fallback.
  const pending = new Set(document.querySelectorAll('[data-reveal]'));
  const reveal = () => {
    const limit = window.innerHeight * 0.88;
    for (const element of pending) {
      if (element.getBoundingClientRect().top < limit) { element.classList.add('in'); pending.delete(element); onReveal(element); }
    }
  };
  let ticking = false;
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; reveal(); }); } }, { passive: true });
  window.addEventListener('resize', reveal);
  reveal(); setTimeout(reveal, 400);
  setTimeout(() => pending.forEach(element => { element.classList.add('in'); onReveal(element); }), 8000);

  function onReveal(element) {
    element.querySelectorAll?.('[data-count-to]').forEach(counter => ui ? ui.countUp(counter, Number(counter.dataset.countTo), undefined, 1200) : (counter.textContent = counter.dataset.countTo));
    if (element.dataset.play === 'creative') playCreative(element);
    else if (element.dataset.play === 'comments') loopScene(element, 10000);
    else if (element.dataset.play) setTimeout(() => element.classList.add('play'), 250);
    if (element.querySelector?.('[data-live-count]')) liveCount(element.querySelector('[data-live-count]'));
  }

  // Comment → DM keeps playing (the first comment stays put, so nothing appears twice).
  async function loopScene(element, every) {
    for (;;) {
      element.classList.remove('play'); void element.offsetWidth; element.classList.add('play');
      await wait(every);
      if (reduce) return;
    }
  }

  // Hansora Creative: a prompt is typed, the tiles "generate", then the next prompt.
  async function playCreative(section) {
    const text = section.querySelector('#lx-gen-text');
    const prompts = ['Girl with silver wings flying over the mountains', 'Robot warrior in a misty forest, cinematic', 'Chocolate bar ad, bright and playful', 'Sunset sky lettering, GPT Image'];
    // Real Hansora Creative results, loaded only now that the section is on screen.
    const media = [...section.querySelectorAll('[data-src]')];
    media.forEach(item => { item.src = item.dataset.src; });
    const videos = media.filter(item => item.tagName === 'VIDEO');
    let onScreen = true;
    const checkScreen = () => {
      const box = section.getBoundingClientRect(); const visible = box.bottom > 0 && box.top < innerHeight;
      if (visible === onScreen) return; onScreen = visible;
      videos.forEach(video => { if (!visible) video.pause(); else if (section.classList.contains('done')) video.play?.().catch(() => {}); });
    };
    let queued = false;
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; checkScreen(); }); } }, { passive: true });
    setInterval(checkScreen, 1500);
    for (let round = 0; ; round++) {
      section.classList.remove('done'); section.classList.add('gen'); section.dataset.palette = String(round % 4);
      const prompt = prompts[round % prompts.length];
      for (let i = 1; i <= prompt.length; i++) { text.textContent = prompt.slice(0, i); await wait(28); }
      await wait(1800);
      section.classList.remove('gen'); section.classList.add('done');
      if (onScreen) videos.forEach(video => { try { video.currentTime = 0; } catch (_) {} video.play?.().catch(() => {}); });
      await wait(5200);
      if (reduce) return;
    }
  }

  // "Customers writing right now": a gently changing number.
  function liveCount(element) {
    if (reduce) return;
    let value = 12;
    setInterval(() => { value = Math.max(8, Math.min(24, value + (Math.random() < .55 ? 1 : -1))); element.textContent = value; }, 2600);
  }

  // Cursor spotlight on the hero and magnetic main buttons (pointer devices only).
  const fine = window.matchMedia('(pointer:fine)').matches;
  const hero = $('.lx-hero');
  if (fine && hero && !reduce) {
    const spot = hero.querySelector('.lx-spot');
    hero.addEventListener('pointermove', event => { const box = (spot || hero).getBoundingClientRect(); hero.style.setProperty('--mx', `${event.clientX - box.left}px`); hero.style.setProperty('--my', `${event.clientY - box.top}px`); });
    document.querySelectorAll('[data-magnetic]').forEach(button => {
      button.addEventListener('pointermove', event => { const box = button.getBoundingClientRect(); button.style.transform = `translate(${(event.clientX - box.left - box.width / 2) * 0.18}px, ${(event.clientY - box.top - box.height / 2) * 0.28}px)`; });
      button.addEventListener('pointerleave', () => { button.style.transform = ''; });
    });
  }

  // Live phone demo: three businesses, each a short story that ends with a real result.
  const scenes = [
    {
      business: 'Oak & Co. Furniture', logo: 'O', tone: 'oak', channel: 'Instagram', icon: 'instagram',
      steps: [
        ['c', 'Hi! Do you have the oak coffee table in stock?'],
        ['a', 'Yes! The oak coffee table is $320 and in stock. Delivery tomorrow 🌳'],
        ['card', { title: 'Oak coffee table', price: '$320', tone: 'oak', photo: 'automation-media/oak-coffee-table.jpg' }],
        ['c', 'Perfect, deliver to 12 Main Street please'],
        ['a', 'Done! Order #1043 is confirmed ✅ We’ll message you before delivery.']
      ],
      result: ['✓', 'Order #1043 created', 'Oak coffee table · $320'], alert: 'Order alert sent to the owner'
    },
    {
      business: 'Glow Beauty Salon', logo: 'G', tone: 'glow', channel: 'WhatsApp', icon: 'whatsapp',
      steps: [
        ['voice', 'Can I get a manicure on Saturday afternoon?'],
        ['a', 'Of course 💅 Saturday we have 14:00 and 16:30 free. Which one suits you?'],
        ['c', '16:30 please'],
        ['a', 'Booked ✓ Saturday 16:30 with Anna. See you then!']
      ],
      result: ['📅', 'Booking #2087', 'Sat 16:30 · Manicure · Anna'], alert: 'Booking added to your calendar'
    },
    {
      business: 'Bella Pasta', logo: 'B', tone: 'bella', channel: 'TikTok', icon: 'tiktok',
      steps: [
        ['note', 'Commented “menu?? 😍” under your video'],
        ['a', 'Hi! Here is our menu 🍝 Our truffle tagliatelle is today’s favourite.'],
        ['card', { title: 'Tonight’s menu', price: '12 dishes', tone: 'bella' }],
        ['c', 'Table for 4 tonight at 8pm?'],
        ['a', 'Reserved ✓ A table for 4 at 20:00. Can’t wait to see you!']
      ],
      result: ['🍽️', 'Table reserved', 'Tonight 20:00 · 4 people'], alert: 'Reservation sent to the owner'
    },
    {
      business: 'Smile Dental Clinic', logo: 'S', tone: 'smile', channel: 'Phone call', icon: 'phone',
      steps: [
        ['call', 'Incoming call · +1 555 0142'],
        ['say-a', 'Hello, Smile Dental Clinic! How can I help you today?'],
        ['say-c', 'Hi, I’d like a teeth cleaning this week.'],
        ['say-a', 'Of course. Thursday at 10:00 or Friday at 15:30?'],
        ['say-c', 'Thursday at ten works.'],
        ['say-a', 'You’re booked for Thursday at 10:00. We’ll text you a reminder!']
      ],
      result: ['📅', 'Appointment booked', 'Thu 10:00 · Teeth cleaning · $90'], alert: 'Call summary sent to the owner'
    }
  ];
  const thread = $('#lx-thread');
  const composer = $('#lx-composer-text');
  const result = $('#lx-result'); const alertCard = $('#lx-alert');
  const tabs = [...document.querySelectorAll('[data-scene]')];
  if (!thread || !ui) return;
  let current = 0; let run = 0;

  tabs.forEach(tab => tab.addEventListener('click', () => { current = Number(tab.dataset.scene); play(); }));

  const scrollThread = () => { thread.scrollTop = thread.scrollHeight; };
  const add = (className, html) => { const element = document.createElement('div'); element.className = `lx-msg ${className}`; element.innerHTML = html; thread.appendChild(element); requestAnimationFrame(() => element.classList.add('in')); scrollThread(); return element; };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

  async function typeIntoComposer(text, token) {
    composer.classList.add('typing');
    for (let i = 1; i <= text.length; i++) { if (token !== run) return false; composer.textContent = text.slice(0, i); await wait(reduce ? 0 : 26 + Math.random() * 30); }
    await wait(250); composer.classList.remove('typing'); composer.textContent = 'Message…';
    return token === run;
  }

  // Phone-call card: caller, live timer and a voice wave while the AI talks.
  let callTimer = null;
  function startCall(text, token) {
    const card = add('call-card', `<span class="lx-call-ring">📞</span><div><b>${escapeHtml(text)}</b><small>AI employee answered · <i class="lx-call-time">0:00</i></small></div><span class="lx-wave">${'<i></i>'.repeat(14)}</span>`);
    const clock = card.querySelector('.lx-call-time'); let seconds = 0;
    clearInterval(callTimer);
    callTimer = setInterval(() => { if (token !== run || !card.isConnected) return clearInterval(callTimer); seconds++; clock.textContent = `0:${String(seconds).padStart(2, '0')}`; }, 1000);
  }

  async function play() {
    const token = ++run;
    const scene = scenes[current];
    tabs.forEach(tab => tab.classList.toggle('active', Number(tab.dataset.scene) === current));
    $('#lx-biz-name').textContent = scene.business;
    const logo = $('#lx-biz-logo'); logo.textContent = scene.logo; logo.className = `lx-biz ${scene.tone}`;
    $('#lx-channel').textContent = scene.channel; $('#lx-channel-icon').innerHTML = ui.icon(scene.icon);
    clearInterval(callTimer); composer.parentElement.classList.toggle('calling', scene.channel === 'Phone call');
    thread.innerHTML = ''; result.classList.remove('show'); alertCard.classList.remove('show'); composer.textContent = 'Message…';
    await wait(500);
    for (const [kind, value] of scene.steps) {
      if (token !== run) return;
      if (kind === 'c') { if (!await typeIntoComposer(value, token)) return; add('c', escapeHtml(value)); await wait(500); }
      else if (kind === 'voice') { add('c voice', `<span class="lx-wave">${'<i></i>'.repeat(18)}</span><small>0:06</small>`); await wait(900); add('transcript', `🎤 “${escapeHtml(value)}”`); await wait(600); }
      else if (kind === 'note') { add('note', escapeHtml(value)); await wait(800); }
      else if (kind === 'call') { startCall(value, token); await wait(1400); }
      else if (kind === 'say-a' || kind === 'say-c') {
        const who = kind === 'say-a' ? 'a' : 'c';
        const line = add(`${who} spoken`, `<span class="lx-speaker">${who === 'a' ? '🤖 AI' : '👤 Caller'}</span><span class="lx-said"></span>`);
        const target = line.querySelector('.lx-said');
        for (let i = 1; i <= value.length; i++) { if (token !== run) return; target.textContent = value.slice(0, i); if (i % 3 === 0) scrollThread(); await wait(reduce ? 0 : 22); }
        await wait(600);
      }
      else if (kind === 'card') { add('a card', `<span class="lx-card-img ${value.tone}"${value.photo ? ` style="background-image:url(${value.photo})"` : ''}></span><b>${escapeHtml(value.title)}</b><small>${escapeHtml(value.price)}</small><span class="lx-card-btn">View</span>`); await wait(900); }
      else { const dots = add('a dots', '<i></i><i></i><i></i>'); await wait(1000); if (token !== run) return; dots.remove(); add('a', escapeHtml(value)); await wait(700); }
    }
    if (token !== run) return;
    $('#lx-result-icon').textContent = scene.result[0]; $('#lx-result-title').textContent = scene.result[1]; $('#lx-result-text').textContent = scene.result[2];
    result.classList.add('show'); await wait(700); $('#lx-alert-text').textContent = scene.alert; alertCard.classList.add('show');
    await wait(3600);
    if (token !== run) return;
    current = (current + 1) % scenes.length;
    play();
  }
  play();
})();
