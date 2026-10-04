// Product catalog: search for the AI, spreadsheet parsing and Google Sheets links. Products live in
// automation_products (one row per product; colours/sizes are variants with their own price and stock).
import * as db from './db.mjs';
import { readXlsxRows } from './xlsx.mjs';

const enc = value => encodeURIComponent(String(value));
const clean = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const CATALOG_FIELDS = ['name', 'price', 'description', 'category', 'sku', 'stock', 'currency', 'variant', 'variant_price', 'variant_stock', 'photo_url'];
export const FIELD_LABELS = { name: 'Product name', price: 'Price', description: 'Description', category: 'Category', sku: 'SKU / code', stock: 'Stock', currency: 'Currency', variant: 'Variant (colour, size…)', variant_price: 'Variant price', variant_stock: 'Variant stock', photo_url: 'Photo link' };

// Prices like "12 900", "12,900.50", "$49.99", "15000 ֏" → number, or null.
export function parsePrice(value) {
  const text = String(value ?? '').replace(/[^\d.,]/g, '');
  if (!text) return null;
  let normalized = text;
  if (/,\d{1,2}$/.test(text) && !/\.\d/.test(text)) normalized = text.replace(/\./g, '').replace(',', '.');
  else normalized = text.replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}
export function parseStock(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(String(value).replace(/[^\d-]/g, ''));
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : null;
}

// Minimal RFC 4180 CSV parser (quotes, commas, newlines inside quotes).
export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  const source = String(text || '').replace(/^﻿/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(field); field = '';
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some(cell => cell.trim() !== '')) rows.push(row);
  return rows;
}

// Guesses which column is which from the header names (English, Russian, Armenian).
export function guessColumnMap(headers = []) {
  const patterns = {
    name: /^(name|product|item|title|название|наименование|товар|անուն|անվանում|ապրանք)/i,
    price: /^(price|cost|цена|стоимость|գին|արժեք)/i,
    description: /^(description|details|описание|նկարագր)/i,
    category: /^(category|type|group|категория|կատեգոր|տեսակ)/i,
    sku: /^(sku|code|article|артикул|код|կոդ)/i,
    stock: /^(stock|qty|quantity|inventory|количество|остаток|наличие|քանակ|մնացորդ)/i,
    currency: /^(currency|валюта|արժույթ)/i,
    variant: /^(variant|option|size|colou?r|вариант|размер|цвет|չափս|գույն|տարբերակ)/i,
    photo_url: /^(photo|image|picture|img|фото|изображ|նկար)/i
  };
  const map = {};
  headers.forEach((header, index) => {
    const name = String(header || '').trim();
    for (const [field, pattern] of Object.entries(patterns)) if (map[field] === undefined && pattern.test(name)) { map[field] = index; break; }
  });
  return map;
}

