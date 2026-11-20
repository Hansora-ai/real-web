'use strict';
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.REAPI_API_KEY = 'reapi';
const test = require('node:test');
const assert = require('node:assert/strict');
const wan = require('../../lib/reapi/henshin-lite-wan.cjs');
const pricing = require('../../public/kling4-pricing.js');

const URL_VIDEO = 'https://db.test/storage/v1/object/public/video/u/source.mp4';
const URL_IMAGE = 'https://db.test/storage/v1/object/public/video/u/face.jpg';
const body = (extra = {}) => ({ run_id: 'run-12345678', henshin_model: 'lite', mode: 'motion', video_url: URL_VIDEO, image_urls: [URL_IMAGE], resolution: '720p', source_video_duration: 7, keep_audio: true, ...extra });
const event = b => ({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(b) });

function deps({ seconds = 6.28, existing = null } = {}) {
  const log = { reserve: null, submitted: null, attach: null };
  return {
    log,
    deps: {
      auth: async () => ({ id: '11111111-1111-1111-1111-111111111111' }),
      db: async () => (existing ? [existing] : []),
      prepareSource: async () => ({ seconds, videoURL: 'https://db.test/storage/v1/object/public/video/u/silent-source.mp4', audioURL: 'https://db.test/a.m4a', width: 720, height: 1280 }),
      transition: async (step, id, uid, data) => {
        if (step === 'reserve') { log.reserve = data; return { created: true, credits: 1, row: { id, meta: data.meta, result_url: null } }; }
        if (step === 'attach') { log.attach = data; return { row: { id, meta: { ...log.reserve.meta, task_id: data.task_id, status: 'processing' }, result_url: null } }; }
        return { row: { id, meta: {} } };
      },
      submit: async payload => { log.submitted = payload; return { id: 'task_1' }; }
    }
  };
}

test('videos up to 15 seconds go to Wan 3.0; longer or unknown ones stay on Kling', () => {
  assert.equal(wan.fitsWan({ source_video_duration: 6.3 }), true);
  assert.equal(wan.fitsWan({ source_video_duration: 15 }), true);
  assert.equal(wan.fitsWan({ source_video_duration: 15.5 }), false);
  assert.equal(wan.fitsWan({}), false);
});

test('the prompt uses Wan 3.0 names for the inputs', () => {
  const prompt = wan.wanPrompt(body({ image_urls: [URL_IMAGE, URL_IMAGE] }));
  assert.match(prompt, /Video 1/);
  assert.match(prompt, /Image 1, Image 2/);
  assert.doesNotMatch(prompt, /@Video|@Image/);
});

test('a 6.28 s video runs on Wan 3.0 at the usual Henshin Lite price, with the original sound restored afterwards', async () => {
  const { deps: d, log } = deps({ seconds: 6.28 });
  const price = pricing.quote({ resolution: '720p', inputSeconds: 6.28, lite: true });
  const res = await wan.handler(d)(event(body({ expected_credits: price.displayedCredits })));
  assert.equal(res.statusCode, 201);
  const p = log.submitted;
  assert.equal(p.model, 'wan3.0-video');
  assert.equal(p.duration, 7);
  assert.equal(p.resolution, '720P');
  assert.equal(p.audio, false);
  assert.equal(p.generation_type, 'reference');
  assert.deepEqual(p.video_urls, ['https://db.test/storage/v1/object/public/video/u/silent-source.mp4']);
  assert.deepEqual(p.image_urls, [URL_IMAGE]);
  assert.match(p.webhook_url, /\/\.netlify\/functions\/henshin-check\?uid=/);
  const m = log.reserve.meta;
  assert.equal(log.reserve.provider, 'Hansora Henshin Lite');
  assert.equal(m.source, 'reapi');
  assert.equal(m.checker, 'henshin-check');
  assert.equal(m.henshin_model, 'lite');
  assert.equal(m.finish_video, true);
  assert.equal(m.source_audio_url, 'https://db.test/a.m4a');
  assert.equal(m.refund_amount, price.internalCredits);
  assert.equal(JSON.parse(res.body).checker, 'henshin-check');
});

test('a video measured over 15 s is handed back before anything is charged', async () => {
  const { deps: d, log } = deps({ seconds: 18 });
  await assert.rejects(wan.handler(d)(event(body({ expected_credits: 1 }))), error => error.tooLongForWan && error.seconds === 18);
  assert.equal(log.reserve, null);
  assert.equal(log.submitted, null);
});

test('a changed price or a run that already exists is not started again', async () => {
  const { deps: d, log } = deps({ seconds: 6.28 });
  const res = await wan.handler(d)(event(body({ expected_credits: 1 })));
  assert.equal(res.statusCode, 409);
  assert.equal(log.submitted, null);
  const again = deps({ existing: { id: 'g1', result_url: null, meta: { status: 'processing', checker: 'henshin-check', run_id: 'run-12345678', task_id: 't0' } } });
  const res2 = await wan.handler(again.deps)(event(body({ expected_credits: 154 })));
  assert.equal(res2.statusCode, 200);
  assert.equal(again.log.submitted, null);
});
