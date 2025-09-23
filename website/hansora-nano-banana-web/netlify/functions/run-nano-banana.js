// netlify/functions/run-nano-banana.js
// Creates a Nano Banana job and polls until it's finished.
// Uses env KIE_API_KEY and KIE_CREATE_URL. Returns the final JSON (incl. URLs).

const CREATE_URL = process.env.KIE_CREATE_URL || "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY = process.env.KIE_API_KEY; // <-- put your key in Netlify env
if (!API_KEY) console.warn("[run-nano-banana] Missing KIE_API_KEY env!");

const RESULT_URLS = [
  (id) => `https://api.kie.ai/api/v1/jobs/getTask?taskId=${id}`,
  (id) => `https://api.kie.ai/api/v1/jobs/getTaskResult?taskId=${id}`,
  (id) => `https://api.kie.ai/api/v1/jobs/result?taskId=${id}`,
];

function normalizeImageSize(v) { 
  if (!v) return "auto";
  const raw = String(v).trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, ":").replace(/-/g, ":");
  const ok = new Set(["auto","1:1","3:4","9:16","4:3","16:9"]);
  if (ok.has(raw)) return raw;
  const map = { square: "1:1", portrait: "3:4", landscape: "16:9" };
  return map[raw] || "auto";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return {"statusCode": 204, "headers": cors(), "body": ""};
  if (event.httpMethod !== "POST") return {"statusCode": 405, "headers": cors(), "body": "Use POST"};

  try {
    const body = JSON.parse(event.body || "{}");
    const urls = Array.isArray(body.urls) ? body.urls : [];
    const prompt = body.prompt || "";
    const format = (body.format || "png").toLowerCase();
    const size = normalizeImageSize(body.size);

    if (!API_KEY) return {"statusCode": 500, "headers": cors(), "body": "Missing: KIE_API_KEY"};
    if (!urls.length) return {"statusCode": 400, "headers": cors(), "body": "urls[] required"};

    const payload = {
      model: "google/nano-banana-edit",
      input: {
        prompt,
        image_urls: urls,
        output_format: format,
        image_size: size
      }
    };

    const create = await fetch(CREATE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const createText = await create.text();
    let createJson; try { createJson = JSON.parse(createText); } catch { createJson = { raw: createText }; }

    const taskId = createJson.taskId || createJson.id || createJson.data?.taskId || createJson.data?.id || createJson.result?.taskId || createJson.result?.id;
    if (!taskId) {
      return {"statusCode": 502, "headers": {...cors(), "Content-Type":"application/json"}, "body": JSON.stringify({ error:"No taskId from KIE", createJson }) };
    }

    // Poll ~2 minutes
    const deadline = Date.now() + 120000;
    let last = null;
    while (Date.now() < deadline) {
      for (const makeUrl of RESULT_URLS) {
        const res = await fetch(makeUrl(taskId), { headers: { "Authorization": `Bearer ${API_KEY}` } });
        const txt = await res.text();
        let js; try { js = JSON.parse(txt); } catch { js = { raw: txt }; }
        last = js;
        const status = String(js.status || js.data?.status || js.result?.status || js.state || "").toLowerCase();
        if (["success","succeeded","completed","done"].includes(status)) {
          return {"statusCode": 200, "headers": {...cors(), "Content-Type":"application/json"}, "body": JSON.stringify({ taskId, ...js }) };
        }
        if (["failed","error"].includes(status)) {
          return {"statusCode": 500, "headers": {...cors(), "Content-Type":"application/json"}, "body": JSON.stringify({ taskId, ...js }) };
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    return {"statusCode": 504, "headers": {...cors(), "Content-Type":"application/json"}, "body": JSON.stringify({ taskId, timeout: true, last }) };
  } catch (e) {
    return {"statusCode": 500, "headers": {...cors(), "Content-Type":"text/plain"}, "body": String(e) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
