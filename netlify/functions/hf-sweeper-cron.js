/**
 * netlify/functions/hf-sweeper-cron.js
 * Same logic, but uses `exports.schedule` instead of `exports.config`
 * (some CommonJS builds ignore `exports.config` for scheduled functions).
 */
const VERSION = "hf-sweeper-cron+v2-schedule";

// IMPORTANT: Scheduled config for CommonJS
exports.schedule = "*/1 * * * *"; // every minute

exports.handler = async () => {
  const base = process.env.SWEEPER_URL || (process.env.SITE_URL ? (process.env.SITE_URL.replace(/\/$/,'') + '/.netlify/functions/hf-sweeper') : null);

  if (!base) {
    return json(500, { ok:false, error:"missing SWEEPER_URL (or SITE_URL)", version: VERSION });
  }

  try{
    const r = await fetch(base, { method: "GET", headers: { "Accept": "application/json" } });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw:text }; }
    return json(200, { ok:true, downstream_status:r.status, downstream_body: body, version: VERSION });
  }catch(e){
    return json(200, { ok:false, error: String(e && e.message ? e.message : e), version: VERSION });
  }
};

function json(code, obj){
  return { statusCode: code, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(obj) };
}
