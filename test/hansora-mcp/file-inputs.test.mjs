import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  OPENAI_FILE_PARAMS,
  normalizeGenerationFiles,
  openAIFileSchema
} from '../../lib/hansora-mcp/file-inputs.mjs';
import { createHansoraServer } from '../../netlify/functions/hansora-mcp.mjs';

async function listTools() {
  const server = createHansoraServer({
    authInfo: { token: 'test', extra: { userId: 'test-user' } },
    requestInfo: { url: 'https://hansora.co/mcp' }
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const waiters = new Map();
  clientTransport.onmessage = (message) => {
    const resolve = waiters.get(message.id);
    if (resolve) {
      waiters.delete(message.id);
      resolve(message);
    }
  };
  await clientTransport.start();
  await server.connect(serverTransport);
  const request = async (message) => {
    const response = new Promise((resolve) => waiters.set(message.id, resolve));
    await clientTransport.send(message);
    return response;
  };
  await request({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const response = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  await server.close();
  return response?.result?.tools || [];
}

test('OpenAI file schema declares the required and optional properties exactly', () => {
  const schema = z.toJSONSchema(openAIFileSchema);
  assert.deepEqual(Object.keys(schema.properties).sort(), [
    'download_url',
    'file_id',
    'file_name',
    'mime_type'
  ]);
  assert.deepEqual(schema.required.sort(), ['download_url', 'file_id']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(OPENAI_FILE_PARAMS, ['image_files', 'video_files', 'audio_files']);
});

test('create_generation advertises direct attachments in its MCP descriptor', async () => {
  const tools = await listTools();
  const tool = tools.find((item) => item.name === 'create_generation');
  assert.ok(tool);
  assert.deepEqual(tool._meta['openai/fileParams'], OPENAI_FILE_PARAMS);
  for (const field of OPENAI_FILE_PARAMS) {
    const fileSchema = tool.inputSchema.properties[field].items;
    const resolved = fileSchema.$ref
      ? tool.inputSchema.$defs[fileSchema.$ref.split('/').pop()]
      : fileSchema;
    assert.deepEqual(Object.keys(resolved.properties).sort(), [
      'download_url',
      'file_id',
      'file_name',
      'mime_type'
    ]);
    assert.deepEqual(resolved.required.sort(), ['download_url', 'file_id']);
  }
});

test('attached media download URLs are merged into generation URL inputs', () => {
  const normalized = normalizeGenerationFiles({
    image_urls: ['https://example.com/existing.png'],
    image_files: [{
      download_url: 'https://files.openai.com/attached.png',
      file_id: 'file_image',
      mime_type: 'image/png',
      file_name: 'attached.png'
    }],
    video_files: [{
      download_url: 'https://files.openai.com/attached.mp4',
      file_id: 'file_video',
      mime_type: 'video/mp4'
    }]
  });

  assert.deepEqual(normalized.image_urls, [
    'https://example.com/existing.png',
    'https://files.openai.com/attached.png'
  ]);
  assert.deepEqual(normalized.video_urls, ['https://files.openai.com/attached.mp4']);
  assert.deepEqual(normalized.audio_urls, []);
});

test('an attachment in the wrong media field is rejected', () => {
  assert.throws(() => normalizeGenerationFiles({
    image_files: [{
      download_url: 'https://files.openai.com/not-an-image.mp4',
      file_id: 'file_video',
      mime_type: 'video/mp4'
    }]
  }), /image_file_mime_type_invalid/);
});

test('ChatGPT attachments are copied to Hansora storage with a real file extension', async () => {
  const { storeGenerationFiles } = await import('../../lib/hansora-mcp/file-inputs.mjs');
  const jpeg = Buffer.from('ffd8ffe000104a464946000101', 'hex');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {} });
    if (String(url).startsWith('https://oaisdmntprcentralus.blob.core.windows.net/')) {
      return new Response(jpeg, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    }
    return new Response('{}', { status: 200 });
  };
  const stored = await storeGenerationFiles({
    prompt: 'bottle ad',
    image_files: [{ download_url: 'https://oaisdmntprcentralus.blob.core.windows.net/files/file-abc?sig=x', file_id: 'file-abc' }]
  }, { fetchImpl, supabaseUrl: 'https://sb.test', serviceKey: 'key', bucket: 'video', now: () => new Date('2026-10-16T10:00:00Z') });

  assert.equal(stored.image_urls.length, 1);
  assert.match(stored.image_urls[0], /^https:\/\/sb\.test\/storage\/v1\/object\/public\/video\/images\/user-uploads\/2026\/10\/16\/[0-9a-f]{16}-chatgpt\.jpg$/);
  const upload = calls.find((call) => call.method === 'POST');
  assert.equal(upload.headers['Content-Type'], 'image/jpeg');
  assert.match(upload.url, /^https:\/\/sb\.test\/storage\/v1\/object\/video\/images\/user-uploads\//);
});

test('a failed copy falls back to the original ChatGPT link', async () => {
  const { storeGenerationFiles } = await import('../../lib/hansora-mcp/file-inputs.mjs');
  const original = 'https://oaisdmntprcentralus.blob.core.windows.net/files/file-abc?sig=x';
  const stored = await storeGenerationFiles({
    prompt: 'x', image_files: [{ download_url: original, file_id: 'file-abc', mime_type: 'image/png' }]
  }, { fetchImpl: async () => new Response('no', { status: 403 }), supabaseUrl: 'https://sb.test', serviceKey: 'key', bucket: 'video' });
  assert.deepEqual(stored.image_urls, [original]);
});
