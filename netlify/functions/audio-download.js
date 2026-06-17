// netlify/functions/audio-download.js
// Audio download proxy that avoids returning large MP3/M4A/WAV files through Netlify.
// It redirects Supabase files directly, caches other allowed audio files to Supabase, then redirects.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = process.env.SUPABASE_BUCKET || "downloads";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return json(405, { ok: false, error: "method_not_allowed" });

  const qs = event.queryStringParameters || {};
  let raw = String(qs.url || "").trim();
  let providedName = String(qs.name || "").trim();
  if (!raw) return json(400, { ok: false, error: "missing_url" });

  raw = unwrap(raw).replace(/^hhttps:\/\//i, "https://").replace(/^hhttp:\/\//i, "http://");

  let target;
  try {
    target = new URL(raw);
  } catch (_) {
    return json(400, { ok: false, error: "bad_url", url: raw });
  }

  if (!/^https?:$/.test(target.protocol)) return json(400, { ok: false, error: "invalid_url" });
  if (!isAllowedHost(target.hostname) || isPrivateHost(target.hostname)) {
    return json(400, { ok: false, error: "blocked_host", host: target.hostname });
  }

  const nameFromUrl = safeFileName(decodePath(target.pathname.split("/").filter(Boolean).pop() || "hansora-audio"));
  let name = providedName ? safeFileName(providedName) : nameFromUrl;

  if (isSupabaseHost(target.hostname)) {
    name = ensureExt(name, nameFromUrl, null);
    target.searchParams.set("download", name);
    return redirect(target.toString());
  }

  if (!(SUPABASE_URL && SERVICE_KEY)) {
    return redirect(target.toString());
  }

  try {
    const upstream = await fetch(target.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Hansora-Audio-Downloader/1.0",
        "Accept": "audio/*,application/octet-stream,*/*"
      }
    });
    if (!upstream.ok) {
      const details = await upstream.text().catch(() => "");
      return json(upstream.status, { ok: false, error: "upstream_error", details: details.slice(0, 1000) });
    }

    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    name = ensureExt(name, nameFromUrl, contentType);

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const path = buildPath(name, stableHash(target.toString()));
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${path}`;

    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true"
      },
      body: buffer
    });

    if (!upload.ok) return redirect(target.toString());

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${path}`;
    const downloadUrl = new URL(publicUrl);
    downloadUrl.searchParams.set("download", name);
    return redirect(downloadUrl.toString());
  } catch (_) {
    return redirect(target.toString());
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS"
  };
}
function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(body) };
}
function redirect(location) {
  return { statusCode: 302, headers: { ...cors(), "Location": location, "Cache-Control": "no-store" }, body: "" };
}
function unwrap(value) {
  let text = String(value || "");
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(text);
      const nested = decoded.match(/\/\.netlify\/functions\/(?:audio-download|download-proxy)\?url=([^&]+)/i);
      if (nested && nested[1]) {
        text = nested[1];
        continue;
      }
      text = decoded;
      break;
    } catch (_) {
      break;
    }
  }
  return text;
}
function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}
function safeFileName(value) {
  const clean = String(value || "hansora-audio").replace(/[^a-z0-9._ -]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  return clean || "hansora-audio";
}
function ensureExt(name, urlName, contentType) {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const urlExt = String(urlName || "").match(/\.([a-z0-9]{2,5})$/i);
  const ext = (urlExt && urlExt[1]) || extForContentType(contentType) || "mp3";
  return `${name}.${String(ext).toLowerCase()}`;
}
function extForContentType(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("flac")) return "flac";
  if (type.includes("aac")) return "aac";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  return "";
}
function stableHash(value) {
  const text = String(value || "");
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash) + text.charCodeAt(i);
  return (hash >>> 0).toString(16);
}
function buildPath(name, key) {
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const prefix = key ? `${key}-` : "";
  return `${year}/${month}/${day}/audio-${prefix}${safeFileName(name)}`;
}
function isSupabaseHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return /\b(supabase\.co|supabase\.in|storage\.supabase\.com)\b/.test(host);
}
function isAllowedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  const allowed = [
    "supabase.co",
    "supabase.in",
    "storage.supabase.com",
    "aiquickdraw.com",
    "tempfile.aiquickdraw.com",
    "storage.googleapis.com",
    "elevenlabs.io",
    "elevenlabs.com",
    "suno.com",
    "cdn1.suno.ai",
    "cdn2.suno.ai"
  ];
  return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true;
  return false;
}
