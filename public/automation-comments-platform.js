// Instagram / TikTok switch on the comment automation page. TikTok comment automation is not live yet: real accounts
// see it as "Soon"; the local preview (?preview=1) shows the planned TikTok version of the same builder.
(() => {
  const preview = location.protocol === 'file:' || new URLSearchParams(location.search).get('preview') === '1';
  const box = document.querySelector('#flow-platform'); if (!box) return;
  const icon = name => window.HansoraUI?.icon(name) || '';
  box.innerHTML = `<button type="button" class="active" data-platform="instagram"><i class="ui-platform-icon instagram">${icon('instagram')}</i>Instagram</button><button type="button" data-platform="tiktok"${preview ? '' : ' disabled title="TikTok comment automation is coming soon"'}><i class="ui-platform-icon tiktok">${icon('tiktok')}</i>TikTok${preview ? '' : ' <em>Soon</em>'}</button>`;
  if (!preview) return;

  const root = document.querySelector('.flow-shell'); const mark = document.querySelector('.flow-channel-mark');
  const markIcon = mark?.innerHTML || '';
  const swaps = [[/Instagram/g, 'TikTok'], [/[Pp]osts? (?:or|and) reels?/g, m => (m[0] === 'P' ? 'V' : 'v') + (/s /.test(m) ? 'ideos' : 'ideo')], [/\breels?\b/g, m => m.endsWith('s') ? 'videos' : 'video'], [/\b24-hour/g, '48-hour'], [/\b24 hours/g, '48 hours']];
  const original = new WeakMap(); let platform = 'instagram'; let applying = false;
  const swap = text => swaps.reduce((value, [from, to]) => value.replace(from, to), text);
  function apply() {
    if (applying) return; applying = true;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => box.contains(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (platform === 'tiktok') { if (/Instagram|\b24[- ]hour|\breels?\b/.test(node.nodeValue)) { original.set(node, node.nodeValue); node.nodeValue = swap(node.nodeValue); } }
      else if (original.has(node)) { node.nodeValue = original.get(node); original.delete(node); }
    }
    root.querySelectorAll('[placeholder*="Instagram"],[aria-label*="Instagram"]').forEach(element => { if (platform !== 'tiktok') return; for (const name of ['placeholder', 'aria-label']) if (element.getAttribute(name)) element.setAttribute(name, swap(element.getAttribute(name))); });
    applying = false;
  }
  new MutationObserver(() => { if (platform === 'tiktok') apply(); }).observe(root, { childList: true, subtree: true, characterData: true });
  box.addEventListener('click', event => {
    const button = event.target.closest('button[data-platform]'); if (!button || button.dataset.platform === platform) return;
    platform = button.dataset.platform;
    box.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    document.body.dataset.commentPlatform = platform;
    if (mark) mark.innerHTML = platform === 'tiktok' ? icon('tiktok') : markIcon;
    apply();
  });
})();