// Rows + column map → products. Rows with the same product name become one product with variants.
export function rowsToProducts(rows = [], map = {}, { defaultCurrency = 'USD' } = {}) {
  const pick = (row, field) => (map[field] === undefined || map[field] === null || map[field] === '' ? '' : row[Number(map[field])]);
  const products = new Map();
  for (const row of rows) {
    const name = clean(pick(row, 'name'));
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const currencyRaw = clean(pick(row, 'currency'), 10).toUpperCase();
    const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : /֏|AMD|ДРАМ|ԴՐԱՄ/i.test(String(pick(row, 'price'))) ? 'AMD' : /€/.test(String(pick(row, 'price'))) ? 'EUR' : /₽/.test(String(pick(row, 'price'))) ? 'RUB' : defaultCurrency;
    if (!products.has(key)) {
      products.set(key, {
        external_key: key.slice(0, 300), name, description: clean(pick(row, 'description'), 5000), category: clean(pick(row, 'category'), 200), sku: clean(pick(row, 'sku'), 120),
        price: parsePrice(pick(row, 'price')), currency, stock: parseStock(pick(row, 'stock')), variants: [],
        photos: /^https:\/\//i.test(clean(pick(row, 'photo_url'), 1500)) ? [{ url: clean(pick(row, 'photo_url'), 1500) }] : []
      });
    }
    const product = products.get(key);
    const variant = clean(pick(row, 'variant'), 200);
    if (variant) {
      product.variants.push({ name: variant, price: parsePrice(pick(row, 'variant_price')) ?? parsePrice(pick(row, 'price')), stock: parseStock(pick(row, 'variant_stock')) ?? parseStock(pick(row, 'stock')) });
      const photo = clean(pick(row, 'photo_url'), 1500);
      if (/^https:\/\//i.test(photo) && !product.photos.some(item => item.url === photo)) product.photos.push({ url: photo, variant });
    }
  }
  // With variants, the product's own stock is the sum (if every variant has a number) and its price the lowest.
  for (const product of products.values()) {
    if (!product.variants.length) continue;
    const stocks = product.variants.map(item => item.stock);
    if (stocks.every(value => Number.isInteger(value))) product.stock = stocks.reduce((sum, value) => sum + value, 0);
    const prices = product.variants.map(item => item.price).filter(value => value !== null);
    if (prices.length) product.price = Math.min(...prices);
    product.photos = product.photos.slice(0, 8);
  }
  return [...products.values()].slice(0, 5000);
}

// A Google Sheets link (edit / share / published) → its CSV download link. Only Google Sheets links are accepted,
// so the server never fetches arbitrary addresses.
export function googleSheetCsvUrl(link) {
  let url; try { url = new URL(String(link || '').trim()); } catch (_) { return ''; }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return '';
  const published = url.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)\/pub/);
  if (published) { const gid = url.searchParams.get('gid'); return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gid ? `&gid=${enc(gid)}` : ''}`; }
  const id = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  if (!id) return '';
  const gid = url.searchParams.get('gid') || (url.hash.match(/gid=(\d+)/)?.[1] ?? '');
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${enc(gid)}` : ''}`;
}

const price = (value, currency) => (value === null || value === undefined ? null : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`);
export const productRef = product => String(product.id || '').slice(0, 8);

// What the AI sees for one product.
export function productForAi(product) {
  return {
    ref: productRef(product), name: product.name, ...(product.category ? { category: product.category } : {}),
    price: price(product.price, product.currency), stock: product.stock === null || product.stock === undefined ? 'not tracked' : product.stock,
    ...(Array.isArray(product.variants) && product.variants.length ? { variants: product.variants.slice(0, 30).map(item => ({ name: item.name, price: price(item.price ?? product.price, product.currency), stock: item.stock === null || item.stock === undefined ? 'not tracked' : item.stock })) } : {}),
    ...(product.description ? { description: String(product.description).slice(0, 300) } : {}),
    ...(Array.isArray(product.photos) && product.photos.length ? { photos: product.photos.length } : {}),
    ...(product.payment_link ? { payment_link: product.payment_link } : {})
  };
}

// Words worth searching for (any language), longest first.
export function searchWords(query) {
  return [...new Set(String(query || '').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 2))].sort((a, b) => b.length - a.length).slice(0, 6);
}

export function scoreProduct(product, words) {
  const name = String(product.name || '').toLocaleLowerCase();
  const rest = [product.category, product.sku, product.description, ...(product.variants || []).map(item => item.name)].join(' ').toLocaleLowerCase();
  return words.reduce((score, word) => score + (name.includes(word) ? 3 : 0) + (rest.includes(word) ? 1 : 0), 0);
}

