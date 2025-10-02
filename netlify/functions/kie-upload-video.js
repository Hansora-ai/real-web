// netlify/functions/kie-upload-video.js
// DIAGNOSTIC: returns 200 and echoes what Netlify actually passes to the function.
// No external calls. Helps isolate whether the 500 is coming from platform/runtime.

exports.handler = async function handler(event, context) {
  try {
    const info = {
      ok: true,
      method: event.httpMethod,
      isBase64Encoded: !!event.isBase64Encoded,
      contentType: String(event.headers['content-type'] || event.headers['Content-Type'] || ''),
      bodyLength: (event.body || '').length,
      sampleBodyStart: (event.body || '').slice(0, 80),
      sampleBodyEnd: (event.body || '').slice(-80),
      headers: Object.fromEntries(Object.entries(event.headers || {}).slice(0, 20)),
    };
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: JSON.stringify(info)
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({ ok: false, error: 'server_error', detail: String(e && e.stack || e) })
    };
  }
};
