import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { parseSignedRequest } from '../../netlify/functions/automation-meta-data-deletion.mjs';

const sign = (payload, secret) => { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${crypto.createHmac('sha256', secret).update(body).digest('base64url')}.${body}`; };

test('Meta data-deletion requests are accepted only with a valid app-secret signature', () => {
  const request = sign({ algorithm: 'HMAC-SHA256', user_id: '17841400000000000', issued_at: 1790000000 }, 'app-secret');
  assert.equal(parseSignedRequest(request, 'app-secret').user_id, '17841400000000000');
  assert.equal(parseSignedRequest(request, 'other-secret'), null);
  assert.equal(parseSignedRequest(sign({ algorithm: 'NONE', user_id: '1' }, 'app-secret'), 'app-secret'), null);
  assert.equal(parseSignedRequest('garbage', 'app-secret'), null);
});

test('Automation tables go to the automation schema; Creative tables like profiles stay in public', async () => {
  const { schemaFor } = await import('../../lib/automation/db.mjs');
  assert.equal(schemaFor('/rest/v1/automation_businesses?id=eq.1'), 'automation');
  assert.equal(schemaFor('/rest/v1/rpc/automation_save_agent'), 'automation');
  assert.equal(schemaFor('/rest/v1/profiles?user_id=eq.1&select=credits'), null);
  assert.equal(schemaFor('/auth/v1/admin/users/1'), null);
});
