const { launcher } = require('../../lib/images/kie-launcher.cjs');
const pricing = require('../../public/new-image-pricing.js');

// https://docs.kie.ai/market/flux3/klein-text-to-image
// https://docs.kie.ai/market/flux3/klein-edit-image
// One image per request (num_images defaults to 1). Reference images are free; "auto" follows the first image.
exports.handler = launcher({
  id: 'flux-3-klein', name: 'FLUX 3 Klein', maxPrompt: 5000, maxImages: 10,
  defaultAspect: '1:1', aspects: ['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', '9:21'],
  costs: { '1K': 0.12, '2K': 0.18, '4K': 0.47 },
  cost: ({ resolution, imageCount }) => pricing.quote('flux-3-klein', { resolution, imageCount }).internalCredits,
  payload: ({ prompt, urls, aspect, resolution, format }) => ({
    model: urls.length ? 'flux-3/klein-edit-image' : 'flux-3/klein-text-to-image',
    input: {
      prompt, aspect_ratio: aspect === 'auto' && !urls.length ? '1:1' : aspect, resolution,
      output_format: format === 'jpg' ? 'jpeg' : format, nsfw_checker: true, ...(urls.length ? { image_urls: urls } : {})
    }
  })
});
