// netlify/functions/nb-check.js
// Purpose: Report KIE job status for Nano Banana & MJ.
// Surgical fix: call the primary KIE task endpoint exactly like the console test,
// and treat 'failed' / 'failure' / code >= 400 (e.g., 422) as terminal failure.
// Keep previous behavior and DB-success fallback intact. No unrelated changes.

const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/+$/,'')
const KIE_KEY  = process.env.KIE_API_KEY

const SUPABASE_URL  = process.env.SUPABASE_URL || ''
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Hosts whitelist to avoid rendering arbitrary URLs
const ALLOWED_HOSTS = new Set(['tempfile.aiquickdraw.com', 'tempfile.redpandaai.co'])

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' }
    if (event.httpMethod !== 'GET')     return { statusCode: 405, headers: cors(), body: 'Use GET' }

    const qs = event.queryStringParameters || {}
    const taskId = (qs.taskId || qs.task_id || '').trim()
    if (!taskId) return json(400, { ok:false, error:'missing taskId' })

    const uid    = header(event, 'x-user-id') || qs.uid || null
    const run_id = (qs.run_id || '').trim() || null

    // 1) Primary: exact console-style KIE endpoint
    const probe1 = await fetchPrimary(taskId)

    if (probe1.status === 'success') {
      const images = probe1.images
      if (images.length) {
        await backfillAll({ uid, run_id, taskId, images }).catch(()=>{})
        return json(200, { ok:true, status:'success', image_url: images[0], images })
      }
    }
    if (probe1.status === 'failed') {
      return json(200, { ok:false, status:'failed', error: probe1.error || undefined, code: probe1.code || undefined })
    }

    // 2) Legacy multi-endpoint probe (kept for compatibility/persistence)
    const probe2 = await fetchAll(taskId)

    if (probe2.ok) {
      const images = firstImageUrls(probe2.data, 4)
      if (images.length) {
        await backfillAll({ uid, run_id, taskId, images }).catch(()=>{})
        return json(200, { ok:true, status:'success', image_url: images[0], images })
      }
    }
    if (probe2.status === 'failed') {
      return json(200, { ok:false, status:'failed' })
    }

    // 3) DB fallback for success
    const imagesFromDB = await dbImagesByTask(taskId, 4)
    if (imagesFromDB.length) {
      return json(200, { ok:true, status:'success', image_url: imagesFromDB[0], images: imagesFromDB })
    }

    // Still pending
    return json(200, { ok:false, status:'pending' })

  } catch (e) {
    return json(200, { ok:false, error: String(e) })
  }
}

// ---------- helpers ----------
function cors(){ return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' } }
function json(code, obj){ return { statusCode: code, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(obj) } }
function header(event, name){ const v = event.headers?.[name] || event.headers?.[name?.toLowerCase?.()] ; return Array.isArray(v) ? v[0] : v }
function kieHeaders(){ return { 'Authorization': `Bearer ${KIE_KEY}`, 'Accept': 'application/json' } }

// Primary endpoint: exactly like the console test
async function fetchPrimary(taskId){
  try {
    const url = `${KIE_BASE}/api/task/${encodeURIComponent(taskId)}`
    const r = await fetch(url, { headers: kieHeaders() })
    const ct = r.headers.get('content-type') || ''
    const data = ct.includes('application/json') ? await r.json() : { raw: await r.text() }

    const norm = normalizeStatus(data)
    if (norm === 'success') {
      const images = extractResultUrls(data, 4)
      return { status: 'success', images, raw: data }
    }
    if (norm === 'failed' || r.status >= 400) {
      // 422 sensitive, 404 purged, etc.
      return { status: 'failed', error: data?.error || data?.message || data?.msg || null, code: data?.code || r.status || null, raw: data }
    }
    return { status: 'pending', raw: data }
  } catch (e) {
    // network/parse errors => not terminal; fall back to other probes
    return { status: 'pending', error: String(e) }
  }
}

// Legacy probe across families (MJ + Jobs NB) – unchanged logic from previous version
async function fetchAll(taskId){
  const endpoints = [
    // MJ family
    `${KIE_BASE}/api/v1/mj/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `${KIE_BASE}/api/v1/mj/result?taskId=${encodeURIComponent(taskId)}`,
    `${KIE_BASE}/api/v1/mj/getTask?taskId=${encodeURIComponent(taskId)}`,
    // Jobs family (Nano Banana)
    `${KIE_BASE}/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `${KIE_BASE}/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}`
  ]

  let merged = []
  let sawSuccess = false
  let sawFailed  = false
  let lastData   = null

  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: kieHeaders() })
      const txt = await r.text()
      let data; try { data = JSON.parse(txt) } catch { data = { raw: txt } }
      lastData = data

      if (r.status === 404) { sawFailed = true; continue }

      const stat = normalizeStatus(data)
      if (stat === 'success') {
        sawSuccess = true
        const imgs = firstImageUrls(data, 4)
        for (const u of imgs) if (!merged.includes(u)) merged.push(u)
        if (merged.length >= 4) break
      } else if (stat === 'failed') {
        sawFailed = true
      }
    } catch (_) {}
  }

  if (sawSuccess && merged.length) return { ok:true, status:'success', data: { images: merged } }
  if (sawFailed) return { ok:false, status:'failed', data: lastData || null }
  return { ok:false, status:'pending', data: lastData || null }
}

