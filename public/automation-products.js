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
      products = [{ id: 'p1', name: 'Oslo sofa', category: 'Sofas', price: 120000, currency: 'AMD', stock: 2, variants: [{ name: 'Grey', price: 120000, stock: 2 }, { name: 'Blue', price: 125000, stock: 0 }], photos: [], active: true, description: 'Two-seat sofa' }, { id: 'p2', name: 'Desk lamp', category: 'Lighting', price: 9000, currency: 'AMD', stock: null, variants: [], photos: [], active: true, description: '' }];
      catalog = { enabled: true, config: { reduce_stock: false } }; return;
    }
    const [list, tool, sheet] = await Promise.all([
      api.db.from('automation_products').select('*').eq('business_id', businessId).order('name', { ascending: true }).limit(2000),
      api.db.from('automation_tool_configs').select('id,enabled,config').eq('business_id', businessId).eq('tool_type', 'catalog').maybeSingle(),
      api.db.from('automation_product_sources').select('*').eq('business_id', businessId).eq('kind', 'google_sheet').maybeSingle()
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
      status.innerHTML = `<span data-icon="refresh"></span><span><strong>Google Sheet connected</strong><small>${source.status === 'error' ? `Last sync failed: ${escapeHtml(friendlyError(source.last_error))}` : `Synced ${source.last_synced_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(source.last_synced_at)) : 'soon'} · ${source.last_count ?? 0} products · re-read every hour`}</small></span><button class="ui-btn ghost sm" id="sheet-sync-now" type="button">Sync now</button><button class="ui-btn ghost sm" id="sheet-disconnect" type="button">Disconnect</button>`;
      $('#sheet-sync-now').addEventListener('click', () => runImport({ sheetUrl: source.url, map: source.column_map, quiet: true }));
      $('#sheet-disconnect').addEventListener('click', async () => {
        if (!confirm('Stop syncing this Google Sheet? Products already imported stay.')) return;
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
        <span class="products-item-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml([item.category, item.variants?.length ? `${item.variants.length} variants` : ''].filter(Boolean).join(' · '))}</small></span>
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
    holders.forEach(el => { const value = el.dataset.photo; const url = /^https:\/\//.test(value) ? value : photoUrls.get(value); if (url && !el.querySelector('img')) el.innerHTML = `<img src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`; });
  }

  // ---------- editor ----------
  $('#add-product').addEventListener('click', () => openEditor(null));
  function openEditor(product) {
    editing = product ? JSON.parse(JSON.stringify(product)) : { id: api.isLocalPreview ? `p${Date.now()}` : crypto.randomUUID(), isNew: true, name: '', description: '', category: '', sku: '', price: null, currency: products[0]?.currency || 'USD', stock: null, variants: [], photos: [], active: true };
    $('#product-title').textContent = product ? 'Edit product' : 'Add product';
    $('#p-name').value = editing.name; $('#p-price').value = editing.price ?? ''; $('#p-currency').value = editing.currency || 'USD'; $('#p-stock').value = editing.stock ?? '';
    $('#p-category').value = editing.category || ''; $('#p-sku').value = editing.sku || ''; $('#p-description').value = editing.description || ''; $('#p-active').checked = editing.active !== false;
    $('#delete-product').hidden = Boolean(editing.isNew);
    renderVariants(); renderPhotos();
    $('#product-dialog').showModal(); setTimeout(() => $('#p-name').focus(), 30);
  }
  function renderVariants() {
    $('#variant-rows').innerHTML = editing.variants.map((variant, index) => `<div class="products-variant"><input class="ui-input" data-variant="${index}" data-key="name" placeholder="e.g. Grey / M" value="${escapeHtml(variant.name || '')}"><input class="ui-input" data-variant="${index}" data-key="price" inputmode="decimal" placeholder="Price" value="${variant.price ?? ''}"><input class="ui-input" data-variant="${index}" data-key="stock" inputmode="numeric" placeholder="Stock" value="${variant.stock ?? ''}"><button class="ui-btn ghost icon sm" type="button" data-remove-variant="${index}" aria-label="Remove variant">✕</button></div>`).join('') || '<p class="products-hint">No variants. Add them if the product comes in colours or sizes.</p>';
  }
  $('#add-variant').addEventListener('click', () => { readVariants(); editing.variants.push({ name: '', price: null, stock: null }); renderVariants(); $('#variant-rows').querySelector(`[data-variant="${editing.variants.length - 1}"]`)?.focus(); });
  $('#variant-rows').addEventListener('click', event => { const button = event.target.closest('[data-remove-variant]'); if (!button) return; readVariants(); editing.variants.splice(Number(button.dataset.removeVariant), 1); renderVariants(); });
  function readVariants() { $('#variant-rows').querySelectorAll('[data-variant]').forEach(input => { const variant = editing.variants[Number(input.dataset.variant)]; if (!variant) return; const value = input.value.trim(); variant[input.dataset.key] = input.dataset.key === 'name' ? value : input.dataset.key === 'price' ? parsePrice(value) : parseStock(value); }); }
  function renderPhotos() {
    $('#photo-rows').innerHTML = editing.photos.map((photo, index) => `<span class="products-photo" data-photo="${escapeHtml(photo.path || photo.url || '')}"><button type="button" data-remove-photo="${index}" aria-label="Remove photo">✕</button></span>`).join('') || '<p class="products-hint">No photos yet.</p>';
    loadPhotos($('#photo-rows'));
  }
  $('#photo-rows').addEventListener('click', event => { const button = event.target.closest('[data-remove-photo]'); if (!button) return; const [removed] = editing.photos.splice(Number(button.dataset.removePhoto), 1); (editing.removedPhotos ||= []).push(removed); renderPhotos(); });
  $('#p-photo').addEventListener('change', async event => {
    const files = [...event.target.files].slice(0, 8 - editing.photos.length); event.target.value = '';
    for (const file of files) {
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
  });
  $('#product-form').addEventListener('submit', async event => {
    event.preventDefault(); readVariants();
    const name = $('#p-name').value.trim();
    if (!name) { $('#p-name').focus(); return ui.toast('Give the product a name.', 'error'); }
    const currency = ($('#p-currency').value.trim() || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) { $('#p-currency').focus(); return ui.toast('Currency is a 3-letter code, e.g. USD, AMD, EUR.', 'error'); }
    const variants = editing.variants.filter(variant => variant.name).map(variant => ({ name: variant.name.slice(0, 200), price: variant.price, stock: variant.stock }));
    let stock = parseStock($('#p-stock').value);
    if (variants.length && variants.every(variant => Number.isInteger(variant.stock))) stock = variants.reduce((sum, variant) => sum + variant.stock, 0);
    const row = { business_id: businessId, name: name.slice(0, 300), price: parsePrice($('#p-price').value), currency, stock, category: $('#p-category').value.trim().slice(0, 200), sku: $('#p-sku').value.trim().slice(0, 120), description: $('#p-description').value.trim().slice(0, 5000), variants, photos: editing.photos.slice(0, 8), active: $('#p-active').checked, updated_at: new Date().toISOString() };
    const save = $('#save-product'); save.disabled = true;
    try {
      if (!api.isLocalPreview) {
        const result = editing.isNew ? await api.db.from('automation_products').insert({ id: editing.id, ...row }).select('*').single() : await api.db.from('automation_products').update(row).eq('id', editing.id).eq('business_id', businessId).select('*').single();
        if (result.error) throw result.error;
        const removed = (editing.removedPhotos || []).map(photo => photo.path).filter(Boolean);
        if (removed.length) api.authenticatedFetch('/.netlify/functions/automation-product-photo', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'delete', paths: removed }) }).catch(() => {});
        Object.assign(row, result.data);
      }
      const index = products.findIndex(item => item.id === editing.id);
      if (index >= 0) products[index] = { ...products[index], ...row }; else products.push({ id: editing.id, ...row });
      products.sort((a, b) => a.name.localeCompare(b.name));
      await ensureCatalogOn();
      $('#product-dialog').close(); render(); ui.toast('Product saved.');
    } catch (error) { ui.toast(api.displayError(error), 'error'); }
    finally { save.disabled = false; }
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
  $('#open-import').addEventListener('click', () => { importState = null; $('#import-mapping').hidden = true; $('#import-error').hidden = true; $('#import-run').disabled = true; $('#import-file').value = ''; $('#sheet-url').value = source?.url || ''; $('#import-dialog').showModal(); });
  document.querySelectorAll('[data-import-tab]').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('[data-import-tab]').forEach(item => item.classList.toggle('active', item === tab));
    document.querySelectorAll('[data-import-pane]').forEach(pane => { pane.hidden = pane.dataset.importPane !== tab.dataset.importTab; });
    importState = null; $('#import-mapping').hidden = true; $('#import-run').disabled = true; $('#import-error').hidden = true;
  }));
  $('#import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 8 * 1024 * 1024) return importError('The file is larger than 8 MB.');
    try {
      if (!window.XLSX) throw new Error('The spreadsheet reader did not load. Refresh the page and try again.');
      const book = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }).filter(row => row.some(cell => String(cell).trim() !== '')).slice(0, 5001);
      await preview({ rows });
    } catch (error) { importError(error.message || 'This file could not be read.'); }
  });
  $('#sheet-load').addEventListener('click', () => { const url = $('#sheet-url').value.trim(); if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(url)) return importError('Paste a Google Sheets link (https://docs.google.com/spreadsheets/…).'); preview({ sheetUrl: url }); });
  async function preview({ rows = null, sheetUrl = '' }) {
    $('#import-error').hidden = true;
    if (api.isLocalPreview) return importError('Import is disabled in preview.');
    ui.busy('Reading…');
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-catalog-import', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'preview', ...(sheetUrl ? { sheet_url: sheetUrl } : { rows }) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'This could not be read.');
      importState = { rows, sheetUrl, headers: result.headers, map: result.map, fields: result.fields, total: result.total };
      renderMapping(result);
    } catch (error) { importError(error.message); }
    finally { ui.busy(false); }
  }
  function renderMapping(result) {
    const options = ['<option value="">— not in my file —</option>', ...result.headers.map((header, index) => `<option value="${index}">${escapeHtml(header || `Column ${index + 1}`)}</option>`)].join('');
    $('#mapping-rows').innerHTML = result.fields.map(field => `<label class="products-map"><span>${escapeHtml(FIELD_LABELS[field] || field)}${field === 'name' ? ' *' : ''}</span><select class="ui-select" data-map="${field}">${options}</select></label>`).join('');
    $('#mapping-rows').querySelectorAll('[data-map]').forEach(select => { const value = result.map[select.dataset.map]; select.value = value === undefined ? '' : String(value); });
    $('#import-preview').textContent = `${result.total} rows found.${importState.sheetUrl ? ' After importing, the sheet is re-read every hour.' : ''}`;
    $('#import-mapping').hidden = false; $('#import-run').disabled = false;
  }
  $('#import-run').addEventListener('click', () => {
    const map = {}; $('#mapping-rows').querySelectorAll('[data-map]').forEach(select => { if (select.value !== '') map[select.dataset.map] = Number(select.value); });
    if (map.name === undefined) return importError('Choose which column has the product name.');
    runImport({ rows: importState.rows, sheetUrl: importState.sheetUrl, map });
  });
  async function runImport({ rows = null, sheetUrl = '', map, quiet = false }) {
    ui.busy(sheetUrl ? 'Syncing your sheet…' : 'Importing…'); $('#import-run').disabled = true;
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-catalog-import', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'import', map, currency: products[0]?.currency || 'USD', ...(sheetUrl ? { sheet_url: sheetUrl } : { rows }) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'The import failed.');
      await load(); renderSettings(); render();
      if ($('#import-dialog').open) $('#import-dialog').close();
      ui.toast(`${result.products} products imported${result.hidden ? `, ${result.hidden} no longer in the sheet were hidden` : ''}.`);
    } catch (error) { if (quiet) ui.toast(error.message, 'error'); else importError(error.message); }
    finally { ui.busy(false); $('#import-run').disabled = false; }
  }
  function importError(message) { const box = $('#import-error'); box.textContent = message; box.hidden = false; }

  // ---------- helpers ----------
  function friendlyError(code) { return ({ sheet_not_shared: 'the sheet is not shared with "anyone with the link"', sheet_link_invalid: 'the link is not a Google Sheet', sheet_too_large: 'the sheet is too large' })[code] || 'the sheet could not be read'; }
  function parsePrice(value) { const text = String(value ?? '').replace(/[^\d.,]/g, ''); if (!text) return null; const normalized = /,\d{1,2}$/.test(text) && !/\.\d/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, ''); const number = Number(normalized); return Number.isFinite(number) ? Math.round(number * 100) / 100 : null; }
  function parseStock(value) { if (String(value ?? '').trim() === '') return null; const number = Number(String(value).replace(/[^\d-]/g, '')); return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : null; }
  function formatPrice(value) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function toBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('The photo could not be read.')); reader.readAsDataURL(file); }); }
  function fail(message) { $('#products-loading').hidden = true; const box = $('#products-error'); box.textContent = message; box.hidden = false; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
})();
