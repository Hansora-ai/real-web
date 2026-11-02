import { styleFor, timelineCaptions } from "./core.mjs";
export function fit(sourceW, sourceH, w, h) {
  const r = Math.min(w / sourceW, h / sourceH);
  return {
    x: (w - sourceW * r) / 2,
    y: (h - sourceH * r) / 2,
    w: sourceW * r,
    h: sourceH * r,
  };
}
export function drawCaption(ctx, p, q, time, w, h) {
  const s = styleFor(p, q),
    size = (w * s.size) / 100;
  ctx.save();
  ctx.font = `${s.bold ? 800 : 400} ${size}px "${s.font}", "Noto Sans Armenian", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const tokens = String(q.text).split(/(\s+)/u).filter(Boolean),
    lines = [[]];
  let lineWidth = 0,
    wordIndex = 0;
  for (const token of tokens) {
    if (/\n/.test(token)) {
      lines.push([]);
      lineWidth = 0;
      continue;
    }
    if (/^\s+$/.test(token)) {
      if (lines.at(-1).length) {
        const width = ctx.measureText(" ").width;
        lines.at(-1).push({ text: " ", width, index: -1 });
        lineWidth += width;
      }
      continue;
    }
    const width = ctx.measureText(token).width;
    if (lineWidth + width > (w * s.width) / 100 && lines.at(-1).length) {
      while (lines.at(-1).at(-1)?.index === -1) lines.at(-1).pop();
      lines.push([]);
      lineWidth = 0;
    }
    lines.at(-1).push({ text: token, width, index: wordIndex++ });
    lineWidth += width;
  }
  const spacing = size * 1.3,
    pad = size * 0.32,
    blockH = lines.length * spacing + pad * 2,
    maxWidth = Math.max(
      ...lines.map((line) => line.reduce((sum, t) => sum + t.width, 0)),
    ),
    blockW = maxWidth + pad * 2;
  const x = Math.max(
      blockW / 2 + 2,
      Math.min(w - blockW / 2 - 2, (w * s.x) / 100),
    ),
    y = Math.max(blockH / 2 + 2, Math.min(h - blockH / 2 - 2, (h * s.y) / 100));
  let scale = 1;
  if (s.animation === "pop") {
    const phase = Math.min(1, Math.max(0, (time - q.start) / 0.16));
    scale = 0.85 + 0.15 * phase;
  }
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (s.backgroundOpacity > 0) {
    ctx.globalAlpha = s.backgroundOpacity;
    ctx.fillStyle = s.background;
    ctx.beginPath();
    ctx.roundRect(-blockW / 2, -blockH / 2, blockW, blockH, size * 0.22);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const current = (q.words || []).findIndex(
    (a) => time >= a.start && time < a.end,
  );
  lines.forEach((line, row) => {
    const lineW = line.reduce((sum, t) => sum + t.width, 0);
    let left =
      s.align === "left"
        ? -maxWidth / 2
        : s.align === "right"
          ? maxWidth / 2 - lineW
          : -lineW / 2;
    for (const token of line) {
      const top = (row - (lines.length - 1) / 2) * spacing;
      if (s.shadow) {
        ctx.shadowColor = "rgba(0,0,0,.6)";
        ctx.shadowBlur = size * 0.1;
        ctx.shadowOffsetY = size * 0.06;
      }
      ctx.lineWidth = (size * s.outline) / 35;
      ctx.strokeStyle = "#101418";
      if (s.outline) ctx.strokeText(token.text, left, top);
      ctx.fillStyle =
        s.animation === "highlight" && token.index === current
          ? s.accent
          : s.color;
      ctx.fillText(token.text, left, top);
      left += token.width;
    }
  });
  ctx.restore();
  return {
    x: x - blockW / 2,
    y: y - blockH / 2,
    w: blockW,
    h: blockH,
    key: q.key || q.id,
  };
}
export function drawOverlays(
  ctx,
  p,
  time,
  w,
  h,
  assets,
  { captions = timelineCaptions(p), selection = null, skipKey = null } = {},
) {
  const boxes = [];
  for (const q of captions) {
    if (q.key !== skipKey && time >= q.start && time < q.end)
      boxes.push(drawCaption(ctx, p, q, time, w, h));
  }
  for (const l of p.layers) {
    if (l.id === skipKey || time < l.start || time >= l.end) continue;
    if (l.kind === "text") {
      boxes.push(drawCaption(ctx, p, l, time, w, h));
      continue;
    }
    const a = assets.get(l.assetId);
    if (!a?.image) continue;
    const s = styleFor(p, l),
      width = (w * s.width) / 100,
      height = (width * a.height) / a.width,
      x = (w * s.x) / 100 - width / 2,
      y = (h * s.y) / 100 - height / 2;
    ctx.drawImage(a.image, x, y, width, height);
    boxes.push({ x, y, w: width, h: height, key: l.id });
  }
  if (selection) drawSelection(ctx, boxes.find(b => b.key === selection), w);
  return boxes;
}

export function resizeHandles(box) {
  if (!box) return [];
  return [[0,0],[.5,0],[1,0],[1,.5],[1,1],[.5,1],[0,1],[0,.5]].map(([x,y])=>({
    x:box.x+x*box.w,y:box.y+y*box.h,fx:x,fy:y,
    cursor:x===.5?"ns-resize":y===.5?"ew-resize":x===y?"nwse-resize":"nesw-resize"
  }));
}
export function drawSelection(ctx, box, width) {
  if (!box) return;
  ctx.save();ctx.strokeStyle="#fff";ctx.lineWidth=Math.max(1,width/700);ctx.setLineDash([]);
  ctx.strokeRect(box.x,box.y,box.w,box.h);
  const size=width/100;
  for(const h of resizeHandles(box)) {ctx.fillStyle="#fff";ctx.fillRect(h.x-size/2,h.y-size/2,size,size);}
  ctx.restore();
}
