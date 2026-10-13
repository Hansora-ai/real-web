import { messages } from './messages.mjs';

export function languageFor(path = '', declared = 'en') {
  if (/_arm\.html$/i.test(path)) return 'hy';
  if (/_ru\.html$/i.test(path)) return 'ru';
  return /^(hy|ru)$/.test(declared) ? declared : 'en';
}
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Matches only explicitly authored UI messages, never arbitrary words inside media text.
const patterns = Object.keys(messages).filter(key => /\{\d+\}/.test(key)).map(key => {
  const slots = [];
  const parts = key.split(/(\{\d+\})/);
  const expression = parts.map(part => {
    if (/^\{\d+\}$/.test(part)) { slots.push(part.slice(1, -1)); return '([\\s\\S]*?)'; }
    return escape(part);
  }).join('');
  return { key, slots, regex: new RegExp('^' + expression + '$') };
});
export function translate(key, values = {}, language = 'en') {
  key = String(key ?? '');
  let message = messages[key]?.[language] || key;
  if (message === key && language !== 'en' && !messages[key]) {
    for (const pattern of patterns) {
      const match = key.match(pattern.regex);
      if (!match) continue;
      message = messages[pattern.key][language];
      values = Object.fromEntries(pattern.slots.map((slot, i) => [slot, match[i + 1]]));
      break;
    }
  }
  // A replacement callback keeps filenames containing $&, $1, etc. literal.
  return message.replace(/\{(\d+)\}/g, (slot, index) => values[index] === undefined ? slot : String(values[index]));
}
export const language = languageFor(globalThis.location?.pathname, globalThis.document?.documentElement.lang);
export const tr = (key, values) => translate(key, values, language);
// Provider errors remain unchanged until they are shown: cancellation and sign-in checks
// still inspect the original English message. Translate assembled partial-success notices too.
export function errorMessage(message, lang = language) {
  let body = String(message ?? ''), refund = '', partial = '';
  const returned = body.match(/ ([\d.]+)⚡ were returned\.$/);
  if (returned) {
    refund = translate(' {0}⚡ were returned.', {0: returned[1]}, lang);
    body = body.slice(0, -returned[0].length);
  }
  const added = ' Captions for the other videos were added.';
  if (body.endsWith(added)) {
    partial = translate('{0} Captions for the other videos were added.', {0: ''}, lang);
    body = body.slice(0, -added.length);
  }
  return translate(body, {}, lang) + partial + refund;
}
export const localizedHref = (path, lang = language) => path.replace(/(?:_arm|_ru)?\.html(?=$|[?#])/i, `${lang === 'hy' ? '_arm' : lang === 'ru' ? '_ru' : ''}.html`);
