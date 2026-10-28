function section(title, value) {
  const content = String(value || '').trim();
  return content ? `## ${title}\n${content}` : '';
}

// A separate owner-test prompt leaves shared chat/comment instructions intact.
// Business facts and tool schemas supply the context; no collection state
// machine, address rewriting or spelling tool controls the conversation.
export function naturalPhoneInstructions({ business, agent, knowledge, clock, liveBrief = '', catalogBrief = '' }) {
  return [
    `You are ${agent.display_name}, the ${agent.tone || 'friendly'} customer assistant for ${business.name}. This is a live conversation. Listen to the caller's current meaning and respond naturally using the business information and tools below.`,
    'Language: use the language of the caller\'s first meaningful speech throughout the call, changing only if they ask. The opening greeting, background sounds, names, numbers and tool responses do not change that language.',
    'Addresses: treat each street or place name as a personal name dictated by the caller, however unfamiliar it is. Preserve their wording and numbers without replacing them with a known place, translating or completing the name. For this test, repeat the address once naturally. Ask a brief clarification if needed, rather than requiring letter-by-letter spelling.',
    'Use spoken currency names in the caller\'s language. Speak at a normal conversational pace. Read the phone number back in short groups for confirmation, preserving every digit. Let the conversation develop from the latest question, correction or refusal; reuse details already given. A correction replaces the rejected value: briefly repeat only the corrected part and continue, keeping the other details. Use tools for actions the caller wants, collecting their required details naturally. Help a caller who wants to order move to the next missing detail. State business facts accurately and report an action as completed only after its tool succeeds. After completing an action, offer further help and wait, unless the caller has already clearly said goodbye or an equivalent farewell.',
    section('Business description', business.description),
    section('Services and prices', knowledge.services_and_prices),
    section('Opening hours', knowledge.opening_hours),
    section('Delivery and service areas', knowledge.delivery_and_service_areas),
    section('Frequently asked questions', knowledge.frequently_asked_questions),
    section('Policies', knowledge.policies),
    section('Business instructions', agent.custom_instructions),
    section('Business restrictions', agent.prohibited_instructions),
    section('Current business time', clock),
    // liveBrief also includes legacy conversation commands. Keep availability
    // data, leaving action requirements to the enabled tools' schemas.
    section('Available appointment times at call start', liveBrief.split('\n').filter(line => !/^(LIVE booking availability|Booking rules for this reply:|Order rules for this reply:)/.test(line)).join('\n')),
    // The verified snapshot is limited; search remains available for anything
    // outside it. Exclude the old catalog wrapper's conversational commands.
    section('Limited catalog snapshot at call start; search_products can find further products and current details', catalogBrief.split('\n').filter(line => !line.startsWith('## Verified catalog') && !line.startsWith('These facts were fetched')).join('\n')),
  ].filter(Boolean).join('\n\n');
}

// The shared tool schema requires every detail to be read again before setting
// confirmation. The owner phone test uses conversational agreement instead;
// backend validation still requires customer_confirmed === true.
export function naturalPhoneTools(definitions) {
  return definitions.map(definition => {
    const confirmation=definition.parameters?.properties?.customer_confirmed;
    return confirmation ? {...definition,parameters:{...definition.parameters,properties:{...definition.parameters.properties,customer_confirmed:{...confirmation,description:'True after the caller agrees to the current action details, including corrections. Unchanged details do not need to be read back again.'}}}} : definition;
  });
}

// Caption hints use the employee's configured languages. They neither select
// the response language nor turn captions into an input to the voice model.
export function phoneCaptionConfig(agent) {
  const configured = agent.supported_languages?.length
    ? agent.supported_languages : [agent.primary_language].filter(Boolean);
  const languageCodes = [...new Set(configured.flatMap(code => {
    try { return Intl.getCanonicalLocales(code); } catch { return []; }
  }))];
  return languageCodes.length ? { languageCodes } : {};
}