// The AI's "search_products" action. Small catalogs (≤150 products) are searched in full, so a question in
// Armenian still finds an English product name; larger ones are pre-filtered in the database.
export async function searchProducts({ businessId, query = '', limit = 8 }, overrides = {}) {
  const d = { supabaseRequest: db.supabaseRequest, rows: db.rows, ...overrides };
  const words = searchWords(query);
  const base = 'id,name,description,category,sku,price,currency,stock,variants,photos';
  let select = `${base},payment_link`;
  const all = () => d.supabaseRequest(`/rest/v1/automation_products?business_id=eq.${enc(businessId)}&active=eq.true&select=${select}&order=name.asc&limit=151`);
  let candidates = d.rows(await all().catch(() => { select = base; return all(); }));
  const small = candidates.length <= 150;
  if (!small && words.length) {
    const filters = words.flatMap(word => ['name', 'description', 'category', 'sku'].map(column => `${column}.ilike.*${word.replace(/[,()*]/g, '')}*`)).join(',');
    candidates = d.rows(await d.supabaseRequest(`/rest/v1/automation_products?business_id=eq.${enc(businessId)}&active=eq.true&or=(${enc(filters)})&select=${select}&limit=200`));
  }
  const scored = candidates.map(product => ({ product, score: words.length ? scoreProduct(product, words) : 0 }));
  const matches = scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.product);
  if (matches.length) return { ok: true, products: matches.map(productForAi), note: 'Use only these exact names, prices, variants and stock. "not tracked" means the stock is unknown: do not promise a quantity.' };
  // Nothing matched the words (or no words): a small catalog is shown in short so the AI can recognise the item
  // even when the customer used another language or a different word.
  if (small && candidates.length) return { ok: true, products: candidates.slice(0, 60).map(product => ({ ref: productRef(product), name: product.name, price: price(product.price, product.currency), ...(product.category ? { category: product.category } : {}) })), note: 'No exact word match. This is the whole catalog: pick the item the customer means (it may be named in another language). Search again with its name to get variants and stock before confirming anything. If none fits, say you do not have it.' };
  return { ok: true, products: [], note: 'No product matches. Say you could not find it and ask for more details or offer a team member. Never invent a product.' };
}

// Stock is reduced once per confirmed order when the owner turned it on. items: [{ product_id, variant, quantity }].
// Changes stock for ordered items: sign -1 takes them out (order placed), +1 puts them back (order cancelled).
// A variant's stock changes with it; the product's stock follows (sum of variants, or its own number).
export async function adjustStockForOrder({ businessId, items = [], sign = -1 }, overrides = {}) {
  const d = { first: db.first, serviceUpdate: db.serviceUpdate, ...overrides };
  const changed = [];
  for (const item of items.slice(0, 50)) {
    const quantity = Math.max(1, Math.trunc(Number(item.quantity) || 1)) * (sign < 0 ? -1 : 1);
    const product = await d.first(`/rest/v1/automation_products?business_id=eq.${enc(businessId)}&id=eq.${enc(item.product_id)}&select=id,stock,variants&limit=1`);
    if (!product) continue;
    const variants = Array.isArray(product.variants) ? product.variants.map(variant => ({ ...variant })) : [];
    const variant = item.variant ? variants.find(entry => sameText(entry.name, item.variant)) : null;
    if (variant && Number.isInteger(variant.stock)) variant.stock = Math.max(0, variant.stock + quantity);
    const stock = variants.length && variants.every(entry => Number.isInteger(entry.stock)) ? variants.reduce((sum, entry) => sum + entry.stock, 0) : Number.isInteger(product.stock) ? Math.max(0, product.stock + quantity) : null;
    await d.serviceUpdate('automation_products', `id=eq.${product.id}`, { stock, variants, updated_at: new Date().toISOString() });
    changed.push(product.id);
  }
  return changed;
}
export const reduceStockForOrder = (args, overrides) => adjustStockForOrder({ ...args, sign: -1 }, overrides);
export const restoreStockForOrder = (args, overrides) => adjustStockForOrder({ ...args, sign: 1 }, overrides);

const ORDER_SELECT = 'id,name,active,stock,variants,price,currency';
const sameText = (a, b) => String(a ?? '').trim().toLocaleLowerCase() === String(b ?? '').trim().toLocaleLowerCase();

