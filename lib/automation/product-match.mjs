// Photo → exact catalog product. The customer's photo is compared image-to-image with the owner's product photos
// (Gemini), not through a text description, so similar products and variants (colours, sizes) are told apart.
// Returns one line for the AI, e.g. "Catalog match: Oslo sofa — Grey (high confidence). Also similar: Oslo 3-seat.",
// or '' when the catalog is off, has no photos, or anything fails (the normal description is still used).
import * as db from './db.mjs';
import { downloadMedia, geminiGenerate, MEDIA_BUCKET } from './media.mjs';
import { productRef, scoreProduct, searchWords } from './catalog.mjs';

const MAX_CANDIDATES = 10;
// Gemini accepts about 20 MB per request (inline files); a customer video leaves less room for product photos.
const REQUEST_BUDGET = 19 * 1024 * 1024;
const enc = value => encodeURIComponent(String(value));

async function loadProductPhoto(photo, fetchImpl) {
  if (photo?.url) return downloadMedia({ url: photo.url, kind: 'image', fetchImpl }).catch(() => null);
  if (!photo?.path) return null;
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
  return downloadMedia({ url: `${base}/storage/v1/object/${MEDIA_BUCKET}/${photo.path}`, token: key, kind: 'image', fetchImpl }).catch(() => null);
}

export function chooseCandidates(products = [], text = '', limit = MAX_CANDIDATES) {
  const withPhotos = products.filter(product => Array.isArray(product.photos) && product.photos.length);
  if (withPhotos.length <= limit) return withPhotos;
  const words = searchWords(text);
  return withPhotos.map(product => ({ product, score: scoreProduct(product, words) })).sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.product);
}

export function matchLine(result, byRef) {
  const match = result?.match_ref ? byRef.get(String(result.match_ref)) : null;
  const similar = (Array.isArray(result?.similar_refs) ? result.similar_refs : []).map(ref => byRef.get(String(ref))).filter(item => item && item !== match).slice(0, 3);
  const confidence = ['high', 'medium', 'low'].includes(result?.confidence) ? result.confidence : 'low';
  if (!match) return similar.length ? `Catalog: no exact product match. Closest products: ${similar.map(item => `${item.name} (ref ${productRef(item)})`).join(', ')} — ask the customer which one they mean.` : 'Catalog: no product in the catalog matches this photo.';
  const variant = result.variant && (match.variants || []).some(item => String(item.name).toLocaleLowerCase() === String(result.variant).toLocaleLowerCase()) ? ` — ${result.variant}` : '';
  const advice = confidence === 'high' ? '' : ' Confirm with the customer before quoting.';
  return `Catalog match: ${match.name}${variant} (ref ${productRef(match)}, ${confidence} confidence).${similar.length ? ` Also similar: ${similar.map(item => `${item.name} (ref ${productRef(item)})`).join(', ')}.` : ''}${advice} Call search_products with this name for the exact price, variants and stock.`;
}

export async function matchProductPhoto({ businessId, buffer, mimeType = 'image/jpeg', description = '', caption = '' }, overrides = {}) {
  const d = { first: db.first, supabaseRequest: db.supabaseRequest, rows: db.rows, fetchImpl: fetch, ...overrides };
  try {
    if (!businessId || !buffer?.length || buffer.length > REQUEST_BUDGET - 512 * 1024) return '';
    const catalog = await d.first(`/rest/v1/automation_tool_configs?business_id=eq.${enc(businessId)}&tool_type=eq.catalog&select=enabled&limit=1`).catch(() => null);
    if (!catalog?.enabled) return '';
    const products = d.rows(await d.supabaseRequest(`/rest/v1/automation_products?business_id=eq.${enc(businessId)}&active=eq.true&select=id,name,category,description,variants,photos&limit=500`));
    const candidates = chooseCandidates(products, `${description} ${caption}`);
    if (!candidates.length) return '';
    const isVideo = String(mimeType).startsWith('video/');
    const parts = [{ text: `CUSTOMER ${isVideo ? 'VIDEO' : 'PHOTO'} (what the customer sent or shared):` }, { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }];
    const byRef = new Map();
    let images = 0, bytes = buffer.length;
    for (const product of candidates) {
      const photos = product.photos.slice(0, 2);
      const files = (await Promise.all(photos.map(photo => loadProductPhoto(photo, d.fetchImpl)))).filter(Boolean).filter(file => (bytes + file.buffer.length <= REQUEST_BUDGET) && (bytes += file.buffer.length));
      if (!files.length) continue;
      byRef.set(productRef(product), product);
      const variants = (product.variants || []).map(item => item.name).filter(Boolean).slice(0, 12);
      parts.push({ text: `PRODUCT ref ${productRef(product)}: ${product.name}${product.category ? ` (${product.category})` : ''}${variants.length ? `. Variants: ${variants.join(', ')}` : ''}${photos.some(photo => photo.variant) ? `. Photo variants: ${photos.map(photo => photo.variant || 'main').join(', ')}` : ''}` });
      for (const file of files) { parts.push({ inline_data: { mime_type: file.mimeType, data: file.buffer.toString('base64') } }); images++; }
      if (images >= 16) break;
    }
    if (!byRef.size) return '';
    parts.push({ text: `Compare the CUSTOMER ${isVideo ? 'VIDEO (look at every product shown in it; pick the main one)' : 'PHOTO'} with the PRODUCT photos. Is it the same item as one product (same model/design, not just the same type)? If the product has variants, which colour or size does the customer ${isVideo ? 'video' : 'photo'} show? Reply with JSON only: {"match_ref": "<ref or null>", "variant": "<variant name or null>", "confidence": "high" | "medium" | "low", "similar_refs": ["<other refs that look alike>"], "reason": "<short>"}. Use null for match_ref if none is clearly the same item.` });
    const result = await geminiGenerate({ parts, json: true, fetchImpl: d.fetchImpl, label: 'product photo match' });
    if (!result?.text) return '';
    let parsed; try { parsed = JSON.parse(result.text.replace(/^```(?:json)?|```$/g, '').trim()); } catch (_) { return ''; }
    return matchLine(parsed, byRef);
  } catch (error) {
    console.warn('product photo match failed', { message: error?.message });
    return '';
  }
}
