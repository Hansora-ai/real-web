import test from 'node:test';
import assert from 'node:assert/strict';
import { dueUrlDocuments, refreshKnowledge, REFRESH_AFTER_MS } from '../../netlify/functions/automation-knowledge-refresh.mjs';

const now = Date.parse('2026-10-04T00:00:00Z');
const old = new Date(now - REFRESH_AFTER_MS - 1000).toISOString();
const fresh = new Date(now - 1000).toISOString();

test('only website links older than a week are due', () => {
  const docs = [
    { id: 'a', type: 'url', url: 'https://x.am', added_at: old },
    { id: 'b', type: 'url', url: 'https://y.am', added_at: old, refreshed_at: fresh },
    { id: 'c', type: 'file', added_at: old },
    { id: 'd', type: 'url', url: 'https://z.am', added_at: fresh }
  ];
  assert.deepEqual(dueUrlDocuments(docs, now).map(doc => doc.id), ['a']);
});

test('a refreshed link replaces the old copy, keeping order and other documents', async () => {
  const synced = [], deleted = [];
  const resource = { id: 'r', business_id: 'biz', safe_config: { knowledge_documents: [{ id: 'f1', type: 'file', added_at: old }, { id: 'u1', type: 'url', url: 'https://x.am', name: 'x.am', added_at: old }] }, automation_businesses: { owner_user_id: 'owner' } };
  const results = await refreshKnowledge({
    now, rows: value => value, supabaseRequest: async () => [resource],
    addElevenLabsKnowledge: async input => { assert.equal(input.url, 'https://x.am'); return { id: 'u2', name: 'x.am' }; },
    syncBusinessAgent: async args => { synced.push(args); },
    deleteElevenLabsKnowledge: async id => { deleted.push(id); }
  });
  assert.equal(results[0].ok, true);
  assert.equal(synced[0].userId, 'owner');
  assert.deepEqual(synced[0].knowledgeDocuments.map(doc => doc.id), ['f1', 'u2']);
  assert.ok(synced[0].knowledgeDocuments[1].refreshed_at);
  assert.deepEqual(deleted, ['u1']);
});

test('if the agent update fails, the new copy is removed and the old one kept', async () => {
  const deleted = [];
  const resource = { id: 'r', business_id: 'biz', safe_config: { knowledge_documents: [{ id: 'u1', type: 'url', url: 'https://x.am', added_at: old }] }, automation_businesses: [{ owner_user_id: 'owner' }] };
  const results = await refreshKnowledge({
    now, rows: value => value, supabaseRequest: async () => [resource],
    addElevenLabsKnowledge: async () => ({ id: 'u2' }),
    syncBusinessAgent: async () => { throw new Error('boom'); },
    deleteElevenLabsKnowledge: async id => { deleted.push(id); }
  });
  assert.equal(results[0].ok, false);
  assert.deepEqual(deleted, ['u2']);
});