// "ab12cd34 x2, ef56gh78 (Grey) x1" (refs from search_products) → items with full product ids, checked against the
// catalog: the product must be on sale, the variant must exist, and tracked stock must cover the quantity. Anything
// wrong comes back in problems (for the AI to tell the customer) instead of being ordered.
export async function resolveOrderItems({ businessId, text }, overrides = {}) {
  const d = { first: db.first, ...overrides };
  const items = [], problems = [];
  for (const part of String(text || '').split(/[,;\n]+/).map(value => value.trim()).filter(Boolean).slice(0, 30)) {
    const match = part.match(/^([0-9a-f]{8})\s*(?:\(([^)]{1,200})\))?\s*(?:[x×*]\s*(\d{1,4}))?$/i);
    if (!match) { problems.push(`"${part.slice(0, 80)}" is not in the "ref (variant) xQuantity" form`); continue; }
    const lookup = select => d.first(`/rest/v1/automation_products?business_id=eq.${enc(businessId)}&id=gte.${match[1]}-0000-0000-0000-000000000000&id=lte.${match[1]}-ffff-ffff-ffff-ffffffffffff&select=${select}&limit=1`);
    // payment_link arrives with SQL 12; until then the lookup works without it.
    const product = await lookup(`${ORDER_SELECT},payment_link`).catch(() => lookup(ORDER_SELECT)).catch(() => null);
    if (!product || product.active === false) { problems.push(`ref ${match[1]} is not a product on sale`); continue; }
    const quantity = Math.max(1, Number(match[3] || 1));
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const wanted = match[2] ? match[2].trim() : '';
    let variant = null;
    if (wanted) {
      variant = variants.find(entry => sameText(entry.name, wanted)) || null;
      if (!variant) { problems.push(`${product.name} does not come in "${wanted}"${variants.length ? `; it comes in: ${variants.map(entry => entry.name).join(', ')}` : ''}`); continue; }
    } else if (variants.length > 1) { problems.push(`${product.name}: ask which one (${variants.map(entry => entry.name).join(', ')})`); continue; }
    else if (variants.length === 1) variant = variants[0];
    const stock = variant ? variant.stock : product.stock;
    if (Number.isInteger(stock) && stock < quantity) { problems.push(stock === 0 ? `${product.name}${variant ? ` (${variant.name})` : ''} is out of stock` : `only ${stock} of ${product.name}${variant ? ` (${variant.name})` : ''} left`); continue; }
    items.push({ product_id: product.id, name: product.name, variant: variant ? variant.name : '', quantity, ...(product.payment_link ? { payment_link: product.payment_link } : {}) });
  }
  return { items, problems };
}

// Saves imported products (spreadsheet or Google Sheet). Matched by name (external_key): existing ones are updated,
// new ones added; photos the owner uploaded are kept when the sheet has none. With replaceSource, products that
// came from that source and are no longer in it are hidden (not deleted).
export async function importProducts({ businessId, products = [], source = 'import', replaceSource = false }, overrides = {}) {
  const d = { supabaseRequest: db.supabaseRequest, rows: db.rows, ...overrides };
  const now = new Date().toISOString();
  const base = product => ({ business_id: businessId, external_key: product.external_key, name: product.name, description: product.description || '', category: product.category || '', sku: product.sku || '', price: product.price, currency: product.currency || 'USD', stock: product.stock, variants: product.variants || [], active: true, source, updated_at: now });
  const withPhotos = products.filter(product => product.photos?.length).map(product => ({ ...base(product), photos: product.photos }));
  const withoutPhotos = products.filter(product => !product.photos?.length).map(base);
  let saved = 0;
  for (const group of [withPhotos, withoutPhotos]) {
    for (let index = 0; index < group.length; index += 200) {
      const chunk = group.slice(index, index + 200);
      const result = await d.supabaseRequest('/rest/v1/automation_products?on_conflict=business_id,external_key', { method: 'POST', body: chunk, prefer: 'resolution=merge-duplicates,return=minimal' });
      saved += chunk.length; void result;
    }
  }
  let hidden = 0;
  if (replaceSource) {
    const keep = new Set(products.map(product => product.external_key));
    const existing = d.rows(await d.supabaseRequest(`/rest/v1/automation_products?business_id=eq.${enc(businessId)}&source=eq.${enc(source)}&active=eq.true&select=id,external_key&limit=10000`));
    const gone = existing.filter(row => !keep.has(row.external_key)).map(row => row.id);
    for (let index = 0; index < gone.length; index += 100) {
      await d.supabaseRequest(`/rest/v1/automation_products?business_id=eq.${enc(businessId)}&id=in.(${gone.slice(index, index + 100).join(',')})`, { method: 'PATCH', body: { active: false, updated_at: now }, prefer: 'return=minimal' });
    }
    hidden = gone.length;
  }
  return { saved, hidden };
}

