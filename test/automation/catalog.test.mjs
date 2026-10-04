import test from 'node:test';
import assert from 'node:assert/strict';
import { googleSheetCsvUrl, guessColumnMap, parseCsv, parsePrice, rowsToProducts, searchProducts, resolveOrderItems, reduceStockForOrder, restoreStockForOrder } from '../../lib/automation/catalog.mjs';

test('prices and CSV are read the way people write them', () => {
  assert.equal(parsePrice('12 900 ֏'), 12900);
  assert.equal(parsePrice('$49.99'), 49.99);
  assert.equal(parsePrice('1,299.50'), 1299.5);
  assert.equal(parsePrice('12,50'), 12.5);
  assert.equal(parsePrice(''), null);
  assert.deepEqual(parseCsv('Name,Price\n"Sofa, grey",120\nChair,"4""5"\n'), [['Name', 'Price'], ['Sofa, grey', '120'], ['Chair', '4"5']]);
});

test('spreadsheet columns are guessed in English, Russian and Armenian, rows with one name become variants', () => {
  const map = guessColumnMap(['Ապրանք', 'Գին', 'Գույն', 'Քանակ', 'Photo']);
  assert.deepEqual(map, { name: 0, price: 1, variant: 2, stock: 3, photo_url: 4 });
  const products = rowsToProducts([
    ['Oslo sofa', '120000 ֏', 'Grey', '2', 'https://x.example/grey.jpg'],
    ['Oslo sofa', '125000 ֏', 'Blue', '0', 'https://x.example/blue.jpg'],
    ['Lamp', '9000', '', '', '']
  ], map);
  assert.equal(products.length, 2);
  const sofa = products[0];
  assert.equal(sofa.currency, 'AMD');
  assert.equal(sofa.price, 120000);
  assert.equal(sofa.stock, 2);
  assert.deepEqual(sofa.variants.map(v => [v.name, v.price, v.stock]), [['Grey', 120000, 2], ['Blue', 125000, 0]]);
  assert.equal(sofa.photos.length, 2);
  assert.equal(products[1].stock, null);
});

test('only Google Sheets links are turned into a CSV download link', () => {
  assert.equal(googleSheetCsvUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456/edit#gid=42'), 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456/export?format=csv&gid=42');
  assert.equal(googleSheetCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml'), 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv');
  assert.equal(googleSheetCsvUrl('https://evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456'), '');
  assert.equal(googleSheetCsvUrl('http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456'), '');
});

const catalog = [
  { id: 'aaaaaaaa-1111-1111-1111-111111111111', name: 'Oslo sofa', category: 'Sofas', description: 'Two-seat', price: 120000, currency: 'AMD', stock: 2, variants: [{ name: 'Grey', price: 120000, stock: 2 }, { name: 'Blue', price: 125000, stock: 0 }], photos: [] },
  { id: 'bbbbbbbb-2222-2222-2222-222222222222', name: 'Desk lamp', category: 'Lighting', description: '', price: 9000, currency: 'AMD', stock: null, variants: [], photos: [] }
];

test('the AI finds the exact product with variants and stock', async () => {
  const result = await searchProducts({ businessId: 'b1', query: 'do you have the oslo sofa in blue?' }, { supabaseRequest: async () => catalog, rows: v => v });
  assert.equal(result.products[0].name, 'Oslo sofa');
  assert.equal(result.products[0].ref, 'aaaaaaaa');
  assert.deepEqual(result.products[0].variants[1], { name: 'Blue', price: '125,000 AMD', stock: 0 });
  assert.equal(result.products.length, 1);
});

test('a question in another language still shows the small catalog to pick from', async () => {
  const result = await searchProducts({ businessId: 'b1', query: 'բազմոց ունե՞ք' }, { supabaseRequest: async () => catalog, rows: v => v });
  assert.equal(result.products.length, 2);
  assert.match(result.note, /another language/);
});

test('order items are checked against the catalog, and stock goes out and back per variant', async () => {
  const first = async path => catalog.find(item => path.includes(item.id.slice(0, 8))) || null;
  const { items, problems } = await resolveOrderItems({ businessId: 'b1', text: 'aaaaaaaa (Grey) x2, bbbbbbbb' }, { first });
  assert.deepEqual(problems, []);
  assert.deepEqual(items.map(item => [item.name, item.variant, item.quantity]), [['Oslo sofa', 'Grey', 2], ['Desk lamp', '', 1]]);
  // A colour that does not exist, an out-of-stock variant, too many, no variant chosen, and a bad ref are refused.
  const bad = await resolveOrderItems({ businessId: 'b1', text: 'aaaaaaaa (Green) x1, aaaaaaaa (Blue), aaaaaaaa (Grey) x3, aaaaaaaa, zzzz' }, { first });
  assert.equal(bad.items.length, 0);
  assert.match(bad.problems[0], /does not come in "Green"; it comes in: Grey, Blue/);
  assert.match(bad.problems[1], /Blue\) is out of stock/);
  assert.match(bad.problems[2], /only 2 of Oslo sofa \(Grey\) left/);
  assert.match(bad.problems[3], /ask which one \(Grey, Blue\)/);
  assert.match(bad.problems[4], /not in the "ref \(variant\) xQuantity" form/);
  const updates = [];
  const deps = { first: async path => catalog.find(item => path.includes(item.id)) || null, serviceUpdate: async (table, query, value) => updates.push(value) };
  await reduceStockForOrder({ businessId: 'b1', items }, deps);
  assert.deepEqual(updates[0].variants.map(v => v.stock), [0, 0]);
  assert.equal(updates[0].stock, 0);
  assert.equal(updates[1].stock, null);
  await restoreStockForOrder({ businessId: 'b1', items: items.slice(0, 1) }, deps);
  assert.deepEqual(updates[2].variants.map(v => v.stock), [4, 0]);
  assert.equal(updates[2].stock, 4);
});
