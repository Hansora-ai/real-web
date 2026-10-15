// Hansora models page: counts, sliding category highlight, live search, gentle fade-in, lazy Seedance video.
// Uses scroll + timer checks (never only IntersectionObserver); content stays visible if this script fails.
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sections = [...document.querySelectorAll('[data-category-section]')];
  const cards = () => [...document.querySelectorAll('.mx-card')];

  // Counts next to each section title
  sections.forEach(s => { const em = s.querySelector('[data-count]'); if (em) em.textContent = s.querySelectorAll('.mx-card').length; });

  // Sliding highlight behind the active category
  const tabs = document.querySelector('.mx-tabs');
  const pill = tabs && tabs.querySelector('.mx-pill');
  function movePill() {
    if (!pill) return;
    const active = tabs.querySelector('.btn-brand') || tabs.querySelector('.mx-tab');
    if (!active) return;
    pill.style.width = active.offsetWidth + 'px';
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
  }
  let filter = 'all';
  if (tabs) tabs.addEventListener('click', e => {
    const btn = e.target.closest('.mx-tab');
    if (!btn) return;
    filter = btn.dataset.filter;
    requestAnimationFrame(() => {
      movePill(); applySearch();
      const bar = document.querySelector('.mx-bar');
      if (bar && bar.getBoundingClientRect().top <= 90) {
        const first = sections.find(s => s.style.display !== 'none');
        if (first) first.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }
      reveal();
    });
  });
  movePill();
  window.addEventListener('resize', movePill);
  setTimeout(movePill, 500);

  // Live search
  const search = document.getElementById('mxSearch');
  const empty = document.getElementById('mxEmpty');
  function applySearch() {
    const q = (search && search.value || '').trim().toLowerCase();
    let shown = 0;
    sections.forEach(section => {
      const allowed = filter === 'all' || filter === section.dataset.categorySection;
      let hits = 0;
      section.querySelectorAll('.mx-card').forEach(card => {
        const match = !q || (card.dataset.name || '').includes(q);
        card.style.display = match ? '' : 'none';
        if (match) hits++;
      });
      const visible = allowed && hits > 0;
      section.style.display = visible ? '' : 'none';
      if (visible) shown += hits;
    });
    if (empty) empty.hidden = shown > 0;
  }
  if (search) search.addEventListener('input', () => {
    applySearch(); reveal();
    if (search.value.trim()) { const bar = document.querySelector('.mx-bar'); if (bar && bar.getBoundingClientRect().top > window.innerHeight * 0.6) bar.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  // Gentle fade-in while scrolling
  let pending = [];
  if (!reduce) {
    pending = cards().filter(c => c.getBoundingClientRect().top > window.innerHeight * 0.95);
    pending.forEach(c => c.classList.add('mx-pre'));
  }
  function reveal() {
    if (!pending.length) return;
    const limit = window.innerHeight * 0.95;
    let n = 0;
    pending = pending.filter(c => {
      const r = c.getBoundingClientRect();
      if (r.top < limit && (r.bottom > 0 || c.style.display === 'none')) {
        c.style.setProperty('--d', (n++ % 6) * 0.05 + 's');
        c.classList.add('mx-show'); c.classList.remove('mx-pre');
        setTimeout(() => c.classList.remove('mx-show'), 1200);
        return false;
      }
      return true;
    });
  }
  reveal();
  setTimeout(() => { pending.forEach(c => c.classList.remove('mx-pre')); pending = []; }, 12000);

  // Seedance video: loads after the page, plays only while visible
  const video = document.querySelector('.mx-media video');
  function checkVideo() {
    if (!video || reduce) return;
    const r = video.getBoundingClientRect();
    const visible = r.bottom > 0 && r.top < window.innerHeight;
    if (visible && !video.src) {
      video.src = video.dataset.mxSrc;
      video.addEventListener('playing', () => video.classList.add('mx-ready'), { once: true });
    }
    if (video.src) { if (visible) video.play().catch(() => {}); else video.pause(); }
  }
  const startVideo = () => setTimeout(checkVideo, 600);
  if (document.readyState === 'complete') startVideo(); else window.addEventListener('load', startVideo, { once: true });

  window.addEventListener('scroll', () => { reveal(); checkVideo(); }, { passive: true });
  window.addEventListener('resize', reveal);
  setInterval(() => { reveal(); checkVideo(); }, 1000);
})();
