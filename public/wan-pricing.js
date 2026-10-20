/* Shared customer prices: one stored credit is ten displayed credits.
 * Reference video seconds are billed alongside output; images/audio add none. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WanPricing = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const rates = Object.freeze({ '480p': .6, '720p': 1, '1080p': 2 });
  function quote({ resolution = '1080p', duration = 5, inputSeconds = 0 } = {}) {
    const quality = String(resolution).toLowerCase(), seconds = Number(duration), source = Number(inputSeconds);
    if (!Object.hasOwn(rates, quality)) throw Error('Choose 480p, 720p or 1080p.');
    if (!Number.isInteger(seconds) || seconds < 2 || seconds > 30) throw Error('Wan 3.0 output must be 2–30 seconds.');
    if (!Number.isFinite(source) || source < 0 || source > 15.0001) throw Error('Wan 3.0 reference videos can total no more than 15 seconds.');
    const billedSeconds = source + seconds;
    if (billedSeconds > 30.0001) throw Error('For Wan 3.0, reference-video duration plus output duration cannot exceed 30 seconds.');
    // Round money once to whole displayed credits, never each clip's duration.
    const displayedCredits = Math.ceil(billedSeconds * rates[quality] * 10 - 1e-8);
    return { internalCredits: displayedCredits / 10, displayedCredits, duration: seconds, inputSeconds: source, billedSeconds, resolution: quality };
  }
  return { quote, rates };
});
