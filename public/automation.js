// Hansora Automation landing page: scroll reveals, the live channel demo and small counters.
(function () {
  'use strict';
  const ui = window.HansoraUI;
  const reduce = ui?.reduceMotion;
  const $ = selector => document.querySelector(selector);

  // Keep preview mode when browsing the local preview.
  if (new URLSearchParams(location.search).get('preview') === '1') document.querySelectorAll('[data-start]').forEach(link => { link.href = 'automation-setup.html?preview=1'; });

  // Scroll reveal without relying on IntersectionObserver alone: scroll/resize checks plus a timer fallback.
  const pending = new Set(document.querySelectorAll('[data-reveal]'));
  const reveal = () => {
    const limit = window.innerHeight * 0.92;
    for (const element of pending) {
      if (element.getBoundingClientRect().top < limit) { element.classList.add('in'); pending.delete(element); onReveal(element); }
    }
  };
  let ticking = false;
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; reveal(); }); } }, { passive: true });
  window.addEventListener('resize', reveal);
  reveal(); setTimeout(reveal, 400);
  setTimeout(() => pending.forEach(element => { element.classList.add('in'); onReveal(element); }), 6000);

  function onReveal(element) {
    const counter = element.querySelector?.('[data-count]');
    if (counter && ui) { ui.countUp(counter, Number(counter.dataset.count), undefined, 1400); setTimeout(() => { const bar = element.querySelector('.lp-usage-bar'); if (bar) bar.style.width = '64%'; }, 100); }
  }

  // Phone card waveform.
  const wave = $('.lp-wave');
  if (wave) [6,10,16,24,14,30,44,26,52,38,60,34,48,28,42,22,32,18,26,14,20,10,14,8].forEach((height, index) => {
    const bar = document.createElement('i');
    bar.style.setProperty('--h', `${height}px`); bar.style.setProperty('--d', `${-index * 0.11}s`);
    wave.appendChild(bar);
  });

  // Live demo: cycles through channels with a typing indicator and a notification toast.
  const scenes = [
    { channel:'Instagram', icon:'instagram', tone:'ig', lines:[['c','Hi! Can I book a consultation for Friday?'],['a','Of course! Friday has 11:30 and 15:00 free. Which suits you?'],['c','11:30 please'],['a','Booked — Friday at 11:30. Your reference is #1042. See you then!']], toast:['New booking #1042','Friday, 11:30 · Ani'] },
    { channel:'WhatsApp', icon:'whatsapp', tone:'wa', lines:[['c','Hi, do you have the white cabinet in 120 cm?'],['a','Yes, we do! Where should we deliver it?'],['c','12 Main Street'],['a','Order #1043 is placed. The team will confirm the price shortly.']], toast:['New order #1043','White cabinet 120 cm · 12 Main St'] },
    { channel:'Phone call', icon:'phone', tone:'ph', lines:[['a','Hello, you’ve reached Luma Studio. How can I help?'],['c','I have a problem with my delivery.'],['a','I’m sorry about that. I’m connecting you with our team right now.']], toast:['Customer needs you','Delivery problem · call'] }
  ];
  const thread = $('#demo-thread');
  const toast = $('#demo-toast');
  if (!thread || !ui) return;
  let scene = 0;
  const wait = ms => new Promise(resolve => setTimeout(resolve, reduce ? Math.min(ms, 200) : ms));
  async function play() {
    for (;;) {
      const data = scenes[scene];
      $('#demo-channel').textContent = data.channel;
      const icon = $('#demo-channel-icon'); icon.className = `lp-demo-channel ${data.tone}`; icon.innerHTML = ui.icon(data.icon);
      thread.innerHTML = ''; toast.classList.remove('show');
      for (const [who, text] of data.lines) {
        if (who === 'a') { const dots = ui.typing(); dots.classList.add('lp-typing'); thread.appendChild(dots); await wait(900); dots.remove(); }
        else await wait(700);
        const bubble = document.createElement('p'); bubble.className = who; bubble.textContent = text; thread.appendChild(bubble);
        thread.scrollTop = thread.scrollHeight;
        await wait(500);
      }
      $('#demo-toast-title').textContent = data.toast[0]; $('#demo-toast-text').textContent = data.toast[1];
      toast.classList.add('show');
      await wait(3200);
      scene = (scene + 1) % scenes.length;
    }
  }
  play();
})();
