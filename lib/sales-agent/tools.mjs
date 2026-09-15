import catalog from '../hansora-catalog/catalog.cjs';
import { rows, supabaseRequest } from './db.mjs';

const { MODELS, CREDIT_DISPLAY_MULTIPLIER, normalizeModelId, quoteModel, getPackages, toDisplayedCredits } = catalog;

function loginRequired() {
  return { ok: false, error: 'login_required' };
}

async function profileFor(userId) {
  return rows(await supabaseRequest(
    `/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=credits,monthly_credits,payg_credits,language&limit=1`
  ))[0] || null;
}

async function subscriptionFor(userId) {
  return rows(await supabaseRequest(
    `/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=status,plan_id,unlimited_models,current_period_end,cancel_at_period_end&limit=1`
  ))[0] || null;
}

function compactGeneration(row) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    id: row.id,
    createdAt: row.created_at,
    provider: row.provider,
    kind: row.kind,
    status: meta.status || (row.result_url ? 'completed' : 'unknown'),
    model: meta.model || meta.engine || row.provider || null,
    chargedInternalCredits: Number(meta.charged_cost ?? meta.charge_cost ?? meta.debited ?? 0) || 0,
    refundedInternalCredits: Number(meta.refunded_amount ?? 0) || 0,
    hasResult: Boolean(row.result_url)
  };
}

export const TOOL_DEFINITIONS = [
  {
    type: 'function', name: 'get_available_models', strict: true,
    description: 'List approved Hansora models and their sales guidance. Use for choosing or comparing models; no account lookup.',
    parameters: { type: 'object', properties: { category: { type: ['string', 'null'], enum: ['image', 'video', null] } }, required: ['category'], additionalProperties: false }
  },
  {
    type: 'function', name: 'get_model_details', strict: true,
    description: 'Get reviewed Hansora knowledge for one model.',
    parameters: { type: 'object', properties: { model_id: { type: 'string' } }, required: ['model_id'], additionalProperties: false }
  },
  {
    type: 'function', name: 'get_model_current_price', strict: true,
    description: 'Calculate the current Hansora credit cost for a supported model configuration. Always use before stating a generation cost.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        model_id: { type: 'string' }, duration: { type: ['number', 'null'] }, resolution: { type: ['string', 'null'] },
        quantity: { type: ['integer', 'null'] }, has_video_input: { type: ['boolean', 'null'] }, sound: { type: ['boolean', 'null'] }
      },
      required: ['model_id', 'duration', 'resolution', 'quantity', 'has_video_input', 'sound']
    }
  },
  {
    type: 'function', name: 'get_credit_packages', strict: true,
    description: 'Return current credit-sale package prices and the smallest sufficient option for a required credit amount.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { currency: { type: 'string', enum: ['USD', 'RUB'] }, required_displayed_credits: { type: ['number', 'null'] } },
      required: ['currency', 'required_displayed_credits']
    }
  },
  {
    type: 'function', name: 'get_user_credit_balance', strict: true,
    description: 'Read the authenticated user’s current credit balance and subscription. Use only for balance or affordability questions.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
  },
  {
    type: 'function', name: 'get_user_generation_history', strict: true,
    description: 'Read a compact recent generation history for the authenticated user.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['limit'], additionalProperties: false }
  },
  {
    type: 'function', name: 'get_recent_failed_generations', strict: true,
    description: 'Check recent failed generations and recorded refunds for the authenticated user. Use before discussing a specific failure.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['limit'], additionalProperties: false }
  },
  {
    type: 'function', name: 'get_payment_status', strict: true,
    description: 'Read the authenticated user’s latest payment statuses. Never return raw provider payloads.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['limit'], additionalProperties: false }
  },
  {
    type: 'function', name: 'get_course_access_status', strict: true,
    description: 'Check whether the authenticated user has access to the Armenian/Russian course based on a completed credit purchase.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
  }
];

