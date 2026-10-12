import { localRender, nativeExport } from "../lib/caption-studio/local-render.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import {
  createCaptionToken,
  elevenLabsKey,
} from "../lib/caption-studio/elevenlabs.mjs";
const root = resolve(fileURLToPath(new URL("../public/", import.meta.url))),
  port = Number(process.env.CAPTION_STUDIO_PORT || 4173);
let apiKey = elevenLabsKey();
const mime = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};
let lastToken = 0;
const server = createServer(async (req, res) => {
  const origin = `http://${req.headers.host}`,
    send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
  if (!/^((localhost|127\.0\.0\.1)(:\d+)?)$/.test(req.headers.host || ""))
    return send(403, { error: "Local connections only." });
  if (req.headers.origin && req.headers.origin !== origin)
    return send(403, {
      error: "Open the local Caption Studio page to continue.",
    });
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === "/api/caption-studio/status" && req.method === "GET")
      return send(200, { local: true, configured: Boolean(apiKey), nativeExport });
    if (url.pathname === "/api/caption-studio/key" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2048) return send(413, { error: "Key is too long." });
      }
      apiKey = String(JSON.parse(body).key || "").trim();
      return send(200, { configured: Boolean(apiKey) });
    }
    if (
      url.pathname === "/.netlify/functions/caption-studio-token" &&
      req.method === "POST"
    ) {
      if (Date.now() - lastToken < 1500)
        return send(429, { error: "Wait a moment and try again." });
      lastToken = Date.now();
      return send(200, await createCaptionToken({ apiKey }));
    }
    if (await localRender(req, res, url, send)) return;
    if (req.method !== "GET" && req.method !== "HEAD")
      return send(405, { error: "Method not allowed." });
    const path = resolve(
      root,
      "." +
        decodeURIComponent(
          url.pathname === "/" ? "/caption-studio.html" : url.pathname,
        ),
    );
    if (!path.startsWith(root + sep))
      return send(403, { error: "Invalid path." });
    const info = await stat(path);
    if (!info.isFile()) return send(404, { error: "File not found." });
    const data = await readFile(path);
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    let start = 0,
      end = data.length - 1;
    if (range) {
      start = Number(range[1]);
      end = range[2] ? Math.min(end, Number(range[2])) : end;
      if (start > end || start >= data.length) {
        res.writeHead(416, { "Content-Range": `bytes */${data.length}` });
        return res.end();
      }
    }
    res.writeHead(range ? 206 : 200, {
      "Content-Type": mime[extname(path)] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      ...(range
        ? { "Content-Range": `bytes ${start}-${end}/${data.length}` }
        : {}),
    });
    res.end(req.method === "HEAD" ? undefined : data.subarray(start, end + 1));
  } catch (error) {
    if (res.headersSent || res.destroyed) return;
    send(error.code === "ENOENT" ? 404 : error.status || 500, {
      error: error.code === "ENOENT" ? "File not found." : error.message,
    });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Caption Studio: http://127.0.0.1:${port}/caption-studio.html\nElevenLabs: ${apiKey ? "configured" : "local server environment not connected"}`,
  ),
);
