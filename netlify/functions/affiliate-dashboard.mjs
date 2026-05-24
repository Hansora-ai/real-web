// netlify/functions/affiliate-dashboard.mjs
// HANSORA AI — Affiliate dashboard API
// Returns fast affiliate summary + recent referral rows for the logged-in user.
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return json(204, {});
    if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: 'Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return json(401, { error: 'Missing Authorization token' });

    async function sjson(res) {
      try { return await res.json(); } catch { return null; }
    }

    async function rest(path, options = {}) {
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        ...(options.headers || {})
      };
      return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers });
    }

    async function authUser() {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY
        }
      });
      const body = await sjson(res);
      if (!res.ok || !body || !body.id) {
        return null;
      }
      return body;
    }

    const user = await authUser();
    if (!user) return json(401, { error: 'Invalid or expired session' });

    const limitParam = event.queryStringParameters?.limit || new URLSearchParams(event.rawQuery || '').get('limit');
    const limit = clampInt(limitParam, 1, 100, 50);
    const account = await ensureAffiliateAccount(user.id, rest, sjson);

    let summary = null;
    let recent = null;

    try {
      summary = await getSummaryViaRpc(user.id, rest, sjson);
      recent = await getRecentViaRpc(user.id, limit, rest, sjson);
    } catch (error) {
      console.warn('affiliate dashboard RPC fallback:', error?.message || error);
    }

    if (!summary || !Array.isArray(recent)) {
      const fallback = await buildSummaryFallback(user.id, limit, rest, sjson);
      summary = fallback.summary;
      recent = fallback.recent;
    }

    const origin = event.headers.origin || event.headers.Origin || '';
    const siteOrigin = origin || 'https://hansora.co';
    const affiliateLink = `${siteOrigin.replace(/\/$/, '')}/?ref=${encodeURIComponent(account.affiliate_code)}`;

    return json(200, {
      ok: true,
      user_id: user.id,
      email: user.email || null,
      affiliate_code: account.affiliate_code,
      affiliate_link: affiliateLink,
      commission_percent: Number(account.commission_percent ?? 15),
      summary: normalizeSummary(summary),
      recent_referrals: recent.map(normalizeReferralRow)
    });
  } catch (error) {
    console.error('affiliate-dashboard failed:', error);
    return json(500, { error: String(error?.message || error) });
  }
}

async function ensureAffiliateAccount(userId, rest, sjson) {
  const existingRes = await rest(`affiliate_accounts?user_id=eq.${encodeURIComponent(userId)}&select=user_id,affiliate_code,commission_percent,created_at,updated_at&limit=1`);
  const existing = await sjson(existingRes);
  if (!existingRes.ok) throw new Error('affiliate account fetch failed');
  if (Array.isArray(existing) && existing[0]) return existing[0];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeAffiliateCode();
    const insertRes = await rest('affiliate_accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        user_id: userId,
        affiliate_code: code,
        commission_percent: 15
      })
    });
    const inserted = await sjson(insertRes);
    if (insertRes.ok && Array.isArray(inserted) && inserted[0]) return inserted[0];

    // Race: another request may have created the account while this one was inserting.
    const retryRes = await rest(`affiliate_accounts?user_id=eq.${encodeURIComponent(userId)}&select=user_id,affiliate_code,commission_percent,created_at,updated_at&limit=1`);
    const retry = await sjson(retryRes);
    if (retryRes.ok && Array.isArray(retry) && retry[0]) return retry[0];
  }

  throw new Error('Could not create affiliate account');
}

async function getSummaryViaRpc(userId, rest, sjson) {
  const res = await rest('rpc/get_affiliate_dashboard_summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_referrer_user_id: userId })
  });
  const body = await sjson(res);
  if (!res.ok) throw new Error(body?.message || body?.error || 'affiliate summary RPC failed');
  return Array.isArray(body) ? (body[0] || null) : body;
}

async function getRecentViaRpc(userId, limit, rest, sjson) {
  const res = await rest('rpc/get_affiliate_recent_referrals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_referrer_user_id: userId, p_limit: limit })
  });
  const body = await sjson(res);
  if (!res.ok) throw new Error(body?.message || body?.error || 'affiliate recent RPC failed');
  return Array.isArray(body) ? body : [];
}

async function buildSummaryFallback(userId, limit, rest, sjson) {
  const referrals = await fetchAllReferrals(userId, rest, sjson);
  const referredIds = [...new Set(referrals.map((row) => row.referred_user_id).filter(Boolean))];
  const payments = await fetchPaymentsForUsers(referredIds, rest, sjson);
  const paymentsByUser = aggregatePaymentsByUser(payments);

  let totalPayments = 0;
  let totalCreditsBought = 0;
  let totalAmountCents = 0;
  let lastPaymentAt = null;

  paymentsByUser.forEach((value) => {
    totalPayments += value.payment_count;
    totalCreditsBought += value.credits_bought;
    totalAmountCents += value.total_amount_cents;
    if (!lastPaymentAt || (value.last_payment_at && new Date(value.last_payment_at) > new Date(lastPaymentAt))) {
      lastPaymentAt = value.last_payment_at;
    }
  });

  const totalBrought = referrals.length;
  const paidUsers = paymentsByUser.size;
  const summary = {
    total_brought: totalBrought,
    paid_users: paidUsers,
    total_payments: totalPayments,
    total_credits_bought: round2(totalCreditsBought),
    total_amount_cents: totalAmountCents,
    estimated_15_percent_reward_credits: rewardUsdFromAmountCents(totalAmountCents),
    estimated_15_percent_reward_usd: rewardUsdFromAmountCents(totalAmountCents),
    estimated_15_percent_reward_cents: Math.round(totalAmountCents * 0.15),
    conversion_rate: totalBrought ? round2((paidUsers / totalBrought) * 100) : 0,
    last_payment_at: lastPaymentAt
  };

  const recent = referrals.slice(0, limit).map((row) => {
    const pay = paymentsByUser.get(row.referred_user_id) || emptyPaymentAggregate();
    return {
      id: row.id,
      affiliate_code: row.affiliate_code,
      referred_user_id: row.referred_user_id,
      referral_status: row.status,
      referred_at: row.created_at,
      has_paid: pay.payment_count > 0,
      payment_count: pay.payment_count,
      credits_bought: round2(pay.credits_bought),
      total_amount_cents: pay.total_amount_cents,
      last_payment_at: pay.last_payment_at,
      estimated_15_percent_reward_credits: rewardUsdFromAmountCents(pay.total_amount_cents),
      estimated_15_percent_reward_usd: rewardUsdFromAmountCents(pay.total_amount_cents),
      estimated_15_percent_reward_cents: Math.round(pay.total_amount_cents * 0.15)
    };
  });

  return { summary, recent };
}

