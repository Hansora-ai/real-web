// Instagram / TikTok switch on the comment automation pages. On the automations list it chooses which automations are
// shown (the page listens for the "hansora:platform" event); in the Instagram builder, TikTok opens the TikTok builder,
// which is a separate, simpler page (TikTok only allows public replies to comments, no DMs).
(() => {
  const box = document.querySelector('[data-platform-switch]'); if (!box) return;
  const KEY = 'hansora-comment-platform';
  const params = new URLSearchParams(location.search);
  const icon = name => window.HansoraUI?.icon(name) || '';
  const inBuilder = Boolean(document.querySelector('#comments-builder'));
  box.innerHTML = `<button type="button" data-platform="instagram"><i class="ui-platform-icon instagram">${icon('instagram')}</i>Instagram</button><button type="button" data-platform="tiktok"><i class="ui-platform-icon tiktok">${icon('tiktok')}</i>TikTok</button>`;
  const remembered = (() => { try { return sessionStorage.getItem(KEY); } catch (_) { return null; } })();
  const asked = params.get('platform');
  let platform = inBuilder ? 'instagram' : asked === 'tiktok' || asked === 'instagram' ? asked : remembered === 'tiktok' ? 'tiktok' : 'instagram';
  function choose(next) {
    platform = next;
    box.querySelectorAll('button').forEach(item => { const active = item.dataset.platform === platform; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    document.body.dataset.commentPlatform = platform;
    try { sessionStorage.setItem(KEY, platform); } catch (_) {}
    if (!inBuilder) { const url = new URL(location.href); url.searchParams.set('platform', platform); history.replaceState(history.state, '', url); }
    document.dispatchEvent(new CustomEvent('hansora:platform', { detail: platform }));
  }
  box.addEventListener('click', event => {
    const button = event.target.closest('button[data-platform]'); if (!button || button.dataset.platform === platform) return;
    if (inBuilder && button.dataset.platform === 'tiktok') {
      const business = params.get('business') || '';
      const preview = params.get('preview') === '1' ? '&preview=1' : '';
      try { sessionStorage.setItem(KEY, 'tiktok'); } catch (_) {}
      location.href = `automation-tiktok-comments.html?business=${encodeURIComponent(business)}&new=1${preview}`;
      return;
    }
    choose(button.dataset.platform);
  });
  if (inBuilder) { box.querySelectorAll('button').forEach(item => item.classList.toggle('active', item.dataset.platform === 'instagram')); document.body.dataset.commentPlatform = 'instagram'; }
  else choose(platform);
})();
