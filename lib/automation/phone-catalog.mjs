import { rows, supabaseRequest } from './db.mjs';
import { productForAi } from './catalog.mjs';

// A small, fresh catalog snapshot avoids a model/tool/model round trip for
// common product questions. Orders still go through the normal validation.
export async function phoneCatalogBrief(businessId, { request = supabaseRequest, timeoutMs = 800 } = {}) {
  let timer;
  try {
    const resource = `/rest/v1/automation_products?business_id=eq.${encodeURIComponent(businessId)}&active=eq.true&select=id,name,description,category,price,currency,stock,variants&order=name.asc&limit=13`;
    const data = await Promise.race([request(resource), new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
    if (!data) return '';
    const products = [];
    for (const row of rows(data).slice(0, 12)) {
      const { photos, payment_link, ...facts } = row;
      const product = productForAi(facts);
      if (!product.ref || !product.name) continue;
      if (JSON.stringify([...products, product]).length > 5500) break;
      products.push(product);
    }
    if (!products.length) return '';
    return `## Verified catalog at call start\nThese facts were fetched from this business's active catalog immediately before this call. For a product and detail present below, use these verified facts directly instead of calling search_products again. Search for products or details missing here; this is a limited snapshot, so absence does not mean unavailable. Refresh stock before promising a quantity. Always use create_order for an order; its live stock and business checks remain required.\n${JSON.stringify(products)}`;
  } catch { return ''; }
  finally { clearTimeout(timer); }
}