async function fetchAllReferrals(userId, rest, sjson) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const to = from + pageSize - 1;
    const path = `affiliate_referrals?referrer_user_id=eq.${encodeURIComponent(userId)}&select=id,affiliate_code,referred_user_id,status,created_at,converted_at&order=created_at.desc`;
    const res = await rest(path, { headers: { Range: `${from}-${to}` } });
    const body = await sjson(res);
    if (!res.ok || !Array.isArray(body)) throw new Error('affiliate referrals fetch failed');
    rows.push(...body);
    if (body.length < pageSize) break;
  }
  return rows;
}

async function fetchPaymentsForUsers(userIds, rest, sjson) {
  if (!userIds.length) return [];
  const all = [];
  const batchSize = 150;
  const pageSize = 1000;

  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    const inList = batch.map((id) => encodeURIComponent(id)).join(',');
    for (let from = 0; from < 50000; from += pageSize) {
      const to = from + pageSize - 1;
      const path = `payments?uid=in.(${inList})&status=in.(succeeded,paid)&select=id,uid,credits,amount_cents,currency,paid_at,status`;
      const res = await rest(path, { headers: { Range: `${from}-${to}` } });
      const body = await sjson(res);
      if (!res.ok || !Array.isArray(body)) throw new Error('payments fetch failed');
      all.push(...body);
      if (body.length < pageSize) break;
    }
  }

  return all;
}

function aggregatePaymentsByUser(payments) {
  const map = new Map();
  payments.forEach((payment) => {
    if (!payment.uid) return;
    const current = map.get(payment.uid) || emptyPaymentAggregate();
    current.payment_count += 1;
    current.credits_bought += Number(payment.credits || 0);
    current.total_amount_cents += Number(payment.amount_cents || 0);
    if (!current.last_payment_at || (payment.paid_at && new Date(payment.paid_at) > new Date(current.last_payment_at))) {
      current.last_payment_at = payment.paid_at || null;
    }
    map.set(payment.uid, current);
  });
  return map;
}

function emptyPaymentAggregate() {
  return {
    payment_count: 0,
    credits_bought: 0,
    total_amount_cents: 0,
    last_payment_at: null
  };
}

function normalizeSummary(row) {
  const totalAmountCents = Number(row?.total_amount_cents || 0);
  const amountBasedRewardUsd = rewardUsdFromAmountCents(totalAmountCents);
  const fallbackRewardUsd = round2(row?.estimated_15_percent_reward_usd || row?.estimated_15_percent_reward_credits || 0);
  const rewardUsd = totalAmountCents > 0 ? amountBasedRewardUsd : fallbackRewardUsd;

  return {
    total_brought: Number(row?.total_brought || 0),
    paid_users: Number(row?.paid_users || 0),
    total_payments: Number(row?.total_payments || 0),
    total_credits_bought: round2(row?.total_credits_bought || 0),
    total_amount_cents: totalAmountCents,
    estimated_15_percent_reward_credits: rewardUsd,
    estimated_15_percent_reward_usd: rewardUsd,
    estimated_15_percent_reward_cents: Math.round(totalAmountCents * 0.15),
    conversion_rate: round2(row?.conversion_rate || 0),
    last_payment_at: row?.last_payment_at || null
  };
}

function normalizeReferralRow(row) {
  const totalAmountCents = Number(row.total_amount_cents || 0);
  const amountBasedRewardUsd = rewardUsdFromAmountCents(totalAmountCents);
  const fallbackRewardUsd = round2(row.estimated_15_percent_reward_usd || row.estimated_15_percent_reward_credits || 0);
  const rewardUsd = totalAmountCents > 0 ? amountBasedRewardUsd : fallbackRewardUsd;

  return {
    id: row.id || null,
    affiliate_code: row.affiliate_code || null,
    referred_user_id: row.referred_user_id || null,
    referral_status: row.referral_status || row.status || 'registered',
    referred_at: row.referred_at || row.created_at || null,
    has_paid: Boolean(row.has_paid),
    payment_count: Number(row.payment_count || 0),
    credits_bought: round2(row.credits_bought || 0),
    total_amount_cents: totalAmountCents,
    last_payment_at: row.last_payment_at || null,
    estimated_15_percent_reward_credits: rewardUsd,
    estimated_15_percent_reward_usd: rewardUsd,
    estimated_15_percent_reward_cents: Math.round(totalAmountCents * 0.15)
  };
}

function makeAffiliateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let code = '';
  for (let i = 0; i < bytes.length; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function rewardUsdFromAmountCents(amountCents) {
  return round2((Number(amountCents || 0) / 100) * 0.15);
}

function round2(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function json(status, obj) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    },
    body: status === 204 ? '' : JSON.stringify(obj)
  };
}
