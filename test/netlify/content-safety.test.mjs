import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { evaluatePrompt } = createRequire(import.meta.url)('../../netlify/functions/safe-run.cjs');

test('sexual requests phrased without explicit words are blocked', () => {
  for (const prompt of [
    "She talks to me how she's always wanted to date me and how she will suck me off. (She's dressed like the second picture)",
    'She flirts and teases about sucking',
    'give him head',
    'she gives a handjob',
    'cum on her face',
    'horny girl in bed',
    'go down on him'
  ]) assert.equal(evaluatePrompt(prompt).category, 'nsfw_sexual_content', prompt);
});

test('everyday phrases with the same words still pass', () => {
  for (const prompt of [
    'She flirts and teases me',
    'suck it up and keep running',
    'a baby sucking its thumb',
    'vacuum sucks up dust',
    'a hummingbird sucks nectar',
    'she graduated summa cum laude',
    'the team gives a head start',
    'the elevator goes down on time'
  ]) assert.equal(evaluatePrompt(prompt).allowed, true, prompt);
});
