const { launcher } = require('../../lib/images/kie-launcher.cjs');

// https://docs.kie.ai/market/google/nanobanana-2-1
exports.handler = launcher({
  id: 'nano-banana-2-1', name: 'Nano Banana 2.1', maxPrompt: 20000, maxImages: 10,
  defaultAspect: 'auto',
  aspects: ['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
  costs: { '1K': 0.3, '2K': 0.5, '4K': 0.7 },
  payload: ({ prompt, urls, aspect, resolution, format }) => ({
    model: 'nano-banana-2-1',
    input: { prompt, image_input: urls, aspect_ratio: aspect, resolution, output_format: format === 'jpeg' ? 'jpg' : format }
  })
});
