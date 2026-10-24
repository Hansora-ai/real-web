import assert from 'node:assert/strict';
import test from 'node:test';

const { imageSize, shapeFromSize, photoShape } = await import('../../lib/hansora-mcp/image-shape.mjs');

function png(width, height) {
  const buffer = Buffer.alloc(33);
  buffer.writeUInt32BE(0x89504e47, 0); buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8); buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

// A JPEG as phones save it: pixels stored wide, with an EXIF note to show them rotated (orientation 6).
function jpeg(width, height, orientation = 1) {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(orientation, 18);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof]);
}

test('the photo shape is read from the file: tall, wide, square, and phone photos stored sideways', () => {
  assert.deepEqual(imageSize(png(1080, 1920)), { width: 1080, height: 1920 });
  assert.equal(shapeFromSize(imageSize(png(1080, 1920))), '9:16');
  assert.equal(shapeFromSize(imageSize(png(1920, 1080))), '16:9');
  assert.equal(shapeFromSize(imageSize(png(1000, 1000))), null);
  assert.deepEqual(imageSize(jpeg(4032, 3024)), { width: 4032, height: 3024 });
  assert.equal(shapeFromSize(imageSize(jpeg(4032, 3024, 6))), '9:16');
  assert.equal(imageSize(Buffer.from('not an image at all, just text')), null);
});

test('reading the photo never fails a generation: errors and slow hosts give no shape', async () => {
  assert.equal(await photoShape('https://x.test/a.png', async () => new Response(png(720, 1280), { status: 206 })), '9:16');
  assert.equal(await photoShape('https://x.test/a.png', async () => { throw new Error('offline'); }), null);
  assert.equal(await photoShape('https://x.test/a.png', async () => new Response('', { status: 404 })), null);
  assert.equal(await photoShape('http://insecure.test/a.png', async () => new Response(png(720, 1280))), null);
});
