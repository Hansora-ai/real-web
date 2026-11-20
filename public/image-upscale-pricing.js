(function (root, factory) {
  const pricing = factory();
  if (typeof module === 'object' && module.exports) module.exports = pricing;
  else root.ImageUpscalePricing = pricing;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const factors = Object.freeze([1, 2, 4, 8]);
  const maxBytes = 20_000_000;
  const tiers = Object.freeze([
    { name: '2K', maxPixels: 2048 ** 2, providerCostUSD: 0.0075 },
    { name: '4K', maxPixels: 4096 ** 2, providerCostUSD: 0.02 },
    { name: '8K', maxPixels: 8192 ** 2, providerCostUSD: 0.06 }
  ]);
  // Same $99.99 international PAYG pack and checkout fee as Video Upscale.
  const netUSDPerCredit = (99.99 * 0.945 - 0.40) / 10_500;

  function quote({ factor, width, height }) {
    if (!factors.includes(factor)) throw Error('Choose 1×, 2×, 4× or 8×.');
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw Error('Upload a readable image.');
    }
    const outputWidth = width * factor;
    const outputHeight = height * factor;
    const tier = tiers.find(item => outputWidth * outputHeight <= item.maxPixels);
    if (!tier || outputWidth > 16384 || outputHeight > 16384) {
      throw Error('Output is too large. Choose a smaller scale or source image.');
    }
    const displayedCredits = Math.ceil(tier.providerCostUSD / (netUSDPerCredit * 0.70));
    return {
      factor, width, height, outputWidth, outputHeight,
      resolution: tier.name, providerCostUSD: tier.providerCostUSD,
      displayedCredits, internalCredits: displayedCredits / 10
    };
  }

  function providerCostForTier(name) {
    return tiers.find(tier => tier.name === name)?.providerCostUSD ?? null;
  }

  return { factors, maxBytes, quote, providerCostForTier };
});
