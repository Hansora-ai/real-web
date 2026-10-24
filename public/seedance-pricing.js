/* Shared by the browser, launchers and public catalog. Values are stored credits;
 * the site displays 10 credits for each stored credit. Never use provider credits
 * as Hansora credits. Published reAPI rate card checked 2026-10-20. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SeedancePricing = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const margins = { '480p': .18, '720p': .16, '1080p': .15, '4k': .15 };
  const rates = {
    seedance25: { text: { '480p': .119, '720p': .267, '1080p': .643 }, video: { '480p': .072, '720p': .161, '1080p': .384 } },
    seedance20: { text: { '480p': .072, '720p': .154, '1080p': .383, '4k': .780 }, video: { '480p': .044, '720p': .094, '1080p': .233, '4k': .480 } },
    fast: { text: { '480p': .057, '720p': .121 }, video: { '480p': .033, '720p': .073 } }
  };
  const henshinRates = { '480p': 1.75, '720p': 3.8, '1080p': 9 };
  // Round up to whole displayed credits: profiles.credits stores 0.1 steps.
  const round = amount => Math.ceil(amount * 10 - 1e-8) / 10;
  function quote({ model = 'seedance25', variant = 'standard', resolution = '720p', duration = 5, inputSeconds = 0, edit = false } = {}) {
    const quality = String(resolution).toLowerCase();
    const key = model === 'seedance20' && ['fast', 'lite'].includes(variant) ? 'fast' : model;
    const source = Number(inputSeconds);
    const seconds = edit ? Math.ceil(source) : Number(duration);
    const max = model === 'seedance25' ? 30 : 15;
    if (!Number.isFinite(source) || source < 0 || source > max + .0001 || !Number.isInteger(seconds) || seconds < 4 || seconds > max) throw Error('Invalid Seedance duration.');
    const rate = rates[key]?.[source > 0 ? 'video' : 'text']?.[quality];
    if (!rate) throw Error('Unsupported Seedance resolution.');
    let billedSeconds = Math.ceil(source) + seconds;
    if (model === 'seedance25' && source > 0) billedSeconds = Math.max(billedSeconds, Math.ceil(5 * seconds / 3));
    // The agreed Henshin/video-input prices apply to both Search and Henshin.
    const internalCredits = model === 'seedance25' && source > 0
      ? round(billedSeconds * henshinRates[quality] / 2)
      : round(rate * billedSeconds * 10 / (1 - margins[quality]));
    return { internalCredits, displayedCredits: Math.round(internalCredits * 10), duration: seconds, inputSeconds: source, billedSeconds, resolution: quality, providerCostUSD: Math.ceil(rate * billedSeconds * 1000 - 1e-8) / 1000 };
  }
  // Draft finalization uses the no-video 1080p rate for output + original
  // reference seconds. The normal reference-video minimum does not apply.
  function quoteFinal({ duration, inputSeconds = 0 } = {}) {
    const seconds = Number(duration), source = Number(inputSeconds);
    if (!Number.isInteger(seconds) || seconds < 4 || seconds > 30 || !Number.isFinite(source) || source < 0 || source > 30.0001) throw Error('Invalid Seedance draft duration.');
    const billedSeconds = seconds + Math.ceil(source);
    const providerCostUSD = Math.ceil(rates.seedance25.text['1080p'] * billedSeconds * 1000 - 1e-8) / 1000;
    const internalCredits = round(providerCostUSD * 10 / .95);
    return { duration: seconds, inputSeconds: source, billedSeconds, resolution: '1080p', providerCostUSD, internalCredits, displayedCredits: Math.round(internalCredits * 10) };
  }
  return { quote, quoteFinal, henshinRates };
});
