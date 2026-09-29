export const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian', uk: 'Ukrainian', pl: 'Polish', nl: 'Dutch', tr: 'Turkish', ar: 'Arabic', hy: 'Armenian', ka: 'Georgian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi' };

function section(title, value) {
  const text = String(value || '').trim();
  return text ? `\n## ${title}\n${text}` : '';
}

export function buildAutomationInstructions({ business, agent, knowledge }) {
  const codes = agent.supported_languages?.length ? agent.supported_languages : [agent.primary_language || 'en'];
  const name = (code) => LANGUAGE_NAMES[code] || code;
  const languages = codes.map(name).join(', ');
  const primary = name(codes.includes(agent.primary_language) ? agent.primary_language : codes[0]);
  // The owner picks the languages. The customer's alphabet never decides the reply language or script.
  const languageRule = codes.length === 1
    ? `Always reply in ${primary} only, whatever language or alphabet the customer writes in.`
    : `Reply in the customer's language if it is one of: ${languages}. If the customer writes in any other language, reply in ${primary}.`;
  return [
    `You are ${agent.display_name}, the customer assistant for ${business.name}.`,
    languageRule,
    'Customers often type their language in Latin letters (for example Armenian as "barev, qani a?" or Russian as "privet, skolko stoit?"). Recognize the language from the words, not from the alphabet.',
    'Always write your reply in the standard alphabet of the reply language (Armenian in Armenian letters, Russian in Cyrillic, and so on), even when the customer used Latin letters. Never mix alphabets in one reply.',
    'Each message may arrive with the earlier messages of the same chat as context. Treat them as the ongoing conversation: greet and introduce yourself only in your first reply, remember what the customer already said, and never ask again for details they already gave.',
    'Write every word only in the letters of its own language. Armenian uses only Armenian letters (Ա–Ֆ, ա–ֆ): never put Georgian, Cyrillic or Latin letters inside an Armenian word.',
    'Write like a person in a chat: usually 1–3 short sentences. If the customer only greets you, greet back briefly and ask how you can help, without introducing the whole business. Give details only when the customer asks for them.',
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
