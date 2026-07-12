// netlify/functions/cancel-subscription.mjs
// Schedules a Dodo subscription cancellation at the end of the paid period.

const FEEDBACK_BY_REASON = {
  price_too_high: "too_expensive",
  did_not_use_unlimited: "unused",
  missing_models: "missing_features",
  results_not_good_enough: "low_quality",
  one_project_only: "unused",
  other: "other"
};

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const DODO_PAYMENTS_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
  const DODO_API_BASE = process.env.DODO_API_BASE || "https://live.dodopayments.com";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DODO_PAYMENTS_API_KEY) {
    return json(500, { error: "missing_env" });
  }

  const token = getBearerToken(event.headers || {});
  if (!token) return json(401, { error: "missing_auth" });

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "bad_json" });
  }

  const reason = String(body.reason || "").trim();
  const note = String(body.note || "").trim().slice(0, 1000);
  const feedback = FEEDBACK_BY_REASON[reason];
  if (!feedback) return json(400, { error: "missing_cancel_reason" });

  const user = await getSupabaseUser({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, token });
  if (!user?.id) return json(401, { error: "invalid_auth" });

  const subscription = await getUserSubscription({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    userId: user.id
  });

  if (!subscription) return json(404, { error: "subscription_not_found" });
  if (subscription.status !== "active") return json(409, { error: "subscription_not_active" });
  if (subscription.current_period_end && Date.parse(subscription.current_period_end) <= Date.now()) {
    return json(409, { error: "subscription_period_already_finished" });
  }
  if (subscription.cancel_at_period_end) {
    return json(200, { ok: true, already_scheduled: true, subscription });
  }

  const providerSubscriptionId = subscription.provider_subscription_id;
  if (!providerSubscriptionId) return json(409, { error: "missing_provider_subscription_id" });

  const dodoPayload = {
    cancel_at_next_billing_date: true,
    cancel_reason: "cancelled_by_customer",
    cancellation_feedback: feedback,
    cancellation_comment: note || reason
  };

  const dodoRes = await fetch(`${DODO_API_BASE}/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DODO_PAYMENTS_API_KEY}`
    },
    body: JSON.stringify(dodoPayload)
  });

  const dodoJson = await readJson(dodoRes);
  if (!dodoRes.ok) {
    return json(502, { error: "dodo_cancel_failed", detail: dodoJson });
  }

  const now = new Date().toISOString();
  const updatedSubscription = await updateUserSubscription({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    userId: user.id,
    row: {
      status: "active",
      cancel_at_period_end: true,
      canceled_at: now,
      updated_at: now
    }
  });

  await recordCancellationFeedback({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    userId: user.id,
    providerSubscriptionId,
    planId: subscription.plan_id,
    reason,
    note,
    payload: dodoJson
  });

  return json(200, {
    ok: true,
    subscription: updatedSubscription || {
      ...subscription,
      status: "active",
      cancel_at_period_end: true,
      canceled_at: now,
      updated_at: now
    }
  });
}

function getBearerToken(headers) {
  const auth = headers.authorization || headers.Authorization || "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function getSupabaseUser({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, token }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY
    }
  });
  if (!res.ok) return null;
  return await readJson(res);
}

async function getUserSubscription({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=*`, {
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY
    }
  });
  const rows = await readJson(res);
  if (!res.ok || !Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function updateUserSubscription({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId, row }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Prefer": "return=representation",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY
    },
    body: JSON.stringify(row)
  });
  const rows = await readJson(res);
  if (!res.ok || !Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function recordCancellationFeedback({
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  userId,
  providerSubscriptionId,
  planId,
  reason,
  note,
  payload
}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/subscription_cancellations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY
    },
    body: JSON.stringify([{
      user_id: userId,
      provider_subscription_id: providerSubscriptionId,
      plan_id: planId,
      reason,
      note,
      payload,
      created_at: new Date().toISOString()
    }])
  });

  // Feedback storage is useful, but cancellation must not fail if the table is not created yet.
  return res.ok;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
