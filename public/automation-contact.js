(function () {
  'use strict';
  const api = window.HansoraAutomation;
  const ui = window.HansoraUI;
  const form = document.querySelector('#contact-form');
  const done = document.querySelector('#contact-done');
  const errorBox = document.querySelector('#contact-error');
  const button = document.querySelector('#contact-send');
  const field = id => document.querySelector(id);
  const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  document.querySelectorAll('[data-icon]').forEach(element => { if (!element.innerHTML) element.innerHTML = ui?.icon(element.dataset.icon) || ''; });
  const topicParam = new URLSearchParams(location.search).get('topic');
  if (topicParam) { const radio = form.querySelector(`input[name="topic"][value="${CSS.escape(topicParam)}"]`); if (radio) radio.checked = true; }

  // Logged in: fill in the account's email (it can still be changed).
  api?.getUser?.().then(user => { const email = String(user?.email || ''); if (validEmail(email) && !field('#contact-email').value) field('#contact-email').value = email; }).catch(() => {});

  function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.hidden = true;
    if (form.elements.website.value) return; // a bot filled the hidden field
    const email = field('#contact-email').value.trim();
    const text = field('#contact-message').value.trim();
    if (!validEmail(email)) { field('#contact-email').focus(); return showError('Please enter a valid email so we can reply.'); }
    if (text.length < 5) { field('#contact-message').focus(); return showError('Please write a short message.'); }
    const topic = form.querySelector('input[name="topic"]:checked')?.value || 'Other';
    // The shared Hansora contact email takes one message; the topic and details go at the top of it.
    const name = field('#contact-name').value.trim(); const company = field('#contact-company').value.trim();
    const lines = [`[Hansora Automation · ${topic}]`];
    if (name) lines.push(`Name: ${name}`);
    if (company) lines.push(`Business: ${company}`);
    lines.push('', text);
    const message = lines.join('\n');
    if (api?.isLocalPreview) { finish(email); return ui?.toast('Preview: the message was not sent.', 'info'); }
    button.disabled = true; button.textContent = 'Sending…';
    try {
      const response = await fetch('/.netlify/functions/contact-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, message }) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      finish(email);
    } catch (error) {
      console.error('contact message failed', error);
      showError('The message could not be sent. Please try again, or write to us on Telegram.');
    } finally { button.disabled = false; button.textContent = 'Send message'; }
  });

  function finish(email) {
    field('#contact-done-email').textContent = email;
    form.hidden = true; done.hidden = false;
    form.reset();
  }
  document.querySelector('#contact-again').addEventListener('click', () => { done.hidden = true; form.hidden = false; field('#contact-message').focus(); });
})();
