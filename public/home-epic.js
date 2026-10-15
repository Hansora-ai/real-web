// Hansora Creative homepage: hero prompt that types itself, real clips in the moving wall (loaded after the
// page is ready), and sections that slide in while scrolling. No links or existing page logic are touched.
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(resolve => setTimeout(resolve, reduce ? Math.min(ms, 150) : ms));

  // 1. Prompt box: types a prompt, "presses" Generate, switches model, next prompt.
  const typed = document.getElementById('he-typed');
  const model = document.getElementById('he-model');
  const prompt = typed && typed.closest('.he-prompt');
  const prompts = [
    ['Girl with silver wings flying over the mountains', 'Seedance 2.5'],
    ['Chocolate bar ad, bright and playful, 9:16', 'Veo 3.1'],
    ['Product photo of a perfume on wet black stone', 'GPT Image 2.5'],
    ['Robot warrior in a misty forest, cinematic', 'Kling 3.0'],
    ['Upbeat summer pop song about the beach', 'Suno Music'],
    ['My kid as a cartoon hero flying over the hills', 'Nano Banana 2']
  ];
  async function typeLoop() {
    if (!typed) return;
    for (let round = 0; ; round++) {
      const [text, name] = prompts[round % prompts.length];
      if (model) model.textContent = name;
      for (let i = 1; i <= text.length; i++) { typed.textContent = text.slice(0, i); await wait(32); }
      await wait(700);
      prompt.classList.add('pressed'); await wait(220); prompt.classList.remove('pressed');
      prompt.classList.add('generating'); await wait(1600); prompt.classList.remove('generating');
      await wait(900);
      for (let i = text.length; i >= 0; i -= 2) { typed.textContent = text.slice(0, i); await wait(12); }
      if (reduce) { typed.textContent = prompts[0][0]; return; }
    }
  }
  setTimeout(typeLoop, 1100);

  // 2. Real generated clips in the wall: start after the page has loaded, so they never slow the first screen.
  const wallVideos = [...document.querySelectorAll('.he-wall video[data-he-src]')];
  const hero = document.querySelector('.he-hero');
  function startWall() {
    if (reduce || !wallVideos.length) return;
    const phone = window.matchMedia('(max-width: 760px)').matches;
    wallVideos.forEach((video, index) => {
      if (phone && index > 3) return; // fewer clips on phones
      setTimeout(() => {
        video.src = video.dataset.heSrc;
        video.addEventListener('playing', () => video.classList.add('he-ready'), { once: true });
        video.play().catch(() => {});
      }, 400 + index * 350);
    });
  }
  if (document.readyState === 'complete') setTimeout(startWall, 800);
  else window.addEventListener('load', () => setTimeout(startWall, 800), { once: true });

  // Pause the wall clips while the hero is off screen (saves battery and data).
  let heroVisible = true;
  function checkHero() {
    if (!hero) return;
    const box = hero.getBoundingClientRect();
    const visible = box.bottom > 0 && box.top < window.innerHeight;
    if (visible === heroVisible) return;
    heroVisible = visible;
    wallVideos.forEach(video => { if (!video.src) return; if (visible) video.play().catch(() => {}); else video.pause(); });
  }

  // 3. Sections slide in while scrolling (scroll + timer checks; content is never hidden if this script fails).
  const sections = [...document.querySelectorAll('main > section:not(.he-hero), main .section')].filter((el, i, all) => all.indexOf(el) === i && !el.closest('.he-hero'));
  const pending = new Set();
  if (!reduce) sections.forEach(section => {
    if (section.getBoundingClientRect().top > window.innerHeight * 0.95) { section.classList.add('he-reveal'); pending.add(section); }
  });
  function reveal() {
    const limit = window.innerHeight * 0.9;
    pending.forEach(section => { if (section.getBoundingClientRect().top < limit) { section.classList.add('he-in'); pending.delete(section); } });
  }
  let queued = false;
  window.addEventListener('scroll', () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; reveal(); checkHero(); }); }, { passive: true });
  window.addEventListener('resize', reveal);
  setInterval(() => { reveal(); checkHero(); }, 1200);
  setTimeout(() => pending.forEach(section => section.classList.add('he-in')), 12000);

  // 4. "From a prompt to a finished ad": the demo screen walks through the 4 steps while it is on screen.
  const studio = document.querySelector('.he-studio');
  const screen = studio && studio.querySelector('.he-screen');
  if (studio && screen) {
    const steps = [...studio.querySelectorAll('.he-step')];
    const body = screen.querySelector('.he-screen-body');
    const typedEl = screen.querySelector('.he-scr-typed');
    const chip = screen.querySelector('.he-scr-chip em');
    const video = screen.querySelector('.he-scr-vid');
    const fullText = typedEl ? typedEl.textContent : '';
    const chips = ['', 'GPT Image 2.5 · 4K', 'Seedance 2.5 · 1080p', 'Music + captions'];
    const times = [3600, 3200, 3600, 4600];
    let step = -1, timer = 0, typing = 0, running = false;
    const loadVideo = () => {
      if (!video || video.src) return;
      video.src = video.dataset.heSrc;
      video.addEventListener('playing', () => video.classList.add('he-ready'), { once: true });
    };
    function show(next) {
      step = next;
      clearTimeout(timer); clearInterval(typing);
      screen.dataset.step = String(step);
      if (body) screen.style.setProperty('--he-scr-w', body.offsetWidth + 'px');
      steps.forEach((li, i) => {
        li.classList.toggle('is-done', i < step);
        li.classList.remove('is-on'); void li.offsetWidth; // restart the progress bar
        if (i === step) { li.classList.add('is-on'); li.style.setProperty('--he-step-ms', times[i] + 'ms'); }
      });
      if (chip && chips[step]) chip.textContent = chips[step];
      if (step === 0 && typedEl) {
        let i = 0; typedEl.textContent = '';
        typing = setInterval(() => { i++; typedEl.textContent = fullText.slice(0, i); if (i >= fullText.length) clearInterval(typing); }, 55);
      } else if (typedEl) typedEl.textContent = fullText;
      if (step === 1) loadVideo();
      if (video && video.src) { if (step >= 2) video.play().catch(() => {}); else { video.pause(); video.currentTime = 0; } }
      if (running) timer = setTimeout(() => show((step + 1) % steps.length), times[step]);
    }
    steps.forEach((li, i) => li.querySelector('button').addEventListener('click', () => { running = true; show(i); }));
    if (reduce) { screen.dataset.step = '3'; steps.forEach(li => li.classList.add('is-done')); }
    else {
      const checkStudio = () => {
        const box = studio.getBoundingClientRect();
        const visible = box.top < window.innerHeight * 0.8 && box.bottom > window.innerHeight * 0.2;
        if (visible && !running) { running = true; show(step < 0 ? 0 : step); }
        else if (!visible && running) { running = false; clearTimeout(timer); if (video) video.pause(); }
      };
      window.addEventListener('scroll', checkStudio, { passive: true });
      setInterval(checkStudio, 1000);
      checkStudio();
    }
  }
})();
