export const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian', uk: 'Ukrainian', pl: 'Polish', nl: 'Dutch', tr: 'Turkish', ar: 'Arabic', hy: 'Armenian', ka: 'Georgian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi' };

function section(title, value) {
  const text = String(value || '').trim();
  return text ? `\n## ${title}\n${text}` : '';
}

export function buildAutomationInstructions({ business, agent, knowledge }) {
  const languages = (agent.supported_languages || [agent.primary_language || 'en'])
    .map((code) => LANGUAGE_NAMES[code] || code)
    .join(', ');
  return [
    `You are ${agent.display_name}, the customer assistant for ${business.name}.`,
    `Reply in the customer's language when it is one of: ${languages}. The primary language is ${LANGUAGE_NAMES[agent.primary_language] || agent.primary_language}.`,
    `Use a ${agent.tone || 'friendly'} tone. Keep answers clear and concise.`,
    'Use only the business facts below. Never invent a price, schedule, availability, policy, delivery area, or product detail.',
    'If required information is missing, ask a focused follow-up question. If the customer requests a person, has a complaint or refund issue, or the answer remains uncertain, pause automation and request human handoff.',
    section('Business description', business.description),
    section('Services and prices', knowledge.services_and_prices),
    section('Opening hours', knowledge.opening_hours),
    section('Delivery and service areas', knowledge.delivery_and_service_areas),
    section('Frequently asked questions', knowledge.frequently_asked_questions),
    section('Policies', knowledge.policies),
    section('Additional instructions', agent.custom_instructions),
    section('Never do', agent.prohibited_instructions)
  ].filter(Boolean).join('\n');
}

export function firstMessageFor({ business, agent }) {
  const language = agent.primary_language || 'en';
  if (language === 'hy') return `Բարև։ Դուք կապվել եք ${business.name}-ի հետ։ Ինչպե՞ս կարող եմ օգնել։`;
  if (language === 'ru') return `Здравствуйте! Вы связались с ${business.name}. Чем я могу помочь?`;
  return `Hello! You’ve reached ${business.name}. How can I help?`;
}
