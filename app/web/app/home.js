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
  document.querySelectorAll('.ah-news video, .sc-grid video').forEach(function (v) {
    if (io) io.observe(v); else { v.src = v.dataset.src; }
  });
  function syncDots() {
    var i = Math.round(news.scrollLeft / Math.max(1, news.firstElementChild.getBoundingClientRect().width + 10));
    dots.forEach(function (d, j) { d.classList.toggle('on', j === i); });
  }
  if (news && news.firstElementChild) { news.addEventListener('scroll', syncDots, { passive: true }); syncDots(); }

  // ---- Trending now (the website's Trend videos) and Motion templates (Henshin): loaded live, so new ones appear
  // in the app as soon as they are published on the website.
  var SB = 'https://qmaealblegvcwodlmeht.supabase.co';
  var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
  var safe = function (u) { try { var x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch (_) { return ''; } };
  var isId = function (id) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || ''); };
  var reelIO = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var v = en.target.querySelector('video'); if (!v) return;
      if (en.isIntersecting && en.intersectionRatio > 0.7) {
        if (!v.src) v.src = v.dataset.src;
        var p = v.play(); if (p && p.then) p.then(function () { v.classList.add('on'); }).catch(function () {});
      } else v.pause();
    });
  }, { threshold: [0, 0.7] }) : null;
  function reel(item) {
    var a = document.createElement('a');
    a.className = 'ah-reel'; a.href = item.href; a.setAttribute('aria-label', item.label);
    if (item.poster) { var img = document.createElement('img'); img.src = item.poster; img.alt = ''; img.loading = 'lazy'; a.appendChild(img); }
    if (item.video) { var v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'none'; v.dataset.src = item.video; a.appendChild(v); }
    a.insertAdjacentHTML('beforeend', '<span class="ah-reel-tag">' + item.tag + '</span><span class="ah-reel-go">' + item.go + '</span>');
    if (reelIO) reelIO.observe(a);
    return a;
  }
  function fill(sectionId, listId, items) {
    var sec = $(sectionId), list = $(listId);
    if (!sec || !list || !items.length) return;
    list.innerHTML = ''; items.forEach(function (it) { list.appendChild(reel(it)); });
    sec.hidden = false;
  }
  function skeleton(sectionId, listId) { var list = $(listId); if (!list) return; list.innerHTML = new Array(4).join('<span class="ah-reel skeleton"></span>'); $(sectionId).hidden = false; }
  skeleton('ahTrendSec', 'ahTrends'); skeleton('ahTmplSec', 'ahTemplates');
  var hide = function (id) { var el = $(id); if (el) el.hidden = true; };

  fetch(SB + '/rest/v1/tutorials?select=id,title,cover_url,cover_poster_url&published=eq.true&order=created_at.desc&limit=10', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
    .then(function (r) { if (!r.ok) throw Error('trends'); return r.json(); })
    .then(function (rows) {
      var items = (rows || []).filter(function (r) { return isId(r.id) && safe(r.cover_url); }).map(function (r) {
        var isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(r.cover_url);
        return { href: '/tutorial.html?id=' + encodeURIComponent(r.id), label: 'Recreate this trend', tag: '🔥 Trend', go: 'Recreate',
          poster: safe(r.cover_poster_url) || (isVideo ? '' : safe(r.cover_url)), video: isVideo ? safe(r.cover_url) : '' };
      });
      if (items.length) fill('ahTrendSec', 'ahTrends', items); else hide('ahTrendSec');
    }).catch(function () { hide('ahTrendSec'); });

  fetch('/.netlify/functions/henshin-templates?offset=0', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw Error('templates'); return r.json(); })
    .then(function (data) {
      var items = ((data && data.templates) || []).filter(function (t) { return isId(t.id) && (safe(t.preview_url) || safe(t.video_url)); }).slice(0, 10).map(function (t) {
        return { href: '/henshin.html?template=' + encodeURIComponent(t.id), label: 'Use this motion template', tag: '✨ Template', go: 'Use template',
          poster: safe(t.poster_url), video: safe(t.preview_url) || safe(t.video_url) };
      });
      if (items.length) fill('ahTmplSec', 'ahTemplates', items); else hide('ahTmplSec');
    }).catch(function () { hide('ahTmplSec'); });

  // ---- Last section: a prompt types itself, "Creating…", then a real Hansora video appears. Runs only on screen.
  (function () {
    var sec = $('ahFinale'); if (!sec) return;
    var V = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/';
    var shots = [
      ['Woman reading in a vintage car, New York street, film look', V + 'video/images/user-uploads/2026/09/18/8e5cdfb95e664d99-seedance-energy.mp4'],
      ['Black bull in armour walks out of the smoke, epic slow motion', V + 'website%20content/videos/video-19.mp4'],
      ['Luxury ad: woman in a white dress beside a classic car', V + 'video/images/user-uploads/2026/09/18/b4fa40090a38edb9-seedance-action.mp4'],
      ['Street interview with a giant red bucket of popcorn', V + 'video/images/user-uploads/2026/09/18/6e292a2ac3b6facc-seedance-skate.mp4']
    ];
    var text = $('ahfText'), stage = sec.querySelector('.ahf-stage'), vids = [].slice.call(stage.querySelectorAll('video')), go = $('ahfGo');
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var visible = false, running = false, i = 0, slot = 0, current = shots[0][0];
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var untilVisible = function () { return new Promise(function (r) { (function check() { if (visible) r(); else setTimeout(check, 300); })(); }); };
    async function loop() {
      if (running) return; running = true;
      for (;;) {
        await untilVisible();
        var shot = shots[i % shots.length]; current = shot[0];
        var next = vids[slot % 2], prev = vids[(slot + 1) % 2];
        next.src = shot[1];
        stage.classList.remove('ready'); stage.classList.remove('gen'); void stage.offsetWidth; stage.classList.add('gen');
        prev.classList.remove('on');
        if (reduce) text.textContent = shot[0];
        else for (var k = 1; k <= shot[0].length; k++) { text.textContent = shot[0].slice(0, k); await wait(26); }
        await wait(reduce ? 300 : 1400);
        try { next.currentTime = 0; } catch (_) {}
        var p = next.play(); if (p && p.catch) p.catch(function () {});
        next.classList.add('on'); stage.classList.add('ready');
        setTimeout(function (v) { return function () { v.pause(); }; }(prev), 900);
        await wait(5200);
        i++; slot++;
      }
    }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      vids.forEach(function (v) { if (!visible) v.pause(); else if (v.classList.contains('on')) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } });
      if (visible) loop();
    }, { threshold: 0.25 }).observe(sec);
    else { visible = true; loop(); }
    // "Try this prompt": the create page opens with the prompt that is on screen.
    go.addEventListener('click', function () { try { sessionStorage.setItem('hansora:article-preset', JSON.stringify({ prompt: current })); } catch (_) {} go.href = '/search-models.html?type=video&articlePreset=1'; });
  })();

})();
