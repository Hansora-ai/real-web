// Video models crop a start frame to the requested shape, and the default is 16:9. A tall photo animated
// at 16:9 loses its top and bottom ("it cut off half my head"), so read the photo's own shape from the
// first bytes of the file. Anything unexpected (slow host, odd format) returns null and changes nothing.

const HEAD_BYTES = 1048576; // some phones put over 128 KB of metadata before the image size
const TIMEOUT_MS = 3000;

function jpegExifOrientation(buffer, start, end) {
  // APP1 "Exif\0\0" followed by a TIFF header; tag 0x0112 is the orientation.
  if (buffer.toString('latin1', start, start + 6) !== 'Exif\0\0') return 1;
  const tiff = start + 6;
  const little = buffer.toString('latin1', tiff, tiff + 2) === 'II';
  const u16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const u32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 1;
}

// HEIC (iPhone photos) and AVIF: the image size is in an 'ispe' box; the largest one is the main picture
// (others are tiles or thumbnails). An 'irot' box of 90 or 270 degrees means the photo is shown sideways.
function heifSize(buffer) {
  let best = null;
  let turned = false;
  for (let at = buffer.indexOf('ispe', 0, 'latin1'); at >= 4 && at + 16 <= buffer.length; at = buffer.indexOf('ispe', at + 4, 'latin1')) {
    const width = buffer.readUInt32BE(at + 8);
    const height = buffer.readUInt32BE(at + 12);
    if (width > 0 && height > 0 && (!best || width * height > best.width * best.height)) best = { width, height };
  }
  const rotation = buffer.indexOf('irot', 0, 'latin1');
  if (rotation >= 4 && rotation + 5 <= buffer.length) turned = (buffer[rotation + 4] & 3) % 2 === 1;
  return best && turned ? { width: best.height, height: best.width } : best;
}

export function imageSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(buffer.toString('latin1', 8, 12))) return heifSize(buffer);
  // BMP
  if (buffer.toString('latin1', 0, 2) === 'BM' && buffer.length >= 26) return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
  // PNG: IHDR right after the signature.
  if (buffer.readUInt32BE(0) === 0x89504e47) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  // GIF
  if (buffer.toString('latin1', 0, 3) === 'GIF') return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  // WebP: lossy (VP8 ), lossless (VP8L) or extended (VP8X).
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP' && buffer.length >= 30) {
    const chunk = buffer.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
    return null;
  }
  // JPEG: walk the segments to the frame header; phone photos may be stored sideways with an EXIF rotation.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    let orientation = 1;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (marker === 0xe1) {
        try { orientation = jpegExifOrientation(buffer, offset + 4, Math.min(buffer.length, offset + 2 + length)); } catch { orientation = 1; }
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
      }
      offset += 2 + length;
    }
  }
  return null;
}

// "9:16" for a clearly tall photo, "16:9" for a clearly wide one, null for square-ish or unknown.
export function shapeFromSize(size) {
  if (!size || !(size.width > 0) || !(size.height > 0)) return null;
  const ratio = size.width / size.height;
  if (ratio <= 0.9) return '9:16';
  if (ratio >= 1.1) return '16:9';
  return null;
}

export async function photoShape(url, fetchImpl = fetch) {
  if (!/^https:\/\//i.test(String(url || ''))) return null;
  try {
    const response = await fetchImpl(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer()).subarray(0, HEAD_BYTES);
    return shapeFromSize(imageSize(buffer));
  } catch {
    return null;
  }
}
