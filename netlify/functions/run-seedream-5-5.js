const { launcher } = require('../../lib/images/kie-launcher.cjs');
const pricing = require('../../public/new-image-pricing.js');

// https://docs.kie.ai/market/seedream/5-5-text-to-image
// https://docs.kie.ai/market/seedream/5-5-image-to-image
// Text-to-image needs a fixed aspect ratio; image-to-image also accepts "auto" (follows the first image).
// KIE bills every input image as well as the output, so the price depends on how many images are uploaded.
exports.handler = launcher({
  id: 'seedream-5-5', name: 'Seedream 5.5', minPrompt: 5, maxPrompt: 5000, maxImages: 10,
  defaultAspect: '1:1', aspects: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
  costs: { '1K': 0.3, '1.5K': 0.3, '2K': 0.45 },
  cost: ({ resolution, imageCount }) => pricing.quote('seedream-5-5', { resolution, imageCount }).internalCredits,
  payload: ({ prompt, urls, aspect, resolution, format }) => ({
    model: urls.length ? 'seedream/5-5-image-to-image' : 'seedream/5-5-text-to-image',
    input: {
      prompt, aspect_ratio: aspect === 'auto' && !urls.length ? '1:1' : aspect, size: resolution,
      output_format: format === 'jpg' ? 'jpeg' : format, nsfw_checker: true, ...(urls.length ? { image_urls: urls } : {})
    }
  })
});
