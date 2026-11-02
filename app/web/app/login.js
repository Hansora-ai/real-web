// The app's login screen. Same account system as the website (same Supabase project and session), so after
// signing in every Creative and Automation page is logged in. Sign-up works like the website: a 6-digit code by email.
(function () {
  'use strict';
  var SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
  // Assigning __HANSORA_SB__ lets app-shim.js open Google/Apple in the phone's browser inside the app.
  window.__HANSORA_SB__ = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  var sb = window.__HANSORA_SB__;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  // Where to go after logging in: the page that asked (only pages inside the app).
  var returnTo = params.get('returnTo') || '/';
  if (!/^\/(?!\/)[^\s]*$/.test(returnTo) || /^\/app\/login/.test(returnTo)) returnTo = '/';
  var mode = params.get('mode') === 'signup' ? 'signUp' : 'signIn';
  var busy = false;

  function show(el, on) { el.hidden = !on; }
  function notice(text, error) { var n = $('notice'); n.textContent = text || ''; n.className = 'notice' + (error ? ' error' : ''); show(n, !!text); }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }
  function friendly(error) {
    var m = String((error && error.message) || '');
    if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect.';
    if (/email not confirmed/i.test(m)) return 'Verify your email before signing in.';
    if (/token has expired|invalid.*(otp|token)/i.test(m)) return 'The code is invalid or expired.';
    if (/failed to fetch|network/i.test(m)) return 'You’re offline. Check your connection and try again.';
    return m || 'Something went wrong. Please try again.';
  }
  function done() { location.replace(returnTo); }

  function render() {
    var verify = mode === 'verify';
    $('title').textContent = verify ? 'Check your inbox' : mode === 'signUp' ? 'Create your account' : 'Welcome to Hansora';
    $('subtitle').textContent = verify ? 'Enter the 6-digit code we sent to ' + $('email').value.trim() + '.' : mode === 'signUp' ? 'Get 30⚡ free to create with AI and set up your AI employee.' : 'Sign in to create with AI and manage your AI employees.';
    show($('segment'), !verify); show($('emailField'), !verify); show($('passwordField'), !verify);
    show($('repeatField'), mode === 'signUp'); show($('codeField'), verify);
    show($('forgot'), mode === 'signIn'); show($('resend'), verify);
    show($('social'), !verify); show($('back'), verify); show($('logo'), !verify);
    $('password').autocomplete = mode === 'signUp' ? 'new-password' : 'current-password';
    $('submit').textContent = verify ? 'Verify and continue' : mode === 'signUp' ? 'Create account' : 'Sign in';
    document.querySelectorAll('#segment button').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === mode); });
  }
  function setMode(next) { mode = next; notice(''); $('repeat').value = ''; $('code').value = ''; render(); }

  async function run(button, task) {
    if (busy) return; busy = true;
    var label = button.textContent; button.disabled = true; button.textContent = '…';
    try { await task(); } catch (error) { notice(friendly(error), true); }
    finally { busy = false; button.disabled = false; if (button.textContent === '…') button.textContent = label; }
  }

  $('form').addEventListener('submit', function (event) {
    event.preventDefault();
    var email = $('email').value.trim(), password = $('password').value;
    run($('submit'), async function () {
      if (mode === 'verify') {
        var code = $('code').value.trim();
        if (!/^\d{6}$/.test(code)) throw new Error('The code is invalid or expired.');
        var v = await sb.auth.verifyOtp({ email: email, token: code, type: 'email' });
        if (v.error) throw v.error; return done();
      }
      if (!validEmail(email)) throw new Error('Enter a valid email address.');
      if (mode === 'signIn') {
        var r = await sb.auth.signInWithPassword({ email: email, password: password });
        if (r.error) throw r.error; return done();
      }
      if (password.length < 6) throw new Error('Password must contain at least 6 characters.');
      if (password !== $('repeat').value) throw new Error('Passwords do not match.');
      // Same sign-up as the website (header.js): a 6-digit code is emailed.
      var s = await sb.auth.signUp({ email: email, password: password, options: { data: { hansora_auth_provider: 'email' } } });
      if (s.error) throw s.error;
      var user = s.data && s.data.user;
      if (user && Array.isArray(user.identities) && user.identities.length === 0) { notice('This email may already have an account. Try signing in, or use a different email.', true); return; }
      if (s.data && s.data.session) return done();
      setMode('verify');
    });
  });

  $('forgot').addEventListener('click', function () {
    var email = $('email').value.trim();
    if (!validEmail(email)) return notice('Enter your email first.', true);
    run($('forgot'), async function () {
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://hansora.co/profile.html?password_recovery=1' });
      if (r.error) throw r.error;
      notice('If an account exists for ' + email + ', a link to reset the password has been sent.');
    });
  });
  $('resend').addEventListener('click', function () {
    run($('resend'), async function () {
      var r = await sb.auth.resend({ type: 'signup', email: $('email').value.trim() });
      if (r.error) throw r.error; notice('A new code was sent.');
    });
  });
  ['google', 'apple'].forEach(function (provider) {
    $(provider).addEventListener('click', function () {
      run($(provider), async function () {
        var r = await sb.auth.signInWithOAuth({ provider: provider, options: { redirectTo: location.origin + returnTo } });
        if (r.error) throw r.error;
      });
    });
  });
  $('segment').addEventListener('click', function (event) { var b = event.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
  $('back').addEventListener('click', function () { setMode('signUp'); });
  $('eye').addEventListener('click', function () {
    var shown = $('password').type === 'text';
    $('password').type = $('repeat').type = shown ? 'password' : 'text';
    $('eye').textContent = shown ? 'Show' : 'Hide';
  });
  // Logging in is optional: closing goes to the Creative home (it works without an account).
  $('close').addEventListener('click', function () { location.replace('/'); });

  // Already signed in (or just returned from Google/Apple): continue.
  sb.auth.getSession().then(function (r) { if (r.data && r.data.session) done(); });
  render();
})();
