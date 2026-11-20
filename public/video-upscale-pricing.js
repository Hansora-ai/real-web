(function (root, factory) {
  const pricing = factory();
  if (typeof module === 'object' && module.exports) module.exports = pricing;
  else root.VideoUpscalePricing = pricing;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const rates = Object.freeze({ '1080P': 0.0075, '2K': 0.015, '4K': 0.03 });
  // The $99.99 international PAYG pack has the lowest net revenue per
  // credit. Use the owner's Dodo fee estimate of 5.5% + $0.40 per purchase.
  const netUSDPerCredit = (99.99 * 0.945 - 0.40) / 10_500;
  const maxSeconds = 60;
  const maxBytes = 50_000_000;

  function quote({ resolution, seconds }) {
    resolution = String(resolution || '').toUpperCase();
    if (!Object.hasOwn(rates, resolution)) throw Error('Choose 1080p, 2K or 4K.');
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > maxSeconds) {
      throw Error('Upload a video up to 60 seconds long.');
    }
    const providerCostUSD = rates[resolution] * seconds;
    const displayedCredits = Math.max(1, Math.ceil(providerCostUSD / (netUSDPerCredit * 0.70) - 1e-9));
    return { resolution, seconds, providerCostUSD, displayedCredits, internalCredits: displayedCredits / 10 };
  }

  return { quote, maxSeconds, maxBytes };
});
