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
})();
