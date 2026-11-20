const { launch } = require('../../lib/kie/upscale.cjs');
const { json } = require('../../lib/henshin/common.cjs');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { submitted: false, error: 'Use POST.' });
  let body;
  try {
    body = JSON.parse(event.body || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
  } catch {
    return json(400, { submitted: false, error: 'Invalid request.' });
  }
  const kind = String(body.kind || body.media_type || body.mediaType || '').toLowerCase().includes('video') ? 'video' : 'image';
  return launch(event, body, kind);
};
