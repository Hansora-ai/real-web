// netlify/functions/audio-download.js
// Safe server-side audio download helper for cross-origin KIE/Suno/ElevenLabs result URLs.

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Use GET" });

  try {
    const qs = event.queryStringParameters || {};
    const rawUrl = String(qs.url || "").trim();
    const safeName = safeFileName(qs.name || "hansora-audio");
    const url = new URL(rawUrl);
    if (!/^https?:$/.test(url.protocol)) return json(400, { error: "invalid_url" });
    if (isPrivateHost(url.hostname)) return json(400, { error: "blocked_host" });

    const upstream = await fetch(url.href, {
      headers: {
        "User-Agent": "Hansora-Audio-Downloader/1.0",
        "Accept": "audio/*,application/octet-stream,*/*"
      }
    });
    if (!upstream.ok) return json(502, { error: `download_failed_${upstream.status}` });

    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const ext = extensionFor(contentType, url.pathname);
    const fileName = safeName.toLowerCase().endsWith(ext) ? safeName : `${safeName}${ext}`;

    return {
      statusCode: 200,
      headers: {
        ...cors(),
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store"
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true
    };
  } catch (error) {
    return json(400, { error: "invalid_download_request" });
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
function safeFileName(value) {
  const clean = String(value || "hansora-audio").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 90);
  return clean || "hansora-audio";
}
function extensionFor(contentType, pathname) {
  const pathExt = String(pathname || "").match(/\.(mp3|wav|m4a|aac|ogg|flac)(?:$|[?#])/i);
  if (pathExt) return `.${pathExt[1].toLowerCase()}`;
  const type = String(contentType || "").toLowerCase();
  if (type.includes("wav")) return ".wav";
  if (type.includes("ogg")) return ".ogg";
  if (type.includes("flac")) return ".flac";
  if (type.includes("aac")) return ".aac";
  if (type.includes("mp4") || type.includes("m4a")) return ".m4a";
  return ".mp3";
}
function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}
