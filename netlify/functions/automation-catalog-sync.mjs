import { rows, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';
import { fetchSheetRows, importProducts, rowsToProducts } from '../../lib/automation/catalog.mjs';
import { isInternalCall, isScheduledRun } from '../../lib/automation/schedule.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

// Every hour: re-reads each connected Google Sheet or Excel file (OneDrive / SharePoint) so prices, stock and new products follow the owner's sheet.
export async function handler(event) {
  if (!isScheduledRun(event) && !isInternalCall(event)) return json(401, { error: 'unauthorized' });
  const sources = rows(await supabaseRequest('/rest/v1/automation_product_sources?kind=in.(google_sheet,excel_online)&status=in.(active,error)&select=*&order=last_synced_at.asc.nullsfirst&limit=40'));
  const results = [];
  for (const source of sources) {
    try {
      const [headers, ...data] = await fetchSheetRows(source.url);
      if (!headers) throw new Error('sheet_empty');
      const products = rowsToProducts(data.slice(0, 5000), source.column_map || {}, { defaultCurrency: /^[A-Z]{3}$/.test(String(source.column_map?._currency || '')) ? source.column_map._currency : 'USD' });
      const result = await importProducts({ businessId: source.business_id, products, source: source.kind, replaceSource: true });
      await serviceUpdate('automation_product_sources', `id=eq.${source.id}`, { status: 'active', last_synced_at: new Date().toISOString(), last_error: null, last_count: products.length, updated_at: new Date().toISOString() });
      results.push({ id: source.id, ok: true, ...result });
    } catch (error) {
      await serviceUpdate('automation_product_sources', `id=eq.${source.id}`, { status: 'error', last_error: String(error?.message || 'sync_failed').slice(0, 1000), updated_at: new Date().toISOString() }).catch(() => null);
      results.push({ id: source.id, ok: false, error: error?.message });
    }
  }
  return json(200, { ok: true, synced: results.length, results });
}
