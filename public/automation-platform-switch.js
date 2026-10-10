// Instagram / TikTok switch on the comment automation pages (list and builder). TikTok comment automation is not live
// yet: real accounts see it as "Soon"; the local preview (?preview=1) shows the planned TikTok version of the same pages.
(() => {
  const preview = location.protocol === 'file:' || new URLSearchParams(location.search).get('preview') === '1';
  const box = document.querySelector('[data-platform-switch]'); if (!box) return;
  const roots = [...document.querySelectorAll(box.dataset.platformSwitch)]; if (!roots.length) roots.push(document.body);
  const icon = name => window.HansoraUI?.icon(name) || '';
  box.innerHTML = `<button type="button" class="active" data-platform="instagram"><i class="ui-platform-icon instagram">${icon('instagram')}</i>Instagram</button><button type="button" data-platform="tiktok"${preview ? '' : ' disabled title="TikTok comment automation is coming soon"'}><i class="ui-platform-icon tiktok">${icon('tiktok')}</i>TikTok${preview ? '' : ' <em>Soon</em>'}</button>`;
  if (!preview) return;

  const KEY = 'hansora-comment-platform';
  const remembered = (() => { try { return sessionStorage.getItem(KEY); } catch (_) { return null; } })();
  const swaps = [
    [/Instagram/g, 'TikTok'], [/^IG$/, 'TT'],
    [/[Pp]osts? (?:or|and) reels?/g, m => (m[0] === 'P' ? 'V' : 'v') + (/s /.test(m) ? 'ideos' : 'ideo')],
    [/\b([Pp])osts\b/g, (m, p) => (p === 'P' ? 'V' : 'v') + 'ideos'], [/\b([Pp])ost\b/g, (m, p) => (p === 'P' ? 'V' : 'v') + 'ideo'],
    [/\breels?\b/g, m => m.endsWith('s') ? 'videos' : 'video'], [/\b24-hour/g, '48-hour'], [/\b24 hours/g, '48 hours']
  ];
  const needsSwap = /Instagram|^IG$|\b[Pp]osts?\b|\breels?\b|\b24[- ]hour/;
  const swap = text => swaps.reduce((value, [from, to]) => value.replace(from, to), text);
  const original = new WeakMap(); const icons = new WeakMap(); let platform = 'instagram'; let applying = false;
  const parsed = html => { const holder = document.createElement('div'); holder.innerHTML = html; return holder.firstElementChild; };
  const igIcon = parsed(icon('instagram'))?.outerHTML || ''; const swappedSvgs = new Map();
  function apply() {
    if (applying) return; applying = true;
    for (const root of roots) applyTo(root);
    applying = false;
  }
  function applyTo(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => box.contains(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (platform === 'tiktok') { if (!original.has(node) && needsSwap.test(node.nodeValue.trim())) { original.set(node, node.nodeValue); node.nodeValue = swap(node.nodeValue); } }
      else if (original.has(node)) { node.nodeValue = original.get(node); original.delete(node); }
    }
    // Instagram logos outside the switch become the TikTok logo.
    root.querySelectorAll('[data-icon="instagram"]').forEach(element => {
      if (box.contains(element)) return;
      if (platform === 'tiktok' && !icons.has(element)) { icons.set(element, element.innerHTML); element.innerHTML = icon('tiktok'); element.classList.add('is-tiktok'); }
      else if (platform !== 'tiktok' && icons.has(element)) { element.innerHTML = icons.get(element); icons.delete(element); element.classList.remove('is-tiktok'); }
    });
    // Instagram logos drawn inside the flow (step cards) too; put back when switching to Instagram.
    if (igIcon && platform === 'tiktok') root.querySelectorAll('svg').forEach(svg => { if (box.contains(svg) || svg.closest('[data-icon="instagram"]') || svg.outerHTML !== igIcon) return; const next = parsed(icon('tiktok')); if (!next) return; next.classList.add('is-tiktok'); svg.replaceWith(next); swappedSvgs.set(next, svg); });
    if (platform !== 'tiktok') swappedSvgs.forEach((svg, next) => { if (next.isConnected) next.replaceWith(svg); swappedSvgs.delete(next); });
    if (platform === 'tiktok') root.querySelectorAll('[placeholder],[aria-label]').forEach(element => { for (const name of ['placeholder', 'aria-label']) { const value = element.getAttribute(name); if (value && /Instagram/.test(value)) element.setAttribute(name, swap(value)); } });
  }
  const observer = new MutationObserver(() => { if (platform === 'tiktok') apply(); });
  roots.forEach(root => observer.observe(root, { childList: true, subtree: true, characterData: true }));
  function choose(next) {
    platform = next;
    box.querySelectorAll('button').forEach(item => item.classList.toggle('active', item.dataset.platform === platform));
    document.body.dataset.commentPlatform = platform;
    try { sessionStorage.setItem(KEY, platform); } catch (_) {}
    apply();
  }
  box.addEventListener('click', event => { const button = event.target.closest('button[data-platform]'); if (button && button.dataset.platform !== platform) choose(button.dataset.platform); });
  if (remembered === 'tiktok') choose('tiktok');
})();