function normalizeStatus(d){
  const s = String(
    d?.status || d?.state ||
    d?.data?.state || d?.data?.status ||
    d?.result?.state || d?.result?.status || ''
  ).toLowerCase()

  if (['success','succeeded','completed','done'].includes(s)) return 'success'
  if (['failed','fail','error','failure'].includes(s)) return 'failed'

  // NB failure hints
  if (typeof d?.code !== 'undefined' && Number(d.code) >= 400) return 'failed'
  if (d?.data && (d.data.failCode || d.data.failMsg)) return 'failed'
  if (d?.msg && String(d.msg).toLowerCase().includes('failed')) return 'failed'

  return 'pending'
}

function isUrl(x){ try { new URL(x); return true } catch { return false } }
function host(u){ try { return new URL(u).hostname } catch { return '' } }
function allowed(u){
  if (!isUrl(u)) return false
  const h = host(u)
  if (!ALLOWED_HOSTS.has(h)) return false
  if (!/\/(m|f|workers)\//i.test(u)) return false
  return true
}

function firstImageUrls(obj, limit=4){
  let acc = []
  const cand = obj?.data?.result?.images || obj?.result?.images || obj?.data?.images || obj?.images
  if (Array.isArray(cand)) acc = acc.concat(cand)

  ;(function walk(x){
    if (!x) return
    if (typeof x === 'string'){
      const m = x.match(/https?:\/\/[^\s"']+/i)
      if (m) acc.push(m[0])
    } else if (Array.isArray(x)) {
      for (const v of x) walk(v)
    } else if (typeof x === 'object') {
      for (const v of Object.values(x)) walk(v)
    }
  })(obj)

  const out = []
  const seen = new Set()
  for (const it of acc){
    const u = typeof it === 'string' ? it : (it && it.url)
    if (u && allowed(u) && !seen.has(u)){
      seen.add(u)
      out.push(u)
      if (out.length >= limit) break
    }
  }
  return out
}

// Extract resultUrls array from the primary endpoint response
function extractResultUrls(d, limit=4){
  let urls = []
  const arr = d?.resultUrls || d?.result?.urls || d?.data?.resultUrls
  if (Array.isArray(arr)) urls = urls.concat(arr)
  if (!urls.length && d?.result && typeof d.result === 'object') {
    const maybe = d.result.urls || d.result.resultUrls || []
    if (Array.isArray(maybe)) urls = urls.concat(maybe)
  }
  // Filter + limit
  const uniq = []
  const seen = new Set()
  for (const u of urls) {
    if (typeof u === 'string' && allowed(u) && !seen.has(u)) {
      seen.add(u)
      uniq.push(u)
      if (uniq.length >= limit) break
    }
  }
  return uniq
}

// Read images from nb_results when KIE still looks pending
async function dbImagesByTask(taskId, limit=4){
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return []
    const url = `${SUPABASE_URL}/rest/v1/nb_results?task_id=eq.${encodeURIComponent(taskId)}&select=image_url&order=created_at.desc&limit=${limit}`
    const r = await fetch(url, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Accept': 'application/json'
      }
    })
    const rows = await r.json().catch(()=>[])
    const images = rows.map(x => x.image_url).filter(u => typeof u === 'string' && allowed(u))
    const uniq = Array.from(new Set(images))
    return uniq.slice(0, limit)
  } catch { return [] }
}

async function backfillAll({ uid, run_id, taskId, images }){
  try {
    if (!SUPABASE_URL || !SERVICE_KEY || !images?.length) return
    const rows = images.slice(0,4).map(u => ({
      user_id: uid || '00000000-0000-0000-0000-000000000000',
      run_id:  run_id || null,
      task_id: taskId || null,
      image_url: u
    }))
    await fetch(`${SUPABASE_URL}/rest/v1/nb_results`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows)
    })
  } catch {}
}
