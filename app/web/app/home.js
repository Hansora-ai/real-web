// App home: credits and photo from the same account as the website, the create box, playing videos.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var kind = 'image', model = '';

  // ---- Create box: opens the models page with the prompt filled in (the page's own "preset" support).
  document.querySelectorAll('.ah-seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      kind = b.dataset.kind; model = '';
      document.querySelectorAll('.ah-seg button').forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      document.querySelectorAll('#ahChips button').forEach(function (x) { x.classList.remove('on'); });
    });
  });
  document.querySelectorAll('#ahChips button').forEach(function (b) {
    b.addEventListener('click', function () {
      model = b.dataset.model; kind = b.dataset.kind;
      document.querySelectorAll('#ahChips button').forEach(function (x) { x.classList.toggle('on', x === b); });
      document.querySelectorAll('.ah-seg button').forEach(function (x) { x.classList.toggle('on', x.dataset.kind === kind); });
    });
  });
  function target() {
    if (kind === 'audio') return '/audio.html';
    var q = new URLSearchParams();
    if (kind === 'video') q.set('type', 'video');
    if (model) q.set('model', model);
    var prompt = $('ahPrompt').value.trim();
    if (prompt) { try { sessionStorage.setItem('hansora:article-preset', JSON.stringify({ prompt: prompt })); q.set('articlePreset', '1'); } catch (_) {} }
    var s = q.toString();
    return '/search-models.html' + (s ? '?' + s : '');
  }
  $('ahCreate').addEventListener('submit', function (e) { e.preventDefault(); location.href = target(); });
  $('ahAttach').addEventListener('click', function (e) { e.preventDefault(); location.href = target(); });

  // ---- What's new: dots follow the swipe; only the visible video plays.
  var news = $('ahNews'), dots = [].slice.call(document.querySelectorAll('#ahDots i'));
  function play(v, on) {
    if (!v) return;
    if (on) { if (!v.src && v.dataset.src) v.src = v.dataset.src; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    else v.pause();
  }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { play(en.target, en.isIntersecting && en.intersectionRatio > 0.6); });
  }, { threshold: [0, 0.6] }) : null;
  document.querySelectorAll('.ah-news video, .ah-shots video').forEach(function (v) {
    if (io) io.observe(v); else { v.src = v.dataset.src; }
  });
  function syncDots() {
    var i = Math.round(news.scrollLeft / Math.max(1, news.firstElementChild.getBoundingClientRect().width + 10));
    dots.forEach(function (d, j) { d.classList.toggle('on', j === i); });
  }
  if (news && news.firstElementChild) { news.addEventListener('scroll', syncDots, { passive: true }); syncDots(); }

  // ---- Credits and photo (same account and tables as the website).
  function waitForClient(tries) {
    if (window.__HANSORA_SB__) return Promise.resolve(window.__HANSORA_SB__);
    if (tries <= 0) return Promise.resolve(null);
    return new Promise(function (r) { setTimeout(r, 100); }).then(function () { return waitForClient(tries - 1); });
  }
  waitForClient(80).then(async function (sb) {
    if (!sb) return;
    var session = (await sb.auth.getSession()).data.session;
    if (!session) return;
    var user = session.user, meta = user.user_metadata || {};
    $('ahLogin').hidden = true; $('ahCredits').hidden = false; $('ahAvatar').hidden = false;
    var photo = meta.avatar_url || meta.picture || '';
    if (/^https:\/\//.test(photo)) $('ahAvatar').style.backgroundImage = 'url("' + photo.replace(/"/g, '') + '")';
    else $('ahAvatar').textContent = (String(meta.full_name || meta.name || user.email || 'H').trim()[0] || 'H').toUpperCase();
    var profile = await sb.from('profiles').select('credits').eq('user_id', user.id).maybeSingle();
    if (profile.data) {
      var n = Number((Number(profile.data.credits || 0) * 10).toFixed(2)); // shown ×10 with ⚡, like the website
      $('ahCreditsValue').textContent = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2);
    }
  }).catch(function () {});
})();
