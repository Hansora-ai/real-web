import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { first, serviceUpsert } from '../../lib/automation/db.mjs';
import { fetchSheetRows, googleSheetCsvUrl, guessColumnMap, importProducts, rowsToProducts, CATALOG_FIELDS } from '../../lib/automation/catalog.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const MESSAGES = { sheet_link_invalid: 'This is not a Google Sheets link.', sheet_not_shared: 'The sheet is not shared. In Google Sheets choose Share → Anyone with the link → Viewer, then try again.', sheet_too_large: 'The sheet is too large (over 5 MB).' };

// Products page import. action "preview": headers, a few rows and a guessed column map. action "import": saves.
// Rows come from the browser (a spreadsheet file read there) or from a Google Sheet link (read here).
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const business = await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
    if (!business) return json(404, { error: 'business_not_found' });
    const sheetUrl = String(body.sheet_url || '').trim();
    let rows;
    try { rows = sheetUrl ? await fetchSheetRows(sheetUrl) : (Array.isArray(body.rows) ? body.rows : []); }
    catch (error) { return json(error.status || 400, { error: error.message, message: MESSAGES[error.message] || 'The sheet could not be read.' }); }
    rows = rows.slice(0, 5001).map(row => (Array.isArray(row) ? row.slice(0, 60).map(cell => String(cell ?? '').slice(0, 5000)) : []));
    if (rows.length < 2) return json(400, { error: 'no_rows', message: 'The file needs a header row and at least one product row.' });
    const [headers, ...data] = rows;
    if (body.action === 'preview') return json(200, { headers, sample: data.slice(0, 5), total: data.length, map: guessColumnMap(headers), fields: CATALOG_FIELDS });
    if (body.action !== 'import') return json(400, { error: 'invalid_action' });
    const map = Object.fromEntries(Object.entries(body.map || {}).filter(([field, index]) => CATALOG_FIELDS.includes(field) && Number.isInteger(Number(index)) && index !== '' && Number(index) >= 0 && Number(index) < headers.length).map(([field, index]) => [field, Number(index)]));
    if (map.name === undefined) return json(400, { error: 'name_column_required', message: 'Choose which column has the product name.' });
    const products = rowsToProducts(data, map, { defaultCurrency: /^[A-Z]{3}$/.test(String(body.currency || '')) ? body.currency : 'USD' });
    if (!products.length) return json(400, { error: 'no_products', message: 'No product names were found in that column.' });
    const source = sheetUrl ? 'google_sheet' : 'import';
    const result = await importProducts({ businessId: business.id, products, source, replaceSource: Boolean(sheetUrl) });
    if (sheetUrl) await serviceUpsert('automation_product_sources', 'business_id,kind', { business_id: business.id, kind: 'google_sheet', url: googleSheetCsvUrl(sheetUrl) ? sheetUrl.slice(0, 2000) : '', column_map: map, status: 'active', last_synced_at: new Date().toISOString(), last_error: null, last_count: products.length, updated_at: new Date().toISOString() });
    // The AI starts using the catalog as soon as there are products (the owner can switch it off on the page).
    const catalog = await first(`/rest/v1/automation_tool_configs?business_id=eq.${business.id}&tool_type=eq.catalog&select=id&limit=1`);
    if (!catalog) await serviceUpsert('automation_tool_configs', 'business_id,tool_type', { business_id: business.id, tool_type: 'catalog', enabled: true, config: { reduce_stock: false } });
    return json(200, { ok: true, products: products.length, ...result });
  } catch (error) {
    console.error('automation-catalog-import error', { message: error?.message, status: error?.status, details: error?.details });
    return json(500, { error: 'import_failed', message: 'The import failed. Please try again.' });
  }
}
