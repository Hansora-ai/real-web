(function attachHansoraContentFilter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HansoraContentFilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHansoraContentFilter() {
  'use strict';

  const POLICY_VERSION = '2026-08-11.1';

  const NSFW_TERMS = [
    'adult content', 'bare breasts', 'blow job', 'blowjob', 'boob', 'boobs',
    'breast', 'breasts', 'clit', 'cock', 'dick', 'erotic', 'explicit sex',
    'fetish', 'fuck', 'fucking', 'genital', 'genitals', 'hardcore', 'hentai',
    'jerk off', 'lingerie nude', 'masturbate', 'masturbating', 'masturbation',
    'milf', 'naked', 'no clothes', 'nude', 'nudity', 'onlyfans', 'orgasm',
    'penis', 'porn', 'pornographic', 'pussy', 'sex', 'sexual', 'slut',
    'strip naked', 'topless', 'undress', 'vagina', 'vergina', 'whore',
    'without clothes', 'xxx',
    // Common non-English terms used on a multilingual product.
    'desnuda', 'desnudo', 'sexo', 'pornografia', 'nue', 'nu', 'sexe',
    'голая', 'голый', 'обнаженная', 'обнаженный', 'порно', 'секс'
  ];

  const MINOR_TERMS = [
    'baby', 'boy', 'child', 'children', 'girl', 'high schooler', 'kid', 'kids',
    'minor', 'schoolgirl', 'schoolboy', 'teen', 'teenage', 'teenager',
    'underage', 'young looking'
  ];

  const DECEPTIVE_DEEPFAKE_TERMS = [
    'deep fake', 'deepfake', 'fake endorsement', 'fake identity',
    'fake interview', 'fake news clip', 'fake passport', 'fake statement',
    'impersonate', 'impersonation', 'make it look authentic',
    'make it look like they said', 'make them confess', 'make them endorse',
    'pretend to be', 'without their consent'
  ];

  const FRAUD_TERMS = [
    'bypass face id', 'bypass facial recognition', 'bypass identity check',
    'bypass identity verification',
    'bypass kyc', 'evade identity verification', 'fake id', 'fake verification',
    'fraud call', 'scam video', 'steal their identity', 'verification bypass'
  ];

  function normalizePrompt(value) {
    let text = String(value || '').normalize('NFKD').toLowerCase();
    text = text.replace(/[\u0300-\u036f]/g, '');
    text = text.replace(/[013457@$]/g, function replaceLeet(character) {
      return ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' })[character] || character;
    });
    text = text.replace(/(.)\1{2,}/g, '$1$1');
    text = text.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    return text.replace(/\s+/g, ' ').trim();
  }

  function containsTerm(normalized, terms) {
    const padded = ` ${normalized} `;
    if (terms.some(function includesTerm(term) {
      return padded.includes(` ${normalizePrompt(term)} `);
    })) return true;

    // Catch deliberately separated words such as "s e x" or "n.u.d.e".
    const termTokens = new Set(terms.map(normalizePrompt).filter(function singleToken(term) {
      return term && !term.includes(' ');
    }));
    const tokens = normalized.split(' ');
    for (let start = 0; start < tokens.length; start += 1) {
      if (!/^[a-z0-9]$/.test(tokens[start])) continue;
      let joined = '';
      for (let end = start; end < Math.min(tokens.length, start + 16); end += 1) {
        if (!/^[a-z0-9]$/.test(tokens[end])) break;
        joined += tokens[end];
        if (joined.length >= 3) {
          for (const term of termTokens) {
            if (joined === term || joined.endsWith(term)) return true;
          }
        }
      }
    }
    return false;
  }

  function evaluatePrompt(prompt) {
    const normalized = normalizePrompt(prompt);
    if (!normalized) {
      return { allowed: true, category: null, policyVersion: POLICY_VERSION };
    }

    const sexual = containsTerm(normalized, NSFW_TERMS);
    const minor = containsTerm(normalized, MINOR_TERMS);

    if (sexual && minor) {
      return { allowed: false, category: 'sexual_content_involving_minors', policyVersion: POLICY_VERSION };
    }
    if (sexual) {
      return { allowed: false, category: 'nsfw_sexual_content', policyVersion: POLICY_VERSION };
    }
    if (containsTerm(normalized, FRAUD_TERMS)) {
      return { allowed: false, category: 'identity_fraud', policyVersion: POLICY_VERSION };
    }
    if (containsTerm(normalized, DECEPTIVE_DEEPFAKE_TERMS)) {
      return { allowed: false, category: 'harmful_or_deceptive_deepfake', policyVersion: POLICY_VERSION };
    }

    const deceptiveConstruction = /\b(?:make|show|create|generate)\b.{0,80}\b(?:celebrity|politician|president|prime minister|public figure|real person)\b.{0,80}\b(?:say|confess|endorse|promote|admit)\b/.test(normalized);
    const fabricatedMedia = /\bfake\b.{0,40}\b(?:video|photo|image|recording|speech)\b.{0,80}\b(?:celebrity|politician|president|public figure|real person)\b/.test(normalized);
    if (deceptiveConstruction || fabricatedMedia) {
      return { allowed: false, category: 'harmful_or_deceptive_deepfake', policyVersion: POLICY_VERSION };
    }

    return { allowed: true, category: null, policyVersion: POLICY_VERSION };
  }

  function publicMessage(decision) {
    if (!decision || decision.allowed) return '';
    if (decision.category === 'nsfw_sexual_content' || decision.category === 'sexual_content_involving_minors') {
      return 'This request was blocked because NSFW or sexual content is not allowed.';
    }
    return 'This request was blocked because harmful or deceptive deepfake content is not allowed.';
  }

  return Object.freeze({
    POLICY_VERSION,
    evaluatePrompt,
    normalizePrompt,
    publicMessage
  });
});
