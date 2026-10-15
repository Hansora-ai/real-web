// Hansora models page: drifting wall of model images, count-up numbers, live search, sliding category highlight,
// 3D tilt cards, cards that slide in while scrolling and a lazy Seedance spotlight video.
// Uses scroll + timer checks (never only IntersectionObserver); content stays visible if this script fails.
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const cards = () => [...document.querySelectorAll('.me-card')];
  const sections = [...document.querySelectorAll('[data-category-section]')];
  const countOf = type => document.querySelectorAll(`#${type === 'features' ? 'features' : type}Grid .me-card`).length;

  // 1. Hero wall built from the model images already on the page
  const wall = document.getElementById('meWall');
  if (wall) {
    const imgs = [...new Set(cards().map(c => c.querySelector('img') && c.querySelector('img').getAttribute('src')).filter(Boolean))];
    const cols = 5, per = Math.max(4, Math.ceil(imgs.length / cols));
    for (let c = 0; c < cols; c++) {
      const list = [];
      for (let k = 0; k < per; k++) list.push(imgs[(c * per + k * 3 + c) % imgs.length]);
      const html = list.map(src => `<img src="${src}" alt="" loading="lazy" decoding="async">`).join('');
      wall.insertAdjacentHTML('beforeend', `<div class="me-col"><div class="me-col-track">${html}${html}</div></div>`);
    }
  }

  // 2. Counters
  const counts = { image: countOf('image'), video: countOf('video'), features: countOf('features'), audio: countOf('audio') };
  counts.all = counts.image + counts.video + counts.features + counts.audio;
  document.querySelectorAll('[data-tab-count]').forEach(el => { el.textContent = counts[el.dataset.tabCount] || ''; });
  document.querySelectorAll('[data-count]').forEach((el, i) => {
    const target = counts[el.dataset.count] || 0;
    if (reduce) { el.textContent = target; return; }
    const start = performance.now() + 700 + i * 120, dur = 1100;
    const tick = now => {
      const t = Math.min(1, Math.max(0, (now - start) / dur));
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => { el.textContent = target; }, 3000); // in case animation frames are paused
  });

  // 3. Sliding highlight behind the active category
  const tabs = document.querySelector('.me-tabs');
  const glow = tabs && tabs.querySelector('.me-tab-glow');
  function moveGlow() {
    if (!glow) return;
    const active = tabs.querySelector('.btn-brand') || tabs.querySelector('.me-tab');
    if (!active) return;
    glow.style.width = active.offsetWidth + 'px';
    glow.style.transform = `translateX(${active.offsetLeft}px)`;
  }
  let filter = 'all';
  if (tabs) tabs.addEventListener('click', e => {
    const btn = e.target.closest('.me-tab');
    if (!btn) return;
    filter = btn.dataset.filter;
    requestAnimationFrame(() => {
      moveGlow(); applySearch();
      const bar = document.querySelector('.me-tabs-wrap');
      if (bar && bar.getBoundingClientRect().top <= 80) {
        const first = sections.find(s => s.style.display !== 'none');
        if (first) first.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }
      replay();
    });
  });
  moveGlow();
  window.addEventListener('resize', moveGlow);
  setTimeout(moveGlow, 600);

  // 4. Live search
  const search = document.getElementById('meSearch');
  const empty = document.getElementById('meEmpty');
  const spot = document.querySelector('.me-spot');
  function applySearch() {
    const q = (search && search.value || '').trim().toLowerCase();
    let shown = 0;
    sections.forEach(section => {
      const cat = section.dataset.categorySection;
      const allowed = filter === 'all' || filter === cat;
      let hits = 0;
      section.querySelectorAll('.me-card').forEach(card => {
        const match = !q || (card.dataset.name || '').includes(q);
        card.style.display = match ? '' : 'none';
        if (match) hits++;
      });
      const visible = allowed && hits > 0;
      section.style.display = visible ? '' : 'none';
      if (visible) shown += hits;
    });
    if (spot) spot.style.display = q && !'seedance 2.5'.includes(q) ? 'none' : '';
    if (empty) empty.hidden = shown > 0;
  }
  if (search) {
    search.addEventListener('input', () => { applySearch(); replay(); });
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = cards().find(c => c.offsetParent); if (first) { e.preventDefault(); first.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
    });
    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement !== search && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); search.focus(); }
    });
  }

  // 5. Cards slide in while scrolling
  let pending = [];
  function prepare() {
    if (reduce) return;
    pending = cards().filter(c => !c.classList.contains('me-show') && c.getBoundingClientRect().top > window.innerHeight * 0.92);
    pending.forEach(c => c.classList.add('me-pre'));
  }
  function reveal() {
    if (!pending.length) return;
    const limit = window.innerHeight * 0.94;
    let n = 0;
    pending = pending.filter(c => {
      const r = c.getBoundingClientRect();
      if (r.top < limit && r.bottom > 0) { c.style.setProperty('--d', (n++ % 8) * 0.06 + 's'); c.classList.add('me-show'); c.classList.remove('me-pre'); setTimeout(() => c.classList.remove('me-show'), 1500); return false; }
      return true;
    });
  }
  function replay() { reveal(); }
  prepare(); reveal();
  setTimeout(() => { pending.forEach(c => { c.classList.add('me-show'); c.classList.remove('me-pre'); }); pending = []; }, 14000);

  // 6. 3D tilt toward the mouse
  if (finePointer && !reduce) {
    document.addEventListener('pointermove', e => {
      const card = e.target.closest && e.target.closest('.me-card');
      document.querySelectorAll('.me-card.is-tilting').forEach(c => { if (c !== card) { c.classList.remove('is-tilting'); c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); } });
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.classList.add('is-tilting');
      card.style.setProperty('--mx', x * 100 + '%');
      card.style.setProperty('--my', y * 100 + '%');
      card.style.setProperty('--ry', (x - .5) * 10 + 'deg');
      card.style.setProperty('--rx', (.5 - y) * 10 + 'deg');
    }, { passive: true });
  }

  // 7. Seedance spotlight video: loads only when near the screen, pauses when away
  const spotVideo = document.querySelector('.me-spot-media video');
  const hero = document.querySelector('.me-hero');
  function checkMedia() {
    const h = window.innerHeight;
    if (spotVideo) {
      const r = spotVideo.getBoundingClientRect();
      const near = r.top < h * 1.3 && r.bottom > -h * 0.3 && spotVideo.closest('.me-spot').style.display !== 'none';
      if (near && !spotVideo.src && !reduce) {
        spotVideo.src = spotVideo.dataset.meSrc;
        spotVideo.addEventListener('playing', () => spotVideo.classList.add('me-ready'), { once: true });
      }
      if (spotVideo.src) { if (near) spotVideo.play().catch(() => {}); else spotVideo.pause(); }
    }
    if (hero) { const r = hero.getBoundingClientRect(); hero.classList.toggle('me-paused', r.bottom < 0 || r.top > h); }
  }
  let queued = false;
  window.addEventListener('scroll', () => {
    reveal(); checkMedia();
    if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; });
  }, { passive: true });
  window.addEventListener('resize', () => { reveal(); checkMedia(); });
  setInterval(() => { reveal(); checkMedia(); }, 1000);
  checkMedia();
})();
