// netlify/functions/yoomoney-webhook.mjs
// YooMoney HTTP notification receiver for Russian card payments.
// Adds credits exactly once by using the same payments-table CAS pattern as dodo-webhook.mjs.

import { createHash, createHmac } from "node:crypto";

const PACKS = {
  100: { rub: 750 },
  210: { rub: 1500 },
  535: { rub: 3700 },
  1100: { rub: 7400 }
};

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(204, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

    let payload = parsePayload(event);
    const notificationSecret = process.env.YOOMONEY_NOTIFICATION_SECRET || "";
    const accessToken = process.env.YOOMONEY_ACCESS_TOKEN || "";
    if (notificationSecret && !verifyYooMoneySignature(payload, notificationSecret)) {
      return json(403, { error: "Invalid YooMoney signature" });
    }
    if (!notificationSecret) {
      if (!accessToken) return json(500, { error: "Missing YOOMONEY_NOTIFICATION_SECRET or YOOMONEY_ACCESS_TOKEN" });
      payload = await enrichFromOperationDetails(payload, accessToken);
    }

    const codepro = String(payload.codepro || "").toLowerCase() === "true";
    const unaccepted = String(payload.unaccepted || "").toLowerCase() === "true";
    if (codepro || unaccepted) {
      return json(200, { ok: true, skipped: "payment is protected or unaccepted", codepro, unaccepted });
    }

    const transaction_id = payload.operation_id || payload.notification_id || null;
    const label = String(payload.label || "");
    const info = parseLabel(label);
    const uid = info.uid || null;
    const email = info.email || null;
    const credits = Number(info.credits || 0);
    const amountRub = amountNumber(payload.withdraw_amount || payload.amount);
    const expected = PACKS[credits]?.rub || null;
    const currency = normalizeCurrency(payload.currency);
    const amount_cents = Number.isFinite(amountRub) ? Math.round(amountRub * 100) : null;
    const paid_at = payload.datetime || new Date().toISOString();
    const provider = "yoomoney";

    const successStatus = !payload.status || String(payload.status).toLowerCase() === "success";
    const incomingDirection = !payload.direction || String(payload.direction).toLowerCase() === "in";
    if (!successStatus || !incomingDirection) {
      return json(200, { ok: true, skipped: "operation is not a successful incoming payment", status: payload.status, direction: payload.direction });
    }

    if (!transaction_id || !uid || !credits || !expected || !Number.isFinite(amountRub)) {
      return json(400, {
        error: "Missing required fields",
        transaction_id: !!transaction_id,
        uid: !!uid,
        credits,
        amountRub
      });
    }
    if (Math.abs(amountRub - expected) > 0.01) {
      return json(400, { error: "Amount does not match selected credit pack", credits, expected, paid: amountRub });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
      return json(400, { error: "Invalid uid format" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
    }

    async function sjson(res) { try { return await res.json(); } catch { return null; } }
    const sbHeaders = {
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY
    };

    {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/payments?on_conflict=transaction_id`, {
        method: "POST",
        headers: {
          ...sbHeaders,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Prefer": "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify([{
          transaction_id,
          uid,
          credits,
          amount_cents,
          currency,
          status: null,
          provider,
          return_url: null,
          payload: { ...payload, parsed_label: info },
          paid_at
        }])
      });
      if (!res.ok) {
        const detail = await sjson(res) || await res.text();
        return json(500, { error: "payments insert failed", detail });
      }
    }

    let won = false;
    {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/payments?transaction_id=eq.${encodeURIComponent(transaction_id)}&status=is.null`, {
        method: "PATCH",
        headers: {
          ...sbHeaders,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          status: "succeeded",
          uid,
          credits,
          amount_cents,
          currency,
          provider,
          return_url: null,
          payload: { ...payload, parsed_label: info },
          paid_at
        })
      });
      const updated = await sjson(res) || [];
      won = res.ok && Array.isArray(updated) && updated.length > 0;
    }

    let credited = false;
    if (won) {
      const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits,email`, {
        headers: { ...sbHeaders, "Accept": "application/json" }
      });
      const rows = await sjson(profileRes) || [];
      if (!profileRes.ok || !Array.isArray(rows) || rows.length === 0) {
        return json(500, { error: "profiles fetch failed or 0 rows" });
      }

      const profile = rows[0] || {};
      if (email && profile.email && String(profile.email).toLowerCase() !== String(email).toLowerCase()) {
        return json(409, { error: "Payment email does not match profile email" });
      }

      const currentCredits = Number(profile.credits ?? 0);
      const newCredits = currentCredits + credits;
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
        method: "PATCH",
        headers: {
          ...sbHeaders,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({ credits: newCredits })
      });
      const updated = await sjson(updateRes) || [];
      if (!updateRes.ok || !Array.isArray(updated) || updated.length === 0) {
        const detail = await updateRes.text();
        return json(500, { error: "profiles update failed", detail });
      }
      credited = true;
    }

    return json(200, { ok: true, credited, transaction_id, credits, currency, amount_cents });
  } catch (error) {
    return json(500, { error: String(error?.message || error) });
  }
}

function parsePayload(event) {
  const contentType = String(event.headers?.["content-type"] || event.headers?.["Content-Type"] || "");
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  if (contentType.includes("application/json")) return JSON.parse(raw || "{}");
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

async function enrichFromOperationDetails(payload, accessToken) {
  const operationId = payload.operation_id || payload.operation_id__ || payload.notification_id || "";
  if (!operationId) throw new Error("Missing operation_id for YooMoney operation-details verification");

  const res = await fetch("https://yoomoney.ru/api/operation-details", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: new URLSearchParams({ operation_id: operationId }).toString()
  });
  const details = await res.json().catch(() => null);
  if (!res.ok || !details || details.error) {
    throw new Error(`YooMoney operation-details failed: ${details?.error || res.status}`);
  }
  return {
    ...payload,
    ...details,
    operation_id: details.operation_id || operationId,
    amount: details.amount ?? payload.amount,
    label: details.label || payload.label || "",
    datetime: details.datetime || payload.datetime,
    codepro: details.codepro ?? payload.codepro,
    currency: payload.currency || "643"
  };
}

function parseLabel(label) {
  const parts = String(label || "").split("|");
  if (parts[0] !== "hansora_web") return {};
  return {
    credits: Number(parts[1] || 0),
    uid: parts[2] || "",
    email: parts.slice(3).join("|") || ""
  };
}

function verifyYooMoneySignature(payload, secret) {
  const sign = String(payload.sign || "").toLowerCase();
  if (sign) {
    const unsigned = Object.entries(payload)
      .filter(([key]) => key !== "sign")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeRFC3986(value)}`)
      .join("&");
    const expected = createHmac("sha256", secret).update(unsigned).digest("hex").toLowerCase();
    if (sign === expected) return true;
  }

  const actual = String(payload.sha1_hash || "").toLowerCase();
  if (!actual) return false;
  const fields = [
    payload.notification_type || "",
    payload.operation_id || "",
    payload.amount || "",
    payload.currency || "",
    payload.datetime || "",
    payload.sender || "",
    payload.codepro || "",
    secret,
    payload.label || ""
  ];
  const expected = createHash("sha1").update(fields.join("&")).digest("hex").toLowerCase();
  return actual === expected;
}

function encodeRFC3986(value) {
  return encodeURIComponent(String(value ?? "")).replace(/[!'()*]/g, function(char) {
    return "%" + char.charCodeAt(0).toString(16).toUpperCase();
  });
}

function amountNumber(value) {
  const n = Number(String(value || "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function normalizeCurrency(value) {
  const raw = String(value || "").toUpperCase();
  if (raw === "643" || raw === "RUB" || raw === "") return "RUB";
  return raw;
}

function json(status, obj) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    },
    body: status === 204 ? "" : JSON.stringify(obj)
  };
}
