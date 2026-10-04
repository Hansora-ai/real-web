import catalog from '../hansora-catalog/catalog.cjs';

const commonImages = ['Nano Banana 2 Lite', 'Z Image', 'Seedream 5.0 Lite', 'Grok Image', 'Qwen 2'];
const planDetails = {
  premium_monthly: { name: 'Premium', models: [...commonImages, 'Nano Banana 2 1K', 'GPT Image 2 1K', 'Grok Video: 6 seconds'] },
  pro_monthly: { name: 'Pro', models: [...commonImages, 'Nano Banana 2 1K', 'GPT Image 2 1K', 'Grok Video: 6 seconds', 'Veo 3.1 Lite: 720p, 8 seconds'] },
  pro_max_monthly: { name: 'Pro Max', models: [...commonImages, 'Nano Banana 2 1K–2K', 'GPT Image 2 1K–2K', 'Wan 2.7 Image', 'Grok Video: 6 seconds', 'Veo 3.1 Lite: up to 1080p, 8 seconds', 'Kling 2.5 Turbo: 1080p, 5 seconds'] }
};

export const INCLUDED_GENERATION_QUEUE = 'Included no-extra-credit/unlimited generations use a separate queue and can take longer to start or finish. Do not promise an exact wait or completion time. This is a subscription benefit, not free unlimited access for every visitor.';

export function monthlySupportPlans() {
  return catalog.SUBSCRIPTIONS.map(plan => ({
    id: plan.id, name: planDetails[plan.id].name,
    currency: 'USD', price: plan.usd, billingPeriod: 'month',
    monthlyDisplayedCredits: plan.monthlyDisplayedCredits,
    unlimitedModels: planDetails[plan.id].models,
    queuePolicy: INCLUDED_GENERATION_QUEUE
  }));
}

// Authoritative support facts are shared by the website and public-channel agent.
export function monthlySupportKnowledge() {
  return `HANSORA CREATIVE MONTHLY SUBSCRIPTIONS
Hansora Creative offers both pay-as-you-go packages and monthly subscriptions. Never say there are no monthly plans or monthly credits.
${monthlySupportPlans().map(plan => `${plan.name}: $${plan.price} USD/month, includes ${plan.monthlyDisplayedCredits} monthly credits. Included unlimited models/configurations: ${plan.unlimitedModels.join('; ')}.`).join('\n')}
Monthly credits and included unlimited generations are separate benefits. Unlimited applies only to the listed models and configurations, not every model or every resolution/duration. Other models/settings use credits at the verified generation cost.
${INCLUDED_GENERATION_QUEUE}
These are Creative subscriptions, not Automation plans. Use get_credit_packages for the current available pricing records; use the authenticated balance/subscription tool before confirming a customer's own plan. Do not invent renewal, rollover or cancellation terms when they are absent from the saved knowledge.`;
}