// Excel in OneDrive or SharePoint, shared "anyone with the link": the file itself is downloaded and read. Only
// Microsoft addresses are fetched (also on every redirect), so the server never fetches arbitrary addresses.
const MICROSOFT_HOSTS = [/^1drv\.ms$/, /^onedrive\.live\.com$/, /^([a-z0-9-]+\.)*onedrive\.com$/, /^[a-z0-9-]+(-my)?\.sharepoint\.com$/, /^([a-z0-9-]+\.)*1drv\.com$/, /^([a-z0-9-]+\.)*livefilestore\.com$/, /^([a-z0-9-]+\.)*microsoftpersonalcontent\.com$/, /^([a-z0-9-]+\.)*svc\.ms$/];
const microsoftHost = host => MICROSOFT_HOSTS.some(pattern => pattern.test(String(host).toLowerCase()));
export function excelOnlineLink(link) {
  let url; try { url = new URL(String(link || '').trim()); } catch (_) { return ''; }
  return url.protocol === 'https:' && microsoftHost(url.hostname) ? url.toString() : '';
}
export function sheetSourceKind(link) { return googleSheetCsvUrl(link) ? 'google_sheet' : excelOnlineLink(link) ? 'excel_online' : ''; }
// Ways to get the file from a share link: the link with download=1, then the OneDrive "shares" API.
export function excelDownloadCandidates(link) {
  const base = excelOnlineLink(link); if (!base) return [];
  const direct = new URL(base); direct.searchParams.set('download', '1');
  const encoded = Buffer.from(base).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  return [direct.toString(), ...(/sharepoint\.com$/i.test(new URL(base).hostname) ? [] : [`https://api.onedrive.com/v1.0/shares/u!${encoded}/root/content`])];
}
async function fetchMicrosoft(url, fetchImpl, hops = 0) {
  if (hops > 6 || !microsoftHost(new URL(url).hostname)) throw Object.assign(new Error('sheet_link_invalid'), { status: 400 });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  const response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal }).finally(() => clearTimeout(timer));
  const next = response.headers.get('location');
  if (response.status >= 300 && response.status < 400 && next) return fetchMicrosoft(new URL(next, url).toString(), fetchImpl, hops + 1);
  return response;
}
export async function fetchExcelOnlineRows(link, fetchImpl = fetch) {
  for (const url of excelDownloadCandidates(link)) {
    const response = await fetchMicrosoft(url, fetchImpl).catch(() => null);
    if (!response?.ok) continue;
    if (Number(response.headers.get('content-length') || 0) > 20_000_000) throw Object.assign(new Error('sheet_too_large'), { status: 413 });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 20_000_000) throw Object.assign(new Error('sheet_too_large'), { status: 413 });
    if (buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50) return readXlsxRows(buffer);
  }
  throw Object.assign(new Error('excel_not_shared'), { status: 400 });
}

// Reads a Google Sheet or an Excel file in OneDrive/SharePoint (shared "anyone with the link") as rows.
export async function fetchSheetRows(link, fetchImpl = fetch) {
  if (!googleSheetCsvUrl(link) && excelOnlineLink(link)) return fetchExcelOnlineRows(link, fetchImpl);
  const url = googleSheetCsvUrl(link);
  if (!url) throw Object.assign(new Error('sheet_link_invalid'), { status: 400 });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  const response = await fetchImpl(url, { redirect: 'follow', signal: controller.signal }).finally(() => clearTimeout(timer));
  const type = String(response.headers.get('content-type') || '');
  if (!response.ok || type.includes('text/html')) throw Object.assign(new Error('sheet_not_shared'), { status: 400 });
  const text = await response.text();
  if (text.length > 5_000_000) throw Object.assign(new Error('sheet_too_large'), { status: 413 });
  return parseCsv(text);
}
