// A small, dependency-free .xlsx reader for catalog sync (Excel files in OneDrive / SharePoint). It reads the first
// worksheet's cell values as rows of text — enough for a product list. Formulas give their saved result.
import zlib from 'node:zlib';

const MAX_UNZIPPED = 40 * 1024 * 1024;

// Zip entries by name, read from the central directory (sizes there are always right).
function unzip(buffer) {
  const files = new Map();
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 66000); index--) if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  if (end < 0) throw Object.assign(new Error('xlsx_invalid'), { status: 400 });
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  let total = 0;
  for (let entry = 0; entry < count; entry++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10), compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    total += size; if (total > MAX_UNZIPPED) throw Object.assign(new Error('sheet_too_large'), { status: 413 });
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + compressed);
    files.set(name, method === 0 ? data.toString('utf8') : method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }).toString('utf8') : '');
  }
  return files;
}

const decode = text => String(text).replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (match, code) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[code.toLowerCase()] ?? (code[1] === 'x' || code[1] === 'X' ? String.fromCodePoint(parseInt(code.slice(2), 16)) : String.fromCodePoint(Number(code.slice(1)))));
const texts = xml => [...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(match => decode(match[1])).join('');
const columnIndex = ref => [...String(ref).replace(/\d+/g, '').toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;

export function readXlsxRows(buffer, { maxRows = 5001, maxColumns = 60 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw Object.assign(new Error('xlsx_invalid'), { status: 400 });
  const files = unzip(buffer);
  const shared = [...String(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => texts(match[1]));
  // The first sheet in the workbook's order (not necessarily sheet1.xml).
  const firstId = String(files.get('xl/workbook.xml') || '').match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = firstId && String(files.get('xl/_rels/workbook.xml.rels') || '').match(new RegExp(`<Relationship\\b[^>]*Id="${firstId}"[^>]*Target="([^"]+)"`))?.[1];
  const sheetName = target ? `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = files.get(sheetName) || files.get('xl/worksheets/sheet1.xml') || '';
  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1], body = cell[2] || '';
      const ref = attributes.match(/\br="([A-Z]+\d+)"/)?.[1];
      const column = ref ? columnIndex(ref) : row.length;
      if (column >= maxColumns) continue;
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] || '';
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const value = type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? texts(body) : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : decode(raw ?? '');
      while (row.length < column) row.push('');
      row[column] = String(value);
    }
    if (row.some(value => String(value).trim() !== '')) rows.push(row);
    if (rows.length >= maxRows) break;
  }
  return rows;
}
