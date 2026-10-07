const { launcher } = require('../../lib/images/kie-launcher.cjs');

// Generation/edit endpoints; this does not use the separate layers model.
// https://docs.kie.ai/market/seedream/5-flash-text-to-image
// https://docs.kie.ai/market/seedream/5-flash-image-to-image
exports.handler = launcher({
  id: 'seedream-5-flash', name: 'Seedream 5 Flash', maxPrompt: 5000, maxImages: 10,
  defaultAspect: '1:1', aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
  costs: { '1K': 0.3, '2K': 0.3 },
  payload: ({ prompt, urls, aspect, resolution, format }) => ({
    model: urls.length ? 'seedream/5-flash-image-to-image' : 'seedream/5-flash-text-to-image',
    input: { prompt, aspect_ratio: aspect, size: resolution, output_format: format === 'jpg' ? 'jpeg' : format, nsfw_checker: true, ...(urls.length ? { image_urls: urls } : {}) }
  })
});
