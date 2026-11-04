// Mobile bottom nav initializer (client-side).
// Builds the phone bottom bar, circular Models picker, and menu sheet.
(function initHSBottomNav(){
  try {
    if (window.matchMedia && !window.matchMedia('(max-width: 768px)').matches) return;
    if (document.querySelector('.hs-bottom-nav')) return;

    const root = document.getElementById('hs-bottom-nav-root') || document.body;
    const tpl = document.createElement('template');
    tpl.innerHTML = `
<nav aria-label="Mobile bottom navigation" class="hs-bottom-nav">
  <div class="hs-bottom-rail">
    <a aria-label="Home" class="hs-btn" href="/index.html">
      <svg viewBox="0 0 24 24"><path d="M3 10.5L12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path></svg>
      <span>Home</span>
    </a>
    <a aria-label="Features" class="hs-btn" href="/models.html#featuresSection">
      <svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"></path><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"></path></svg>
      <span>Features</span>
    </a>
    <div class="hs-fab-wrap">
      <button aria-label="Open models" class="hs-fab" id="hs-models-btn" type="button">
        <svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"></path></svg>
        <span>Models</span>
      </button>
    </div>
    <a aria-label="History" class="hs-btn" href="/usage.html">
      <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.708"></path><path d="M3 3v6h6"></path><path d="M12 7v6l4 2"></path></svg>
      <span>History</span>
    </a>
    <button aria-label="Menu" class="hs-btn" id="hs-menu-btn" type="button">
      <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
      <span>Menu</span>
    </button>
  </div>
</nav>

<div class="hs-radial" id="hs-radial" aria-hidden="true">
  <div class="hs-radial-backdrop" id="hs-radial-backdrop"></div>
  <div class="hs-radial-panel" role="dialog" aria-modal="true" aria-label="Choose model type">
    <a class="hs-radial-item hs-radial-image" href="/search-models.html">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 13l2.5-3 3 4 2-2.5L20 17"></path><circle cx="8" cy="8" r="1.5"></circle></svg></span>
      <b>Image</b>
    </a>
    <a class="hs-radial-item hs-radial-video" href="/search-models.html?type=video">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M4 6h11v12H4z"></path><path d="M15 10l5-3v10l-5-3"></path></svg></span>
      <b>Video</b>
    </a>
    <a class="hs-radial-item hs-radial-audio" href="/audio.html">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M5 10v4"></path><path d="M9 7v10"></path><path d="M13 5v14"></path><path d="M17 8v8"></path><path d="M21 11v2"></path></svg></span>
      <b>Audio</b>
    </a>
    <a class="hs-radial-item hs-radial-character" href="/character.html">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg></span>
      <b>Character</b>
    </a>
    <button class="hs-radial-item hs-radial-more" id="hs-radial-more" type="button">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"></path><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"></path></svg></span>
      <b>See more</b>
    </button>
    <button class="hs-radial-close" id="hs-radial-close" type="button" aria-label="Close models menu">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"></path></svg>
    </button>
  </div>
</div>

<div class="hs-overlay" id="hs-overlay" aria-hidden="true">
  <div class="backdrop" id="hs-backdrop"></div>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="hs-ol-title">
    <header>
      <h3 id="hs-ol-title">Menu</h3>
      <button id="hs-close" aria-label="Close menu" type="button">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
    </header>
    <div class="links">
      <a href="/search-models.html"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 13l2.5-3 3 4 2-2.5L20 17"></path></svg> Image</a>
      <a href="/search-models.html?type=video"><svg viewBox="0 0 24 24"><path d="M4 6h11v12H4z"></path><path d="M15 10l5-3v10l-5-3"></path></svg> Video</a>
      <a href="/audio.html"><svg viewBox="0 0 24 24"><path d="M5 10v4"></path><path d="M9 7v10"></path><path d="M13 5v14"></path><path d="M17 8v8"></path></svg> Audio</a>
      <button class="hs-feature-toggle" id="hs-feature-toggle" type="button">
        <span><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"></path></svg> Features</span>
        <svg class="hs-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
      </button>
      <div class="hs-feature-list" id="hs-feature-list">
        <a href="/upscale.html">Image upscale</a>
        <a href="/expand.html?mode=angles">Full angles</a>
        <a href="/expand.html?mode=expand">Expand</a>
        <a href="/expand.html?mode=face-swap">Face swap</a>
        <a href="/character.html">Character</a>
        <a href="/upscale.html?mode=video">Video upscale</a>
        <a href="/lipsync.html">Lipsync Avatar</a>
        <a href="/audio.html?tool=text-to-speech">Text to speech</a>
        <a href="/audio.html?tool=voice-isolater">Voice isolater</a>
        <a href="/audio.html?tool=voice-changer">Voice changer</a>
        <a href="/audio.html?tool=song-creation">Song Creation</a>
        <a href="/analyse.html">Hook analyse</a>
      </div>
      <a href="/pricing.html"><svg viewBox="0 0 24 24"><path d="M3 7h18v10H3z"></path><path d="M8 10h8M8 14h8"></path></svg> Pricing</a>
      <a href="/index.html#faq"><svg viewBox="0 0 24 24"><path d="M12 17h.01"></path><path d="M9.09 9a3 3 0 1 1 5.91 1c0 2-3 2-3 4"></path></svg> FAQ</a>
      <a href="/contact.html"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"></path><path d="M4 8l8 6 8-6"></path></svg> Contact</a>
    </div>
  </div>
</div>`;

    root.appendChild(tpl.content.cloneNode(true));

    const menuBtn = document.getElementById('hs-menu-btn');
    const overlay = document.getElementById('hs-overlay');
    const closeBtn = document.getElementById('hs-close');
    const backdrop = document.getElementById('hs-backdrop');
    const modelsBtn = document.getElementById('hs-models-btn');
    const radial = document.getElementById('hs-radial');
    const radialBackdrop = document.getElementById('hs-radial-backdrop');
    const radialClose = document.getElementById('hs-radial-close');
    const radialMore = document.getElementById('hs-radial-more');
    const featureToggle = document.getElementById('hs-feature-toggle');

    const openMenu = (expandFeatures) => {
      if (!overlay) return;
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      if (expandFeatures) overlay.classList.add('features-open');
    };
    const closeMenu = () => {
      if (!overlay) return;
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    };
    const openRadial = () => {
      if (!radial) return;
      closeMenu();
      radial.classList.add('is-open');
      radial.setAttribute('aria-hidden', 'false');
    };
    const closeRadial = () => {
      if (!radial) return;
      radial.classList.remove('is-open');
      radial.setAttribute('aria-hidden', 'true');
    };

    menuBtn && menuBtn.addEventListener('click', () => { closeRadial(); openMenu(false); });
    closeBtn && closeBtn.addEventListener('click', closeMenu);
    backdrop && backdrop.addEventListener('click', closeMenu);
    modelsBtn && modelsBtn.addEventListener('click', openRadial);
    radialBackdrop && radialBackdrop.addEventListener('click', closeRadial);
    radialClose && radialClose.addEventListener('click', closeRadial);
    radialMore && radialMore.addEventListener('click', () => { closeRadial(); openMenu(true); });
    featureToggle && featureToggle.addEventListener('click', () => overlay && overlay.classList.toggle('features-open'));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeRadial();
        closeMenu();
      }
    });
  } catch(e) {
    console.warn('Mobile bottom nav failed', e);
  }
})();
