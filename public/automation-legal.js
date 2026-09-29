// Legal pages: table of contents with scroll tracking, and the data-deletion status check.
(function () {
  'use strict';
  const body = document.querySelector('#legal-body');
  const toc = document.querySelector('#legal-toc');
  if (body && toc) {
    const headings = [...body.querySelectorAll('h2[id]')];
    toc.innerHTML = headings.map(heading => `<li><a href="#${heading.id}">${heading.textContent.replace(/^\d+\.\s*/, '')}</a></li>`).join('');
    const links = [...toc.querySelectorAll('a')];
    let ticking = false;
    const spy = () => {
      ticking = false;
      let current = 0;
      headings.forEach((heading, index) => { if (heading.getBoundingClientRect().top < 120) current = index; });
      links.forEach((link, index) => link.classList.toggle('active', index === current));
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
    spy();
  }

  const status = document.querySelector('#deletion-status');
  const form = document.querySelector('#deletion-check');
  if (!status || !form) return;
  const labels = { completed: ['green', 'Deletion completed', 'The access and data for this account were deleted.'], no_data: ['green', 'Nothing to delete', 'Hansora did not hold data for this account. Access is removed.'], received: ['amber', 'In progress', 'We received the request and are deleting the data.'] };
  async function check(code) {
    status.hidden = false; status.className = 'ui-legal-status'; status.textContent = 'Checking…';
    try {
      const response = await fetch(`/.netlify/functions/automation-meta-data-deletion?code=${encodeURIComponent(code)}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error === 'not_found' ? 'We couldn’t find this confirmation code.' : 'The status could not be checked right now.');
      const [tone, title, text] = labels[result.status] || labels.received;
      status.className = `ui-legal-status ${tone}`;
      status.innerHTML = '';
      const strong = document.createElement('strong'); strong.textContent = title;
      const small = document.createElement('span'); small.textContent = `${text} Code: ${code}`;
      status.append(strong, small);
    } catch (error) { status.className = 'ui-legal-status red'; status.textContent = error.message; }
  }
  form.addEventListener('submit', event => { event.preventDefault(); const code = form.querySelector('input').value.trim(); if (code) check(code); });
  const code = new URLSearchParams(location.search).get('code');
  if (code) { form.querySelector('input').value = code; check(code); }
})();
