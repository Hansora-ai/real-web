(async function () {
  'use strict';
  // Products: the catalog the AI answers from (prices, variants, stock) and matches customers' photos against.
  const api = window.HansoraAutomation; const ui = window.HansoraUI; const $ = selector => document.querySelector(selector);
  const params = new URLSearchParams(location.search);
  const businessId = params.get('business') || (api.isLocalPreview ? 'preview' : '');
  const previewSuffix = api.isLocalPreview && location.protocol !== 'file:' ? '&preview=1' : '';
  const user = await api.requireUser(location.pathname + location.search); if (!user) return;
  if (!api.isLocalPreview && !/^[0-9a-f-]{36}$/i.test(businessId)) return fail('This products link is invalid.');
  $('#products-back').href = `automation-agent.html?id=${encodeURIComponent(businessId)}${previewSuffix}`;
  const FIELD_LABELS = { name: 'Product name', price: 'Price', description: 'Description', category: 'Category', sku: 'SKU / code', stock: 'Stock', currency: 'Currency', variant: 'Variant (colour, size…)', variant_price: 'Variant price', variant_stock: 'Variant stock', photo_url: 'Photo link' };
  let products = [], catalog = null, source = null, editing = null, photoUrls = new Map(), importState = null;

  try { await load(); } catch (error) { return fail(api.displayError(error)); }
  $('#products-loading').hidden = true; $('#products-app').hidden = false;
  renderSettings(); render();

  async function load() {
    if (api.isLocalPreview) {
      products = [{ id: 'p1', name: 'Oslo sofa', category: 'Sofas', price: 899, currency: 'USD', stock: 2, variants: [{ name: 'Grey', price: 899, stock: 2, color: '#9ca3af' }, { name: 'Blue', price: 949, stock: 0, color: '#3b82f6' }], photos: [], active: true, description: 'Two-seat sofa' }, { id: 'p2', name: 'Desk lamp', category: 'Lighting', price: 39, currency: 'USD', stock: null, variants: [], photos: [], active: true, description: '' }];
      catalog = { enabled: true, config: { reduce_stock: false } }; return;
    }
    const [list, tool, sheet] = await Promise.all([
      api.db.from('automation_products').select('*').eq('business_id', businessId).order('name', { ascending: true }).limit(2000),
      api.db.from('automation_tool_configs').select('id,enabled,config').eq('business_id', businessId).eq('tool_type', 'catalog').maybeSingle(),
      api.db.from('automation_product_sources').select('*').eq('business_id', businessId).in('kind', ['google_sheet', 'excel_online']).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    ]);
    if (list.error) throw list.error;
    products = list.data || []; catalog = tool.data || null; source = sheet.data || null;
  }

  // ---------- settings ----------
  function renderSettings() {
    $('#catalog-enabled').checked = Boolean(catalog?.enabled);
    $('#catalog-reduce-stock').checked = catalog?.config?.reduce_stock === true;
    const status = $('#sheet-status');
    if (source?.url) {
      status.hidden = false;
      status.innerHTML = `<span data-icon="refresh"></span><span><strong>${source.kind === 'excel_online' ? 'Excel file connected' : 'Google Sheet connected'}</strong><small>${source.status === 'error' ? `Last sync failed: ${escapeHtml(friendlyError(source.last_error))}` : `Synced ${source.last_synced_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(source.last_synced_at)) : 'soon'} · ${source.last_count ?? 0} products · re-read every hour`}</small></span><button class="ui-btn ghost sm" id="sheet-sync-now" type="button">Sync now</button><button class="ui-btn ghost sm" id="sheet-disconnect" type="button">Disconnect</button>`;
      $('#sheet-sync-now').addEventListener('click', () => runImport({ sheetUrl: source.url, map: source.column_map, currency: source.column_map?._currency || '', quiet: true }));
      $('#sheet-disconnect').addEventListener('click', async () => {
        if (!confirm('Stop syncing this sheet? Products already imported stay.')) return;
        const result = await api.db.from('automation_product_sources').delete().eq('id', source.id).eq('business_id', businessId);
        if (result.error) return ui.toast(api.displayError(result.error), 'error');
        source = null; renderSettings();
      });
    } else status.hidden = true;
  }
  async function saveCatalogSettings() {
    const row = { business_id: businessId, tool_type: 'catalog', enabled: $('#catalog-enabled').checked, config: { ...(catalog?.config || {}), reduce_stock: $('#catalog-reduce-stock').checked } };
    if (api.isLocalPreview) { catalog = row; return ui.toast('Saved.'); }
    const result = await api.db.from('automation_tool_configs').upsert(row, { onConflict: 'business_id,tool_type' }).select('id,enabled,config').single();
    if (result.error) { ui.toast(api.displayError(result.error), 'error'); return renderSettings(); }
    catalog = result.data; ui.toast(row.enabled ? 'Saved. Your AI employee uses the catalog from the next message.' : 'Saved. Your AI employee no longer uses the catalog.');
  }
  $('#catalog-enabled').addEventListener('change', saveCatalogSettings);
  $('#catalog-reduce-stock').addEventListener('change', saveCatalogSettings);
  // The first product switches the catalog on (it can be switched off again).
  async function ensureCatalogOn() { if (!catalog) { $('#catalog-enabled').checked = true; await saveCatalogSettings(); } }

  // ---------- list ----------
  function render() {
    const query = $('#products-search').value.trim().toLowerCase();
    const shown = products.filter(item => !query || [item.name, item.category, item.sku, item.description, ...(item.variants || []).map(v => v.name)].join(' ').toLowerCase().includes(query));
    $('#products-count').textContent = `${products.length} product${products.length === 1 ? '' : 's'}`;
    $('#products-empty').hidden = products.length > 0;
    $('#products-rows').innerHTML = shown.map(item => {
      const photo = item.photos?.[0];
      const stock = item.stock === null || item.stock === undefined ? '' : item.stock === 0 ? '<span class="ui-badge red">Out of stock</span>' : `<span class="ui-badge">${item.stock} in stock</span>`;
      return `<button class="products-item${item.active ? '' : ' inactive'}" type="button" data-edit="${escapeHtml(item.id)}">
        <span class="products-thumb" ${photo ? `data-photo="${escapeHtml(photo.path || photo.url || '')}"` : ''}>${photo ? '' : (ui?.icon('box') || '')}</span>
        <span class="products-item-main"><strong>${escapeHtml(item.name)}</strong><small>${item.variants?.some(variant => safeColor(variant.color)) ? `<span class="products-dots">${item.variants.filter(variant => safeColor(variant.color)).slice(0, 8).map(variant => `<i style="--swatch:${safeColor(variant.color)}" title="${escapeHtml(variant.name)}"></i>`).join('')}</span>` : ''}${escapeHtml([item.category, item.variants?.length ? `${item.variants.length} variants` : ''].filter(Boolean).join(' · '))}</small></span>
        <span class="products-item-side"><b>${item.price === null || item.price === undefined ? '—' : `${formatPrice(item.price)} ${escapeHtml(item.currency)}`}</b>${stock}${item.active ? '' : '<span class="ui-badge">Hidden</span>'}</span>
      </button>`;
    }).join('');
    loadPhotos($('#products-rows'));
  }
  $('#products-search').addEventListener('input', render);
  $('#products-rows').addEventListener('click', event => { const button = event.target.closest('[data-edit]'); if (button) openEditor(products.find(item => item.id === button.dataset.edit)); });

  // Photos: uploaded ones are private (short-lived links); imported ones are public links.
  async function loadPhotos(root) {
    const holders = [...root.querySelectorAll('[data-photo]')];
    const missing = [...new Set(holders.map(el => el.dataset.photo).filter(path => path && !/^https:\/\//.test(path) && !photoUrls.has(path)))];
    if (missing.length && !api.isLocalPreview) {
      try { const response = await api.authenticatedFetch('/.netlify/functions/automation-media-url', { method: 'POST', body: JSON.stringify({ business_id: businessId, paths: missing }) }); const result = await response.json().catch(() => ({})); Object.entries(result.urls || {}).forEach(([path, url]) => photoUrls.set(path, url)); } catch (_) {}
    }
    holders.forEach(el => { const value = el.dataset.photo; const url = /^(https:\/\/|blob:)/.test(value) ? value : photoUrls.get(value); if (url && !el.querySelector('img')) el.insertAdjacentHTML('afterbegin', `<img src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`); });
  }

  // ---------- editor ----------
  // Common colour names (English, Armenian, Russian) → a swatch, so "Grey" gets a grey dot without picking it.
  const COLOR_WORDS = [[/gr[ae]y|մոխրագույն|сер/i, '#9ca3af'], [/black|սև|черн/i, '#111827'], [/white|սպիտակ|бел/i, '#f9fafb'], [/beige|բեժ|беж/i, '#d6c3a5'], [/brown|walnut|շագանակագույն|корич|орех/i, '#7c4a2d'], [/navy|dark blue|մուգ կապույտ|темно-син/i, '#1e3a8a'], [/blue|կապույտ|син|голуб/i, '#3b82f6'], [/green|կանաչ|зел/i, '#16a34a'], [/red|կարմիր|красн/i, '#dc2626'], [/pink|վարդագույն|розов/i, '#ec4899'], [/yellow|դեղին|желт/i, '#facc15'], [/orange|նարնջագույն|оранж/i, '#f97316'], [/purple|violet|մանուշակագույն|фиолет/i, '#8b5cf6'], [/cream|կրեմ|кремов/i, '#f5ecd7'], [/gold|ոսկեգույն|золот/i, '#d4a017'], [/silver|արծաթագույն|серебр/i, '#c0c0c0']];
  // Default currency: the one the owner already uses. Nothing is assumed for the first product (businesses are in
  // many countries); the owner types it once.
  const defaultCurrency = () => products.find(item => item.currency)?.currency || '';
  const guessColor = name => (COLOR_WORDS.find(([pattern]) => pattern.test(String(name || ''))) || [])[1] || '';
  $('#add-product').addEventListener('click', () => openEditor(null));
  function openEditor(product) {
    editing = product ? JSON.parse(JSON.stringify(product)) : { id: api.isLocalPreview ? `p${Date.now()}` : crypto.randomUUID(), isNew: true, name: '', description: '', category: '', sku: '', payment_link: '', price: null, currency: defaultCurrency(), stock: null, variants: [], photos: [], active: true };
    editing.variants = (editing.variants || []).map(variant => ({ ...variant }));
    $('#product-title').textContent = product ? 'Edit product' : 'Add product';
    $('#p-name').value = editing.name; $('#p-price').value = editing.price ?? ''; $('#p-currency').value = editing.currency || ''; $('#p-stock').value = editing.stock ?? '';
    $('#p-category').value = editing.category || ''; $('#p-sku').value = editing.sku || ''; $('#p-description').value = editing.description || ''; $('#p-payment-link').value = editing.payment_link || ''; $('#p-active').checked = editing.active !== false;
    $('#p-more').open = Boolean(editing.category || editing.description || editing.sku || editing.payment_link);
    $('#delete-product').hidden = Boolean(editing.isNew);
    renderVariants(); renderPhotos();
    $('#product-dialog').showModal(); setTimeout(() => $('#p-name').focus(), 30);
  }

  // Variants: optional colour dot, name, own price (empty = product price) and stock.
  function renderVariants() {
    $('#variant-rows').innerHTML = editing.variants.length ? `<div class="products-variant head"><span></span><span>Name</span><span>Price</span><span>Stock</span><span></span></div>` + editing.variants.map((variant, index) => `<div class="products-variant">
      <span class="products-swatch${variant.color ? '' : ' empty'}" style="${safeColor(variant.color) ? `--swatch:${safeColor(variant.color)}` : ''}" title="${variant.color ? 'Change colour' : 'Add a colour (optional)'}"><input type="color" data-variant="${index}" data-key="color" value="${escapeHtml(variant.color || '#9ca3af')}" aria-label="Colour">${variant.color ? `<button type="button" data-clear-color="${index}" aria-label="Remove colour">✕</button>` : ''}</span>
      <input class="ui-input" data-variant="${index}" data-key="name" placeholder="e.g. Grey" value="${escapeHtml(variant.name || '')}">
      <input class="ui-input" data-variant="${index}" data-key="price" inputmode="decimal" placeholder="Same" value="${variant.price ?? ''}">
      <input class="ui-input" data-variant="${index}" data-key="stock" inputmode="numeric" placeholder="—" value="${variant.stock ?? ''}">
      <button class="ui-btn ghost icon sm" type="button" data-remove-variant="${index}" aria-label="Remove variant">✕</button></div>`).join('') : '<p class="products-hint">No variants. Add them if this product comes in colours or sizes.</p>';
    syncStockField();
  }
  // With variants that all have a stock number, the product's stock is their sum (shown, not typed).
  function syncStockField() {
    const counted = editing.variants.length && editing.variants.every(variant => Number.isInteger(variant.stock));
    $('#p-stock').disabled = Boolean(counted);
    if (counted) $('#p-stock').value = editing.variants.reduce((sum, variant) => sum + variant.stock, 0);
    $('#p-stock-field').title = counted ? 'Sum of the variants' : '';
  }
  $('#add-variant').addEventListener('click', () => { readVariants(); editing.variants.push({ name: '', price: null, stock: null, color: '' }); renderVariants(); $('#variant-rows').querySelector(`[data-variant="${editing.variants.length - 1}"][data-key="name"]`)?.focus(); });
  $('#variant-rows').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-variant]'); const clear = event.target.closest('[data-clear-color]');
    if (remove) { readVariants(); editing.variants.splice(Number(remove.dataset.removeVariant), 1); renderVariants(); renderPhotos(); }
    if (clear) { event.preventDefault(); readVariants(); editing.variants[Number(clear.dataset.clearColor)].color = ''; editing.variants[Number(clear.dataset.clearColor)].colorCleared = true; renderVariants(); }
  });
  $('#variant-rows').addEventListener('input', event => {
    const input = event.target.closest('[data-variant]'); if (!input) return;
    const variant = editing.variants[Number(input.dataset.variant)]; if (!variant) return;
    if (input.dataset.key === 'color') { variant.color = input.value; const swatch = input.parentElement; swatch.classList.remove('empty'); swatch.style.setProperty('--swatch', input.value); return; }
    if (input.dataset.key === 'name' && !variant.color && !variant.colorCleared) { const guess = guessColor(input.value); const swatch = input.parentElement.querySelector('.products-swatch'); if (guess && swatch) { swatch.classList.remove('empty'); swatch.style.setProperty('--swatch', guess); swatch.dataset.guess = guess; } else if (swatch) { swatch.classList.add('empty'); swatch.style.removeProperty('--swatch'); delete swatch.dataset.guess; } }
    if (input.dataset.key === 'stock') { readVariants(); syncStockField(); }
  });
  $('#variant-rows').addEventListener('change', event => { if (event.target.dataset.key === 'name') { readVariants(); renderPhotos(); } });
  function readVariants() {
    $('#variant-rows').querySelectorAll('[data-variant]').forEach(input => {
      const variant = editing.variants[Number(input.dataset.variant)]; if (!variant) return;
      const value = input.value.trim(); const key = input.dataset.key;
      if (key === 'color') return;
      variant[key] = key === 'name' ? value : key === 'price' ? parsePrice(value) : parseStock(value);
      if (key === 'name' && !variant.color && !variant.colorCleared) variant.color = guessColor(value);
    });
  }

  // Photos: drag to reorder (or ★ to make one the main photo), ✕ to remove, drop files anywhere in the editor.
  let dragFrom = null;
  function renderPhotos() {
    const names = editing.variants.map(variant => variant.name).filter(Boolean);
    $('#photo-rows').innerHTML = editing.photos.map((photo, index) => `<div class="products-photo${index === 0 ? ' main' : ''}" draggable="true" data-photo-index="${index}" data-photo="${escapeHtml(photo.path || photo.url || '')}">
        <button type="button" class="products-photo-x" data-remove-photo="${index}" aria-label="Remove photo">✕</button>
        ${index === 0 ? '<span class="products-photo-main">Main</span>' : `<button type="button" class="products-photo-star" data-main-photo="${index}" title="Make main photo" aria-label="Make main photo">★</button>`}
        ${names.length ? `<select class="products-photo-variant" data-photo-variant="${index}" aria-label="Which variant this photo shows"><option value="">All</option>${names.map(name => `<option value="${escapeHtml(name)}"${photo.variant === name ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>` : ''}
      </div>`).join('') + (editing.photos.length < 8 ? `<button type="button" class="products-photo-add" id="photo-add"><span>+</span><small>Add photo</small><small>or drop here</small></button>` : '');
    loadPhotos($('#photo-rows'));
  }
  $('#photo-rows').addEventListener('click', event => {
    if (event.target.closest('#photo-add')) return $('#p-photo').click();
    const remove = event.target.closest('[data-remove-photo]');
    if (remove) { const [removed] = editing.photos.splice(Number(remove.dataset.removePhoto), 1); (editing.removedPhotos ||= []).push(removed); return renderPhotos(); }
    const star = event.target.closest('[data-main-photo]');
    if (star) { const [photo] = editing.photos.splice(Number(star.dataset.mainPhoto), 1); editing.photos.unshift(photo); renderPhotos(); }
  });
  $('#photo-rows').addEventListener('change', event => { const select = event.target.closest('[data-photo-variant]'); if (select) { const photo = editing.photos[Number(select.dataset.photoVariant)]; if (select.value) photo.variant = select.value; else delete photo.variant; } });
  $('#photo-rows').addEventListener('dragstart', event => { const tile = event.target.closest('[data-photo-index]'); if (!tile) return; dragFrom = Number(tile.dataset.photoIndex); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', 'photo'); tile.classList.add('dragging'); });
  $('#photo-rows').addEventListener('dragend', () => { dragFrom = null; $('#photo-rows').querySelectorAll('.dragging,.drop-target').forEach(el => el.classList.remove('dragging', 'drop-target')); });
  $('#photo-rows').addEventListener('dragover', event => { if (dragFrom === null) return; const tile = event.target.closest('[data-photo-index]'); if (!tile) return; event.preventDefault(); $('#photo-rows').querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')); tile.classList.add('drop-target'); });
  $('#photo-rows').addEventListener('drop', event => { if (dragFrom === null) return; const tile = event.target.closest('[data-photo-index]'); if (!tile) return; event.preventDefault(); event.stopPropagation(); const to = Number(tile.dataset.photoIndex); if (to !== dragFrom) { const [photo] = editing.photos.splice(dragFrom, 1); editing.photos.splice(to, 0, photo); } dragFrom = null; renderPhotos(); });
  // Files dragged from the computer onto the editor are uploaded.
  const editorBody = $('#product-drop');
  editorBody.addEventListener('dragover', event => { if (dragFrom !== null || ![...(event.dataTransfer?.types || [])].includes('Files')) return; event.preventDefault(); editorBody.classList.add('dropping'); });
  editorBody.addEventListener('dragleave', event => { if (!editorBody.contains(event.relatedTarget)) editorBody.classList.remove('dropping'); });
  editorBody.addEventListener('drop', event => { editorBody.classList.remove('dropping'); if (dragFrom !== null || !event.dataTransfer?.files?.length) return; event.preventDefault(); uploadPhotos([...event.dataTransfer.files]); });
  $('#p-photo').addEventListener('change', event => { const files = [...event.target.files]; event.target.value = ''; uploadPhotos(files); });
  async function uploadPhotos(files) {
    const room = 8 - editing.photos.length;
    if (room <= 0) return ui.toast('Up to 8 photos per product.', 'error');
    for (const file of files.slice(0, room)) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { ui.toast(`${file.name}: use a JPG, PNG or WebP photo.`, 'error'); continue; }
      if (file.size > 4 * 1024 * 1024) { ui.toast(`${file.name} is larger than 4 MB.`, 'error'); continue; }
      if (api.isLocalPreview) { editing.photos.push({ url: URL.createObjectURL(file) }); continue; }
      ui.busy('Uploading photo…');
      try {
        const response = await api.authenticatedFetch('/.netlify/functions/automation-product-photo', { method: 'POST', body: JSON.stringify({ business_id: businessId, product_id: editing.id, content_type: file.type, content_base64: await toBase64(file) }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'The photo could not be saved.');
        editing.photos.push({ path: result.path });
      } catch (error) { ui.toast(error.message, 'error'); }
      finally { ui.busy(false); }
    }
    renderPhotos();
  }

  $('#product-form').addEventListener('submit', async event => {
    event.preventDefault(); readVariants();
    const name = $('#p-name').value.trim();
    if (!name) { $('#p-name').focus(); return ui.toast('Give the product a name.', 'error'); }
    const currency = $('#p-currency').value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) { $('#p-currency').focus(); return ui.toast('Add the currency as a 3-letter code, e.g. USD, EUR, GBP.', 'error'); }
    let paymentLink = $('#p-payment-link').value.trim();
    if (paymentLink && !/^https?:\/\//i.test(paymentLink)) paymentLink = `https://${paymentLink}`;
    if (paymentLink && !/^https:\/\/[^\s.]+\.[^\s]+$/i.test(paymentLink)) { $('#p-more').open = true; $('#p-payment-link').focus(); return ui.toast('The payment link must be a full https:// link.', 'error'); }
    const names = new Set();
    for (const variant of editing.variants.filter(item => item.name)) { const key = variant.name.toLocaleLowerCase(); if (names.has(key)) return ui.toast(`Two variants are called "${variant.name}".`, 'error'); names.add(key); }
    const variants = editing.variants.filter(variant => variant.name).map(variant => ({ name: variant.name.slice(0, 200), price: variant.price, stock: variant.stock, ...(safeColor(variant.color) ? { color: safeColor(variant.color) } : {}) }));
    let stock = parseStock($('#p-stock').value);
    if (variants.length && variants.every(variant => Number.isInteger(variant.stock))) stock = variants.reduce((sum, variant) => sum + variant.stock, 0);
    const photos = editing.photos.slice(0, 8).map(photo => (photo.variant && !names.has(String(photo.variant).toLocaleLowerCase()) ? (({ variant, ...rest }) => rest)(photo) : photo));
    const row = { business_id: businessId, name: name.slice(0, 300), price: parsePrice($('#p-price').value), currency, stock, category: $('#p-category').value.trim().slice(0, 200), sku: $('#p-sku').value.trim().slice(0, 120), description: $('#p-description').value.trim().slice(0, 5000), variants, photos, active: $('#p-active').checked, updated_at: new Date().toISOString() };
    if (paymentLink || editing.payment_link) row.payment_link = paymentLink.slice(0, 1000);
    const save = $('#save-product'); save.disabled = true; save.textContent = 'Saving…';
    try {
      if (!api.isLocalPreview) {
        const write = value => editing.isNew ? api.db.from('automation_products').insert({ id: editing.id, ...value }).select('*').single() : api.db.from('automation_products').update(value).eq('id', editing.id).eq('business_id', businessId).select('*').single();
        let result = await write(row);
        // Before SQL 12 there is no payment_link column: save everything else and say so.
        if (result.error && 'payment_link' in row && /payment_link/.test(String(result.error.message || ''))) { const { payment_link, ...rest } = row; result = await write(rest); if (!result.error) ui.toast('Saved, but the payment link needs a database update first (SQL 12).', 'error'); }
        if (result.error) throw result.error;
        const removed = (editing.removedPhotos || []).map(photo => photo.path).filter(Boolean);
        if (removed.length) api.authenticatedFetch('/.netlify/functions/automation-product-photo', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'delete', paths: removed }) }).catch(() => {});
        Object.assign(row, result.data);
      }
      const index = products.findIndex(item => item.id === editing.id);
      if (index >= 0) products[index] = { ...products[index], ...row }; else products.push({ id: editing.id, ...row });
      products.sort((a, b) => a.name.localeCompare(b.name));
      await ensureCatalogOn();
      $('#product-dialog').close(); render(); ui.toast('Product saved ✓');
    } catch (error) { ui.toast(api.displayError(error), 'error'); }
    finally { save.disabled = false; save.textContent = 'Save'; }
  });
  $('#delete-product').addEventListener('click', async () => {
    if (!confirm(`Delete "${editing.name}"? Your AI employee will stop offering it.`)) return;
    if (!api.isLocalPreview) {
      const result = await api.db.from('automation_products').delete().eq('id', editing.id).eq('business_id', businessId);
      if (result.error) return ui.toast(api.displayError(result.error), 'error');
      const paths = editing.photos.map(photo => photo.path).filter(Boolean);
      if (paths.length) api.authenticatedFetch('/.netlify/functions/automation-product-photo', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'delete', paths }) }).catch(() => {});
    }
    products = products.filter(item => item.id !== editing.id); $('#product-dialog').close(); render(); ui.toast('Product deleted.');
  });
  document.querySelectorAll('dialog [data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

  // ---------- import ----------
  // Drop a file (or paste a sheet link) → "Import 7 products?" with a short list. Columns are matched automatically;
  // the column list only opens when the name column is not found, or when the owner asks to change it.
  function resetImport() { importState = null; $('#import-summary').hidden = true; $('#import-mapping').hidden = true; $('#import-error').hidden = true; $('#import-run').disabled = true; $('#import-run').textContent = 'Import'; }
  $('#open-import').addEventListener('click', () => { resetImport(); $('#import-file').value = ''; $('#sheet-url').value = source?.url || ''; $('#import-dialog').showModal(); });
  document.querySelectorAll('[data-import-tab]').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('[data-import-tab]').forEach(item => item.classList.toggle('active', item === tab));
    document.querySelectorAll('[data-import-pane]').forEach(pane => { pane.hidden = pane.dataset.importPane !== tab.dataset.importTab; });
    resetImport();
  }));
  const dropzone = $('#import-drop');
  dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
  dropzone.addEventListener('drop', event => { event.preventDefault(); dropzone.classList.remove('over'); const file = event.dataTransfer?.files?.[0]; if (file) readFile(file); });
  $('#import-file').addEventListener('change', event => { const file = event.target.files[0]; if (file) readFile(file); });
  async function readFile(file) {
    resetImport();
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return importError('Use an Excel (.xlsx) or CSV file.');
    if (file.size > 8 * 1024 * 1024) return importError('The file is larger than 8 MB.');
    try {
      if (!window.XLSX) throw new Error('The spreadsheet reader did not load. Refresh the page and try again.');
      const book = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }).filter(row => row.some(cell => String(cell).trim() !== '')).slice(0, 5001);
      await preview({ rows, label: file.name });
    } catch (error) { importError(error.message || 'This file could not be read.'); }
  }
  $('#sheet-load').addEventListener('click', () => {
    const url = $('#sheet-url').value.trim();
    if (!/^https:\/\/(docs\.google\.com\/spreadsheets\/|1drv\.ms\/|onedrive\.live\.com\/|[a-z0-9-]+(-my)?\.sharepoint\.com\/)/i.test(url)) return importError('Paste a Google Sheets link, or an Excel link from OneDrive or SharePoint.');
    preview({ sheetUrl: url, label: /google/.test(url) ? 'your Google Sheet' : 'your Excel file' });
  });
  $('#sheet-url').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('#sheet-load').click(); } });
  async function preview({ rows = null, sheetUrl = '', label = '' }) {
    $('#import-error').hidden = true;
    if (api.isLocalPreview) return importError('Import is disabled in preview.');
    ui.busy('Reading…');
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-catalog-import', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'preview', ...(sheetUrl ? { sheet_url: sheetUrl } : { rows }) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'This could not be read.');
      importState = { rows, sheetUrl, headers: result.headers, map: result.map, fields: result.fields, total: result.total };
      renderSummary(result, label);
    } catch (error) { importError(error.message); }
    finally { ui.busy(false); }
  }
  function renderSummary(result, label) {
    const options = ['<option value="">— not in my file —</option>', ...result.headers.map((header, index) => `<option value="${index}">${escapeHtml(header || `Column ${index + 1}`)}</option>`)].join('');
    $('#mapping-rows').innerHTML = result.fields.map(field => `<label class="products-map"><span>${escapeHtml(FIELD_LABELS[field] || field)}${field === 'name' ? ' *' : ''}</span><select class="ui-select" data-map="${field}">${options}</select></label>`).join('');
    $('#mapping-rows').querySelectorAll('[data-map]').forEach(select => { const value = result.map[select.dataset.map]; select.value = value === undefined ? '' : String(value); });
    const found = result.map.name !== undefined;
    const summary = result.summary || { count: 0, names: [] };
    const used = Object.entries(result.map).map(([field, index]) => `${escapeHtml(result.headers[index] || '')} → ${escapeHtml(FIELD_LABELS[field] || field)}`).join(' · ');
    $('#import-summary').innerHTML = found
      ? `<div class="products-summary-head"><span class="products-summary-icon">✓</span><div><strong>${summary.count} product${summary.count === 1 ? '' : 's'} found in ${escapeHtml(label)}</strong><small>${result.total} row${result.total === 1 ? '' : 's'}${importState.sheetUrl ? ' · re-read every hour after importing' : ''}</small></div></div>
         <ul>${summary.names.map(item => `<li>${escapeHtml(item.name)}${item.variants ? ` <small>${item.variants} variants</small>` : ''}</li>`).join('')}${summary.count > summary.names.length ? `<li class="more">and ${summary.count - summary.names.length} more…</li>` : ''}</ul>
         ${result.map.currency === undefined ? `<label class="products-import-currency"><span>Currency of these prices</span><input class="ui-input" id="import-currency" maxlength="3" placeholder="e.g. USD" value="${escapeHtml(defaultCurrency())}"></label>` : ''}
         <p class="products-hint">Columns: ${used} <button type="button" class="ui-link" id="change-columns">Change</button></p>`
      : `<div class="products-summary-head warn"><span class="products-summary-icon">!</span><div><strong>Which column has the product name?</strong><small>We could not tell from the headers. Choose it below.</small></div></div>`;
    $('#import-summary').hidden = false;
    $('#import-mapping').hidden = found;
    $('#change-columns')?.addEventListener('click', () => { $('#import-mapping').hidden = false; $('#change-columns').remove(); });
    $('#import-run').disabled = false;
    $('#import-run').textContent = found && summary.count ? `Import ${summary.count} product${summary.count === 1 ? '' : 's'}` : 'Import';
  }
  $('#import-run').addEventListener('click', () => {
    const map = {}; $('#mapping-rows').querySelectorAll('[data-map]').forEach(select => { if (select.value !== '') map[select.dataset.map] = Number(select.value); });
    if (map.name === undefined) { $('#import-mapping').hidden = false; return importError('Choose which column has the product name.'); }
    const currencyInput = $('#import-currency');
    const currency = currencyInput ? currencyInput.value.trim().toUpperCase() : defaultCurrency();
    if (map.currency === undefined && !/^[A-Z]{3}$/.test(currency)) { currencyInput?.focus(); return importError('Add the currency of these prices as a 3-letter code, e.g. USD, EUR, GBP.'); }
    runImport({ rows: importState.rows, sheetUrl: importState.sheetUrl, map, currency });
  });
  async function runImport({ rows = null, sheetUrl = '', map, currency = '', quiet = false }) {
    ui.busy(sheetUrl ? 'Syncing your sheet…' : 'Importing…'); $('#import-run').disabled = true;
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-catalog-import', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'import', map, currency: currency || defaultCurrency(), ...(sheetUrl ? { sheet_url: sheetUrl } : { rows }) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'The import failed.');
      await load(); renderSettings(); render();
      if ($('#import-dialog').open) $('#import-dialog').close();
      ui.toast(`${result.products} products imported ✓${result.hidden ? ` · ${result.hidden} no longer in the sheet were hidden` : ''}`);
    } catch (error) { if (quiet) ui.toast(error.message, 'error'); else importError(error.message); }
    finally { ui.busy(false); $('#import-run').disabled = false; }
  }
  function importError(message) { const box = $('#import-error'); box.textContent = message; box.hidden = false; }

  // ---------- helpers ----------
  function friendlyError(code) { return ({ sheet_not_shared: 'the sheet is not shared with "anyone with the link"', excel_not_shared: 'the Excel file is not shared with "anyone with the link"', sheet_link_invalid: 'the link is not a Google Sheet or Excel file', xlsx_invalid: 'the link is not an Excel (.xlsx) file', sheet_too_large: 'the sheet is too large' })[code] || 'the sheet could not be read'; }
  function parsePrice(value) { const text = String(value ?? '').replace(/[^\d.,]/g, ''); if (!text) return null; const normalized = /,\d{1,2}$/.test(text) && !/\.\d/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, ''); const number = Number(normalized); return Number.isFinite(number) ? Math.round(number * 100) / 100 : null; }
  function parseStock(value) { if (String(value ?? '').trim() === '') return null; const number = Number(String(value).replace(/[^\d-]/g, '')); return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : null; }
  function formatPrice(value) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function toBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('The photo could not be read.')); reader.readAsDataURL(file); }); }
  function fail(message) { $('#products-loading').hidden = true; const box = $('#products-error'); box.textContent = message; box.hidden = false; }
  function safeColor(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : ''; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
})();
