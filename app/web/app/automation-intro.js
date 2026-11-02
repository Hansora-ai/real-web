// Automation intro: four short scenes on the phone, looping (tap a tab to jump).
(function () {
  'use strict';
  var app = document.getElementById('aiApp'), toast = document.getElementById('aiToast');
  var tabs = [].slice.call(document.querySelectorAll('#aiTabs button'));
  var timers = [], scene = 0;
  function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clear() { timers.forEach(clearTimeout); timers = []; toast.classList.remove('show'); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function showToast(text, ms) { later(ms, function () { toast.textContent = text; toast.classList.add('show'); }); later(ms + 2200, function () { toast.classList.remove('show'); }); }
  function chat(bar, color, steps) {
    app.innerHTML = bar + '<div class="ai-chat" style="--out:' + color + '"></div>';
    var box = app.querySelector('.ai-chat'), t = 300;
    steps.forEach(function (s) {
      if (s.out) { later(t, function () { box.appendChild(el('<div class="typing"><i></i><i></i><i></i></div>')); }); t += 900;
        later(t, function () { var ty = box.querySelector('.typing'); if (ty) ty.remove(); box.appendChild(el('<div class="msg out"><span class="who">AI · Hansora</span>' + s.out + '</div>')); }); }
      else if (s.card) later(t, function () { box.appendChild(el('<div class="msg card">' + s.card + '</div>')); });
      else later(t, function () { box.appendChild(el('<div class="msg in">' + s.in + '</div>')); });
      t += 1100;
    });
    return t;
  }
  var SCENES = [
    function () { // Instagram: product question -> order
      var t = chat('<div class="ai-bar"><span class="av" style="background:linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)">AM</span><span><b>anna.m</b><small>Instagram</small></span></div>', '#7c3aed', [
        { in: 'Hi! Do you have this jacket in black? 😍' }, { card: '<div class="img">🧥</div><div class="t"><b>Leather jacket</b>Black · S–XL · 120 USD</div>' },
        { out: 'Yes! 🖤 Black is in stock, S to XL. Shall I reserve one for you?' }, { in: 'M please, delivery tomorrow' },
        { out: 'Done ✅ Order #1043 — size M, delivery tomorrow 12–16.' }]);
      showToast('🛍  New order #1043 · 120 USD', t - 600); return t + 2400; },
    function () { // WhatsApp: booking
      var t = chat('<div class="ai-bar"><span class="av" style="background:#25d366">CR</span><span><b>Carlos Ruiz</b><small>WhatsApp</small></span></div>', '#1f9d55', [
        { in: 'Can I book a haircut on Friday?' }, { out: 'Sure! Friday I have 11:00, 15:00 or 17:30. Which works?' },
        { in: '15:00 👍' }, { out: 'Booked ✅ Friday 15:00. See you then, Carlos!' }]);
      showToast('📅  New booking · Friday 15:00', t - 600); return t + 2400; },
    function () { // Call
      app.innerHTML = '<div class="call"><span class="av">🙂</span><h3>+1 555 010 0100</h3><small>AI is answering · 00:12</small><div class="wave">' +
        new Array(14).join('<i></i>') + '</div><div class="lines"></div><span class="end">📞</span></div>';
      [].slice.call(app.querySelectorAll('.wave i')).forEach(function (w, i) { w.style.animationDelay = (i * 0.07) + 's'; });
      var lines = app.querySelector('.lines'), t = 400;
      [['c', 'Caller', 'Are you open on Sunday?'], ['', 'AI', 'Yes, Sunday 10:00 to 18:00. Want me to book a time?'], ['c', 'Caller', 'Can someone call me back about prices?'], ['', 'AI', 'Of course — I saved a callback request for the team.']]
        .forEach(function (l) { later(t, function () { lines.appendChild(el('<div class="line ' + l[0] + '"><b>' + l[1] + ':</b> ' + l[2] + '</div>')); }); t += 1300; });
      showToast('☎️  Callback request saved', t); return t + 2600; },
    function () { // Owner: notifications
      app.innerHTML = '<div class="lock"><div class="time">9:41</div><div class="date">Friday, 7 November</div></div>';
      var lock = app.querySelector('.lock'), t = 400;
      [['🛍', 'New order #1043', 'Leather jacket · M · 120 USD'], ['📅', 'New booking', 'Carlos Ruiz · Friday 15:00'], ['🔴', 'AI needs you', 'Omar asks for a custom size — tap to take over']]
        .forEach(function (n) { later(t, function () { lock.appendChild(el('<div class="notif"><span class="ic">' + n[0] + '</span><span><b>Hansora · ' + n[1] + '</b><small>' + n[2] + '</small></span></div>')); }); t += 1100; });
      return t + 2800; }
  ];
  function run(i) {
    clear(); scene = i;
    tabs.forEach(function (b, j) { b.classList.toggle('on', j === i); });
    var length = SCENES[i]();
    later(length, function () { run((scene + 1) % SCENES.length); });
  }
  tabs.forEach(function (b) { b.addEventListener('click', function () { run(Number(b.dataset.scene)); }); });
  var now = new Date();
  document.getElementById('aiClock').textContent = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
  run(0);
})();
