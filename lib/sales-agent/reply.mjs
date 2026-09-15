import catalog from '../hansora-catalog/catalog.cjs';

const { MODELS, CREDIT_PACKAGES, normalizeModelId } = catalog;
const INTENTS = new Set(['qualification', 'model_recommendation', 'pricing', 'account', 'support', 'course', 'general']);
const ACTION_TYPES = new Set(['open_pricing', 'open_model', 'open_course', 'contact_support', 'open_login']);

export const REPLY_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 2000 },
    language: { type: 'string', enum: ['en', 'hy', 'ru'] },
    intent: { type: 'string', enum: [...INTENTS] },
    recommended_model: { type: ['string', 'null'] },
    recommended_package: { type: ['string', 'null'] },
    quote_id: { type: ['string', 'null'] },
    memory: {
      type: 'object', additionalProperties: false,
      properties: {
        business_type: { type: ['string', 'null'], maxLength: 120 },
        main_goal: { type: ['string', 'null'], maxLength: 300 },
        objection: { type: ['string', 'null'], maxLength: 160 },
        purchase_intent: { type: 'string', enum: ['unknown', 'low', 'medium', 'high'] }
      },
      required: ['business_type', 'main_goal', 'objection', 'purchase_intent']
    },
    actions: {
      type: 'array', maxItems: 2,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          type: { type: 'string', enum: [...ACTION_TYPES] },
          label: { type: 'string', minLength: 1, maxLength: 80 },
          model: { type: ['string', 'null'] },
          package: { type: ['string', 'null'] }
        },
        required: ['type', 'label', 'model', 'package']
      }
    }
  },
  required: ['message', 'language', 'intent', 'recommended_model', 'recommended_package', 'quote_id', 'memory', 'actions']
};

export function validateReply(value) {
  if (!value || typeof value !== 'object') throw new Error('invalid_model_reply');
  const message = String(value.message || '').trim().slice(0, 2000);
  if (!message) throw new Error('empty_model_reply');
  const language = ['en', 'hy', 'ru'].includes(value.language) ? value.language : 'en';
  const intent = INTENTS.has(value.intent) ? value.intent : 'general';
  const recommendedModel = value.recommended_model ? normalizeModelId(value.recommended_model) : null;
  const packageIds = new Set(CREDIT_PACKAGES.map((entry) => entry.id));
  const recommendedPackage = packageIds.has(value.recommended_package) ? value.recommended_package : null;
  const actions = (Array.isArray(value.actions) ? value.actions : []).slice(0, 2).flatMap((action) => {
    if (!ACTION_TYPES.has(action?.type)) return [];
    const model = action.type === 'open_model' ? normalizeModelId(action.model) : null;
    const packageId = action.type === 'open_pricing' && packageIds.has(action.package) ? action.package : null;
    if (action.type === 'open_model' && !model) return [];
    return [{
      type: action.type,
      label: String(action.label || '').trim().slice(0, 80) || 'Continue',
      model,
      package: packageId
    }];
  });
  const memoryValue = value.memory && typeof value.memory === 'object' ? value.memory : {};
  const cleanMemory = (field, max) => typeof memoryValue[field] === 'string' && memoryValue[field].trim()
    ? memoryValue[field].trim().slice(0, max) : null;
  return {
    message,
    language,
    intent,
    recommended_model: recommendedModel && MODELS[recommendedModel] ? recommendedModel : null,
    recommended_package: recommendedPackage,
    quote_id: typeof value.quote_id === 'string' ? value.quote_id.slice(0, 120) : null,
    memory: {
      business_type: cleanMemory('business_type', 120),
      main_goal: cleanMemory('main_goal', 300),
      objection: cleanMemory('objection', 160),
      purchase_intent: ['low', 'medium', 'high'].includes(memoryValue.purchase_intent) ? memoryValue.purchase_intent : 'unknown'
    },
    actions
  };
}
