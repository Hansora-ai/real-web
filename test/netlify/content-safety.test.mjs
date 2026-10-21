import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { evaluatePrompt, evaluateWithModeration } = createRequire(import.meta.url)('../../netlify/functions/safe-run.cjs');

test('sexual requests phrased without explicit words are blocked', () => {
  for (const prompt of [
    "She talks to me how she's always wanted to date me and how she will suck me off. (She's dressed like the second picture)",
    'She flirts and teases about sucking',
    'give him head',
    'she gives a handjob',
    'cum on her face',
    'horny girl in bed',
    'go down on him',
    'suck his dick',
    'she sucks his cock',
    'dick pic',
    'she shows her tits',
    'grab her tits',
    'her nipples',
    'she is so horny',
    'horny girl in bed'
  ]) assert.equal(evaluatePrompt(prompt).category, 'nsfw_sexual_content', prompt);
});

test('the same words in an everyday meaning still pass: context decides, not the word', () => {
  for (const prompt of [
    'She flirts and teases me',
    'suck it up and keep running',
    'a baby sucking its thumb',
    'vacuum sucks up dust',
    'a hummingbird sucks nectar',
    'she graduated summa cum laude',
    'the team gives a head start',
    'the elevator goes down on time',
    'a cock crowing at dawn on the farm',
    'blue tits singing on a branch',
    'Moby Dick whale chase',
    'Philip K. Dick style sci-fi city',
    'Dick Van Dyke dancing on rooftops',
    'a horny toad in the desert',
    'baby bottle nipples',
    'she sucks a lollipop',
    'male and female sex of the bird',
    'a cocktail party'
  ]) assert.equal(evaluatePrompt(prompt).allowed, true, prompt);
});

test('OpenAI moderation reads the meaning: "she sucks me" is blocked, "she sucks, I don\'t want to talk to her" is not', async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  const seen = [];
  globalThis.fetch = async (url, options) => {
    const { input, model } = JSON.parse(options.body);
    seen.push({ url, model });
    const sexual = /sucks me|suks me|sucking me/.test(input) && !/talk to her/.test(input);
    return new Response(JSON.stringify({ results: [{ categories: { sexual, 'sexual/minors': false } }] }), { status: 200 });
  };
  try {
    assert.equal((await evaluateWithModeration('shee suks me')).category, 'nsfw_sexual_content');
    assert.equal((await evaluateWithModeration('she is sucking me slowly')).source, 'moderation');
    assert.equal((await evaluateWithModeration("she sucks man i don't want to talk to her")).allowed, true);
    assert.equal((await evaluateWithModeration('this movie sucks')).allowed, true);
    assert.deepEqual(seen[0], { url: 'https://api.openai.com/v1/moderations', model: 'omni-moderation-latest' });

    // Clear words are blocked by the filter without asking OpenAI.
    const before = seen.length;
    assert.equal((await evaluateWithModeration('porn video')).allowed, false);
    assert.equal(seen.length, before);

    // If OpenAI is unreachable, the word filter alone decides.
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal((await evaluateWithModeration('a calm lake')).allowed, true);
    assert.equal((await evaluateWithModeration('suck his dick')).allowed, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
  }
});
