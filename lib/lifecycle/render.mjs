// Turns a planned send into the subject, HTML and plain text, using the approved templates.
import { TEMPLATES } from './templates.data.mjs';

export const SUBJECTS = {
  abandoned: { en: 'You left checkout unfinished', hy: 'Վճարումը չի ավարտվել', ru: 'Оплата не завершена' },
  prices: { en: 'Quick question about prices', hy: 'Հարց գների մասին', ru: 'Вопрос по ценам' },
  welcome: { en: 'Create without a monthly subscription' }
};
const FILES = {
  abandoned: { en: 'abandoned-a1-en', hy: 'abandoned-a2-hy', ru: 'abandoned-a3-ru' },
  prices: { en: 'prices-b1-en', hy: 'prices-b2-hy', ru: 'prices-b3-ru' },
  welcome: { en: 'welcome-en' },
  credits_used: { en: 'credits-used-en' }
};
const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function file(name) {
  const value = TEMPLATES[name];
  if (typeof value !== 'string') throw new Error(`lifecycle_template_missing:${name}`);
  return value;
}

function creditsUsed({ count, word, isVideo, creditsSpent, model, usedUp }) {
  const made = `${count} ${word}`;
  let html = file('credits-used-en.html')
    .replace(/\{\{first_name_greeting\}\}/g, 'Hi there,')
    .replace(/\{\{videos\}\} \{\{videos_word\}\}/g, escapeHtml(made))
    .replace(/\{\{videos\}\}/g, String(count))
    .replace(/\{\{credits_spent\}\}/g, String(creditsSpent))
    .replace(/\{\{top_model\}\}/g, escapeHtml(model));
  if (!isVideo) html = html.replace('padding-top:4px;">videos made', 'padding-top:4px;">images made');
  if (!usedUp) html = html.replace('Your free credits are used up. Here is', 'Here is').replace('Your free credits are used up. Credit packs', 'Credit packs');
  const text = file('credits-used-en.txt')
    .replace("You've made 1 video with Hansora, and your free credits are used up.", usedUp ? `You've made ${made} with Hansora, and your free credits are used up.` : `You've made ${made} with Hansora.`)
    .replace('So far: 16 credits spent, 1 video made, top model Grok Imagine.', `So far: ${creditsSpent} credits spent, ${made} made, top model ${model}.`);
  return { subject: `You've made ${made} with Hansora`, html, text };
}

export function renderEmail(send) {
  let result;
  if (send.campaign === 'credits_used') result = creditsUsed(send.vars || {});
  else {
    const lang = FILES[send.campaign]?.[send.lang] ? send.lang : 'en';
    const name = FILES[send.campaign]?.[lang];
    if (!name) throw new Error(`lifecycle_unknown_campaign:${send.campaign}`);
    result = { subject: SUBJECTS[send.campaign][lang], html: file(`${name}.html`), text: file(`${name}.txt`) };
  }
  if (/\{\{/.test(result.html) || /\{\{/.test(result.text)) throw new Error(`lifecycle_unfilled_placeholder:${send.campaign}`);
  return result;
}
