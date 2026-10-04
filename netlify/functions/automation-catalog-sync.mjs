import { rows, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';
import { fetchSheetRows, importProducts, rowsToProducts } from '../../lib/automation/catalog.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

// Every hour: re-reads each connected Google Sheet so prices, stock and new products follow the owner's sheet.
export async function handler(event) {
  const internal = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  const provided = String(event.headers?.['x-hansora-internal-secret'] || event.headers?.['X-Hansora-Internal-Secret'] || '');
  const scheduled = String(event.headers?.['x-nf-event'] || event.headers?.['X-Nf-Event'] || '') === 'schedule';
  if (!scheduled && !(internal.length >= 32 && provided === internal)) return json(401, { error: 'unauthorized' });
  const sources = rows(await supabaseRequest('/rest/v1/automation_product_sources?kind=eq.google_sheet&status=in.(active,error)&select=*&order=last_synced_at.asc.nullsfirst&limit=40'));
  const results = [];
  for (const source of sources) {
    try {
      const [headers, ...data] = await fetchSheetRows(source.url);
      if (!headers) throw new Error('sheet_empty');
      const products = rowsToProducts(data.slice(0, 5000), source.column_map || {});
      const result = await importProducts({ businessId: source.business_id, products, source: 'google_sheet', replaceSource: true });
      await serviceUpdate('automation_product_sources', `id=eq.${source.id}`, { status: 'active', last_synced_at: new Date().toISOString(), last_error: null, last_count: products.length, updated_at: new Date().toISOString() });
      results.push({ id: source.id, ok: true, ...result });
    } catch (error) {
      await serviceUpdate('automation_product_sources', `id=eq.${source.id}`, { status: 'error', last_error: String(error?.message || 'sync_failed').slice(0, 1000), updated_at: new Date().toISOString() }).catch(() => null);
      results.push({ id: source.id, ok: false, error: error?.message });
    }
  }
  return json(200, { ok: true, synced: results.length, results });
}
