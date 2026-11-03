const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Kie's reply for a failed task still says msg "success": the task's own reason must be stored, never "success".
for (const file of ['kie-check.js', 'image-tools-check.js', 'upscale-check.js', 'audio-kie-callback.js']) {
  test(`${file}: a failed Kie task keeps its real reason`, () => {
    const source = fs.readFileSync(path.join(__dirname, '../../netlify/functions', file), 'utf8');
    const fn = source.match(/function failureReason\((value|body)\) \{[\s\S]*?\n\}\n/)[0];
    const failureReason = new Function(`${fn}; return failureReason;`)();
    assert.equal(failureReason({ code: 200, msg: 'success', data: { state: 'fail', failMsg: 'Video format not supported' } }), 'Video format not supported');
    assert.equal(failureReason({ code: 200, msg: 'success', data: { state: 'fail', failMsg: '' } }), 'kie_failed');
    assert.equal(failureReason({ code: 501, msg: 'Internal Error, Please try again later.' }), 'Internal Error, Please try again later.');
    assert.equal(failureReason({ data: { error: { nested: true } }, message: 'Playground task failed.' }), 'Playground task failed.');
  });
}