export async function executeTool(name, args, { user } = {}) {
  if (name === 'get_available_models') {
    const category = args.category || null;
    return { ok: true, models: Object.values(MODELS).filter((model) => !category || model.category === category) };
  }
  if (name === 'get_model_details') {
    const id = normalizeModelId(args.model_id);
    return id ? { ok: true, model: MODELS[id] } : { ok: false, error: 'unsupported_model' };
  }
  if (name === 'get_model_current_price') {
    try {
      return { ok: true, quote: quoteModel(args.model_id, args) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  if (name === 'get_credit_packages') {
    const requiredDisplayed = Math.max(0, Number(args.required_displayed_credits) || 0);
    const packages = getPackages({
      currency: args.currency,
      requiredInternalCredits: requiredDisplayed / CREDIT_DISPLAY_MULTIPLIER
    });
    return {
      ok: true,
      saleActive: true,
      saleEnd: null,
      packages,
      smallestSufficientPackageId: packages.find((entry) => entry.sufficient)?.id || null
    };
  }

  if (!user?.id) return loginRequired();

  if (name === 'get_user_credit_balance') {
    const [profile, subscription] = await Promise.all([profileFor(user.id), subscriptionFor(user.id)]);
    if (!profile) return { ok: false, error: 'profile_not_found' };
    return {
      ok: true,
      balance: {
        internalCredits: Number(profile.credits || 0),
        displayedCredits: toDisplayedCredits(profile.credits),
        monthlyDisplayedCredits: toDisplayedCredits(profile.monthly_credits),
        paygDisplayedCredits: toDisplayedCredits(profile.payg_credits)
      },
      subscription,
      checkedAt: new Date().toISOString()
    };
  }
  if (name === 'get_user_generation_history' || name === 'get_recent_failed_generations') {
    const requested = Math.max(1, Math.min(10, Number(args.limit) || 5));
    const recent = rows(await supabaseRequest(
      `/rest/v1/user_generations?user_id=eq.${encodeURIComponent(user.id)}&select=id,created_at,provider,kind,result_url,meta&order=created_at.desc&limit=${name === 'get_recent_failed_generations' ? 30 : requested}`
    )).map(compactGeneration);
    if (name === 'get_user_generation_history') return { ok: true, generations: recent.slice(0, requested) };
    const failed = recent.filter((item) => ['failed', 'error', 'cancelled'].includes(String(item.status).toLowerCase())).slice(0, requested);
    const refunds = rows(await supabaseRequest(
      `/rest/v1/refund_ledger?user_id=eq.${encodeURIComponent(user.id)}&select=generation_id,run_id,amount,reason,created_at&order=created_at.desc&limit=${requested}`
    ));
    return {
      ok: true,
      failed,
      refunds: refunds.map((row) => ({ ...row, displayedCredits: toDisplayedCredits(row.amount) })),
      checkedAt: new Date().toISOString()
    };
  }
  if (name === 'get_payment_status') {
    const limit = Math.max(1, Math.min(5, Number(args.limit) || 3));
    const payments = rows(await supabaseRequest(
      `/rest/v1/payments?uid=eq.${encodeURIComponent(user.id)}&select=id,transaction_id,credits,amount_cents,currency,status,provider,created_at,paid_at&order=created_at.desc&limit=${limit}`
    ));
    return {
      ok: true,
      payments: payments.map((payment) => ({
        id: payment.id,
        transactionId: payment.transaction_id,
        displayedCredits: toDisplayedCredits(payment.credits),
        amountCents: payment.amount_cents,
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        createdAt: payment.created_at,
        paidAt: payment.paid_at
      }))
    };
  }
  if (name === 'get_course_access_status') {
    const payments = rows(await supabaseRequest(
      `/rest/v1/payments?uid=eq.${encodeURIComponent(user.id)}&credits=gt.0&select=id,status,paid_at,created_at&order=created_at.desc&limit=20`
    ));
    const accepted = new Set(['paid', 'succeeded', 'successful', 'completed']);
    const qualifying = payments.find((payment) => accepted.has(String(payment.status || '').toLowerCase()));
    return {
      ok: true,
      hasAccess: Boolean(qualifying),
      languages: ['hy', 'ru'],
      reason: qualifying ? 'completed_credit_purchase' : 'no_completed_credit_purchase_found',
      checkedAt: new Date().toISOString()
    };
  }
  return { ok: false, error: 'unknown_tool' };
}
